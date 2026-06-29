import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalDecision, ExecutionStatus, Prisma, TicketStatus } from '@/prisma/client';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { DispatcherService } from '@/dispatcher/dispatcher.service';
import { GitHubService } from '@/github/github.service';
import { GitHubPROrchestrator } from '@/github/services/github-pr-orchestrator.service';
import { RealtimeService } from '@/realtime/realtime.service';

const APPROVAL_EVENT = 'execution.approval-required';
const DECISION_EVENT = 'execution.approval-decision';
const DECISION_FAILED_EVENT = 'execution.approval-decision-failed';

/** Decisions that close the gate and trigger a side effect (merge or loop-back). */
const TERMINAL_DECISIONS: ApprovalDecision[] = [
  ApprovalDecision.APPROVE,
  ApprovalDecision.REJECT,
  ApprovalDecision.REWORK,
];

// Transient status used to atomically *claim* a gate decision. Only one
// concurrent submission (double-click / retried webhook) can flip the row out
// of AWAITING_APPROVAL, so at most one merge / loop-back ever runs (AC6). It is
// overwritten by the terminal status (COMPLETED / QA_FAILED) on success, or
// reset back to AWAITING_APPROVAL if the side effect fails so the operator can
// retry (see `releaseGate`).
const GATE_DECISION_LOCK_STATUS = ExecutionStatus.IN_PROGRESS;

type MergeMethod = 'merge' | 'squash' | 'rebase';
type GateExecution = Prisma.ExecutionGetPayload<{
  include: { ticket: { include: { project: { include: { gitHubAccount: true } } } } };
}>;

type DecisionInput = {
  executionId: string;
  deciderId: string;
  decision: ApprovalDecision;
  reasoning?: string;
};

