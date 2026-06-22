import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalDecision, ExecutionStatus, Prisma, TicketStatus } from '@/prisma/client';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { GitHubService } from '@/github/github.service';
import { OpenHarnessRunnerService } from '@/openharness/openharness-runner.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { RealtimeService } from '@/realtime/realtime.service';

const APPROVAL_EVENT = 'execution.approval-required';
const DECISION_EVENT = 'execution.approval-decision';
const APPROVER_ROLES = ['ADMIN', 'MANAGER', 'PM', 'TL'] as const;

type MergeMethod = 'merge' | 'squash' | 'rebase';
type GateExecution = Prisma.ExecutionGetPayload<{
  include: { ticket: { include: { project: { include: { gitHubAccount: true } } } } };
}>;

@Injectable()
export class ApprovalGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly realtime: RealtimeService,
    private readonly runner: OpenHarnessRunnerService,
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

  async pendingApprovals() {
    return this.prisma.execution.findMany({
      where: { status: ExecutionStatus.AWAITING_APPROVAL },
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

  async recordDecision(input: {
    executionId: string;
    deciderId: string;
    decision: ApprovalDecision;
    reasoning?: string;
  }) {
    const execution = await this.getGateExecution(input.executionId);
    if (!execution) throw new NotFoundException(`Execution ${input.executionId} not found`);
    if (execution.status !== ExecutionStatus.AWAITING_APPROVAL) {
      throw new BadRequestException(
        `Execution is not awaiting approval (current: ${execution.status})`,
      );
    }

    const previous = await this.prisma.approvalRecord.findFirst({
      where: {
        execution_id: input.executionId,
        decision: {
          in: [ApprovalDecision.APPROVE, ApprovalDecision.REJECT, ApprovalDecision.REWORK],
        },
      },
    });
    if (previous)
      throw new BadRequestException('Execution already has a terminal approval decision');

    await this.prisma.approvalRecord.create({
      data: {
        execution_id: input.executionId,
        pm_id: input.deciderId,
        decision: input.decision,
        reasoning: input.reasoning,
      },
    });

    if (input.decision === ApprovalDecision.APPROVE) {
      return this.approve(execution, input);
    }
    if (input.decision === ApprovalDecision.REJECT || input.decision === ApprovalDecision.REWORK) {
      return this.loopBack(execution, input);
    }

    this.emit(execution.ticket.project_id, DECISION_EVENT, { ...input, status: execution.status });
    return { status: execution.status, decision: input.decision };
  }

  private async approve(
    execution: GateExecution,
    input: {
      executionId: string;
      deciderId: string;
      decision: ApprovalDecision;
      reasoning?: string;
    },
  ) {
    await this.assertApproved(input.executionId);
    const githubPush = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: input.executionId },
    });
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
      data: { status: ExecutionStatus.COMPLETED, completed_at: new Date() },
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

  private async loopBack(
    execution: GateExecution,
    input: {
      executionId: string;
      deciderId: string;
      decision: ApprovalDecision;
      reasoning?: string;
    },
  ) {
    await this.prisma.execution.update({
      where: { id: input.executionId },
      data: { status: ExecutionStatus.QA_FAILED, error_message: input.reasoning },
    });
    const newExecutionId = await this.runner.runForTicket(execution.ticket_id, {
      skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      workspaceDir: this.requiredConfig('openharness.workspaceDir'),
    });
    const payload = { executionId: input.executionId, decision: input.decision, newExecutionId };
    this.emit(execution.ticket.project_id, DECISION_EVENT, payload);
    return { status: ExecutionStatus.QA_FAILED, decision: input.decision, newExecutionId };
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

  private requiredConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new Error(`Missing required config: ${key}`);
    return value;
  }

  private async getGateExecution(executionId: string) {
    return this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: { include: { project: { include: { gitHubAccount: true } } } } },
    });
  }
}

export { APPROVER_ROLES };