@Injectable()
export class ApprovalGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly prOrchestrator: GitHubPROrchestrator,
    private readonly realtime: RealtimeService,
    // forwardRef: the dispatcher opens the gate and the gate feeds REJECT/REWORK
    // back into the dispatcher's guarded re-dispatch path — a deliberate cycle.
    @Inject(forwardRef(() => DispatcherService))
    private readonly dispatcher: DispatcherService,
    private readonly config: ConfigService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async openGate(executionId: string, correlationId = executionId) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: { include: { project: true } } },
    });
    if (!execution) throw new NotFoundException(`Execution ${executionId} not found`);

    const githubPush = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: executionId },
      orderBy: { created_at: 'desc' },
    });

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.AWAITING_APPROVAL, error_message: null },
    });
    await this.prisma.ticket.update({
      where: { id: execution.ticket_id },
      data: { status: TicketStatus.AWAITING_APPROVAL },
    });

    const payload = {
      executionId,
      ticketId: execution.ticket_id,
      clickupTaskId: execution.ticket.clickup_task_id,
      projectId: execution.ticket.project_id,
      prUrl: githubPush?.pr_url ?? null,
      prNumber: githubPush?.pr_number ?? null,
      correlationId,
    };
    this.emit(execution.ticket.project_id, APPROVAL_EVENT, payload);
    return payload;
  }

  /**
   * Executions awaiting human approval. Pass `projectId` to scope the list to a
   * single tenant (the dashboard supplies the project it is rendering). Broader
   * per-user project-membership filtering is deferred until a user↔project
   * ownership relation exists; today approver roles are workspace-global.
   */
  async pendingApprovals(projectId?: string) {
    return this.prisma.execution.findMany({
      where: {
        status: ExecutionStatus.AWAITING_APPROVAL,
        ...(projectId ? { ticket: { project_id: projectId } } : {}),
      },
      include: {
        ticket: { include: { project: true } },
        approvalRecords: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  async assertApproved(executionId: string): Promise<void> {
    const approval = await this.prisma.approvalRecord.findFirst({
      where: { execution_id: executionId, decision: ApprovalDecision.APPROVE },
      select: { id: true },
    });
    if (!approval) throw new BadRequestException(`Execution ${executionId} is not approved`);
  }

  async recordDecision(input: DecisionInput) {
    const execution = await this.getGateExecution(input.executionId);
    if (!execution) throw new NotFoundException(`Execution ${input.executionId} not found`);

    // Non-terminal decisions (e.g. ESCALATE): record + notify only, the gate
    // stays open and no merge/loop-back is triggered.
    if (!TERMINAL_DECISIONS.includes(input.decision)) {
      if (execution.status !== ExecutionStatus.AWAITING_APPROVAL) {
        throw new BadRequestException(
          `Execution is not awaiting approval (current: ${execution.status})`,
        );
      }
      await this.prisma.approvalRecord.create({
        data: {
          execution_id: input.executionId,
          pm_id: input.deciderId,
          decision: input.decision,
          reasoning: input.reasoning,
        },
      });
      this.emit(execution.ticket.project_id, DECISION_EVENT, {
        executionId: input.executionId,
        decision: input.decision,
        status: execution.status,
      });
      return { status: execution.status, decision: input.decision };
    }

    const existingTerminal = await this.prisma.approvalRecord.findFirst({
      where: { execution_id: input.executionId, decision: { in: TERMINAL_DECISIONS } },
    });

    // An APPROVE already recorded but still AWAITING_APPROVAL means a previous
    // merge failed (see `releaseGate`). Re-submitting APPROVE retries the merge
    // without writing a second record — preserving the original audit trail.
    const isApproveRetry =
      input.decision === ApprovalDecision.APPROVE &&
      existingTerminal?.decision === ApprovalDecision.APPROVE &&
      execution.status === ExecutionStatus.AWAITING_APPROVAL;

    if (existingTerminal && !isApproveRetry) {
      throw new BadRequestException('Execution already has a terminal approval decision');
    }
    if (execution.status !== ExecutionStatus.AWAITING_APPROVAL) {
      throw new BadRequestException(
        `Execution is not awaiting approval (current: ${execution.status})`,
      );
    }

    // Atomic claim — the WHERE clause guarantees exactly one concurrent caller
    // flips the row, so duplicate submissions can never double-merge/double-loop.
    const claim = await this.prisma.execution.updateMany({
      where: { id: input.executionId, status: ExecutionStatus.AWAITING_APPROVAL },
      data: { status: GATE_DECISION_LOCK_STATUS },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        'An approval decision is already being processed for this execution',
      );
    }

    try {
      // Persist the decision (attribution + reasoning) before the side effect so
      // the audit trail is complete even if the merge/loop-back fails (NFR-S5).
      if (!isApproveRetry) {
        await this.prisma.approvalRecord.create({
          data: {
            execution_id: input.executionId,
            pm_id: input.deciderId,
            decision: input.decision,
            reasoning: input.reasoning,
          },
        });
      }

      if (input.decision === ApprovalDecision.APPROVE) {
        return await this.approve(execution, input);
      }
      return await this.loopBack(execution, input);
    } catch (error: unknown) {
      await this.releaseGate(execution, input, error);
      throw error;
    }
  }

  private async approve(execution: GateExecution, input: DecisionInput) {
    await this.assertApproved(input.executionId);
    let githubPush = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: input.executionId },
      orderBy: { created_at: 'desc' },
    });
    if (!githubPush)
      throw new BadRequestException('Execution has no pushed branch — nothing to open or merge');

    // PR-open approval gate: when require_pr_approval is on, the code-delivery
    // step pushed the branch but deferred opening the PR until now. Open it on
    // approval, then proceed to merge. When approval is off the PR already
    // exists (pr_number set) and this is skipped.
    if (!githubPush.pr_number) {
      const pr = await this.prOrchestrator.createPullRequest(input.executionId, input.executionId);
      if (!pr.success || !pr.prNumber) {
        throw new Error(`Failed to open pull request on approval: ${pr.error ?? 'unknown error'}`);
      }
      githubPush = await this.prisma.gitHubPush.findFirst({
        where: { execution_id: input.executionId },
        orderBy: { created_at: 'desc' },
      });
    }
    if (!githubPush?.pr_number)
      throw new BadRequestException('Execution has no pull request to merge');

    const { owner, repo } = this.parseRepository(githubPush.repository);
    const mergeMethod = this.config.get<MergeMethod>('github.mergeMethod') ?? 'squash';
    const result = await this.github.mergePullRequest(
      owner,
      repo,
      githubPush.pr_number,
      mergeMethod,
      execution.ticket.project.gitHubAccount?.installationId,
    );

    await this.prisma.execution.update({
      where: { id: input.executionId },
      data: { status: ExecutionStatus.COMPLETED, completed_at: new Date(), error_message: null },
    });
    await this.aiDecisionLogger.logDecision({
      agentName: 'ApprovalGate',
      action: 'approve_merge',
      reasoning: input.reasoning ?? 'Human approved merge',
      ticketId: execution.ticket_id,
      executionId: input.executionId,
      inputData: {
        decision: input.decision,
        deciderId: input.deciderId,
        prNumber: githubPush.pr_number,
      },
      outputData: { mergeSha: result.sha, prUrl: githubPush.pr_url },
      confidence: 1,
    });

    const payload = {
      executionId: input.executionId,
      decision: input.decision,
      prUrl: githubPush.pr_url,
    };
    this.emit(execution.ticket.project_id, DECISION_EVENT, payload);
    return {
      status: ExecutionStatus.COMPLETED,
      decision: input.decision,
      prUrl: githubPush.pr_url,
    };
  }

  private async loopBack(execution: GateExecution, input: DecisionInput) {
    await this.prisma.execution.update({
      where: { id: input.executionId },
      data: { status: ExecutionStatus.QA_FAILED, error_message: input.reasoning },
    });
    // Reuse the dispatcher's guarded re-dispatch (active-execution + loop-cap
    // valves) instead of forking an unguarded run.
    const result = await this.dispatcher.redispatchImplement(
      execution.ticket_id,
      input.executionId,
    );
    const newExecutionId = result.dispatched ? result.executionId : undefined;
    const redispatch = result.dispatched ? 'dispatched' : result.reason;

    const payload = {
      executionId: input.executionId,
      decision: input.decision,
      newExecutionId,
      redispatch,
    };
    this.emit(execution.ticket.project_id, DECISION_EVENT, payload);
    return {
      status: ExecutionStatus.QA_FAILED,
      decision: input.decision,
      newExecutionId,
      redispatch,
    };
  }

  /**
   * Side effect failed after the gate was claimed: reset the execution back to
   * AWAITING_APPROVAL (so the decision can be retried), record the failure on the
   * row, and surface it to the dashboard. Never lets an audit failure mask the
   * original error (AC9).
   */
  private async releaseGate(execution: GateExecution, input: DecisionInput, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.execution.update({
      where: { id: input.executionId },
      data: { status: ExecutionStatus.AWAITING_APPROVAL, error_message: message },
    });
    await this.aiDecisionLogger
      .logDecision({
        agentName: 'ApprovalGate',
        action: 'approve_merge_failed',
        reasoning: message,
        ticketId: execution.ticket_id,
        executionId: input.executionId,
        inputData: { decision: input.decision, deciderId: input.deciderId },
        outputData: { error: message },
        confidence: 0,
      })
      .catch(() => undefined);
    this.emit(execution.ticket.project_id, DECISION_FAILED_EVENT, {
      executionId: input.executionId,
      decision: input.decision,
      status: ExecutionStatus.AWAITING_APPROVAL,
      error: message,
    });
  }

  private emit(projectId: string | null, event: string, payload: unknown): void {
    if (projectId) {
      this.realtime.emitToProject(projectId, event, payload);
      return;
    }
    this.realtime.emitToRole('ADMIN', event, payload);
    this.realtime.emitToRole('MANAGER', event, payload);
  }

  private parseRepository(repository: string): { owner: string; repo: string } {
    const clean = repository.replace(/\.git$/, '');
    const urlMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
    const [owner, repo] = clean.split('/');
    if (!owner || !repo) throw new Error(`Invalid repository format: ${repository}`);
    return { owner, repo };
  }

  private async getGateExecution(executionId: string) {
    return this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: { include: { project: { include: { gitHubAccount: true } } } } },
    });
  }
}
