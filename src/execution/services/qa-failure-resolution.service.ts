import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { GitHubService } from '@/github/github.service';
import { PMExecutionStatusService } from '@/integrations/pm-execution-status.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { ExecutionStatus, GitHubStatus } from '@/prisma/client';
import { ResolveQaFailureDto, QaFailureResolutionAction } from '../dto/resolve-qa-failure.dto';

export interface QAResolutionResult {
  action: QaFailureResolutionAction;
  prUrl?: string;
  prNumber?: number;
  branchName?: string | null;
}

type ExecutionWithTicketProject = {
  id: string;
  status: ExecutionStatus;
  qa_failed_branch: string | null;
  ticket: {
    id: string;
    title: string;
    clickup_task_id: string | null;
    project: {
      id: string;
      github_repository_url: string;
      default_branch: string | null;
      gitHubAccount: { installationId: string | null } | null;
    } | null;
  } | null;
};

@Injectable()
export class QAFailureResolutionService {
  private readonly logger = new Logger(QAFailureResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GitHubService,
    private readonly statusService: PMExecutionStatusService,
    private readonly tracker: ExecutionTrackerService,
  ) {}

  /**
   * Resolve a QA-failed execution by either opening a PR or cancelling it.
   */
  async resolve(
    executionId: string,
    dto: ResolveQaFailureDto,
    correlationId?: string,
  ): Promise<QAResolutionResult> {
    const tag = correlationId ? `[${correlationId}] ` : '';
    this.logger.log(
      `${tag}Resolving QA failure for execution ${executionId} with action ${dto.action}`,
    );

    const execution = (await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        ticket: {
          include: {
            project: {
              include: { gitHubAccount: true },
            },
          },
        },
      },
    })) as ExecutionWithTicketProject | null;

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    // P1: 409 for non-QA_FAILED state (AC-7)
    if (execution.status !== ExecutionStatus.QA_FAILED) {
      throw new ConflictException(
        `Execution ${executionId} is not in QA_FAILED state — current state: ${execution.status}`,
      );
    }

    if (dto.action === QaFailureResolutionAction.OPEN_PR) {
      return this.handleOpenPr(execution, correlationId);
    }
    return this.handleCancel(execution, correlationId);
  }

  private async handleOpenPr(
    execution: ExecutionWithTicketProject,
    correlationId?: string,
  ): Promise<QAResolutionResult> {
    const tag = correlationId ? `[${correlationId}] ` : '';

    // P2: Use qa_failed_branch from execution record (set by WR-4.1); 422 if absent (AC-8)
    if (!execution.qa_failed_branch) {
      throw new UnprocessableEntityException(
        `Execution ${execution.id} has no pushed branch — cannot open PR`,
      );
    }

    const ticket = execution.ticket!;
    const project = ticket.project!;

    // P8: Idempotency guard — reject if a PR was already created for this execution
    const existingPr = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: execution.id, push_status: GitHubStatus.PR_CREATED },
    });
    if (existingPr?.pr_number) {
      throw new ConflictException(
        `PR already created for execution ${execution.id} (PR #${existingPr.pr_number})`,
      );
    }

    // P13: Parse owner/repo with slug fallback and UnprocessableEntityException
    const { owner, repo } = this.parseRepositoryUrl(project.github_repository_url);

    const prTitle = `[QA Failed Review] ${ticket.title}`;
    const prBody =
      `## QA Failure Resolution\n\n` +
      `This PR was opened via the DSF PM resolution workflow after QA retries were exhausted.\n\n` +
      `**Branch:** \`${execution.qa_failed_branch}\`\n` +
      `**Ticket:** ${ticket.clickup_task_id ?? ticket.id}\n\n` +
      `> ⚠️ QA self-healing did not produce a passing build. Please review the code and failing tests before merging.`;

    const targetBranch = project.default_branch || 'main';
    const installationId = project.gitHubAccount?.installationId ?? undefined;

    this.logger.log(
      `${tag}Creating PR for branch ${execution.qa_failed_branch} in ${owner}/${repo}`,
    );

    // P9: Typed cast instead of any
    const prData = (await this.githubService.createPullRequest(
      owner,
      repo,
      prTitle,
      prBody,
      execution.qa_failed_branch,
      targetBranch,
      installationId,
    )) as { number: number; html_url: string };

    const prNumber = prData.number;
    const prUrl = prData.html_url;

    // P11: Warn on errors instead of bare catch {} — addLabels is best-effort
    try {
      await this.githubService.addLabelsToPR(
        owner,
        repo,
        prNumber,
        ['qa-failed', 'manual-intervention'],
        installationId,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${tag}Failed to add qa-failed label to PR #${prNumber}: ${msg}`);
    }

    // P7: ClickUp notification before status transition — if notifyCodeReview fails the
    // execution is still QA_FAILED and the PM can retry (no stuck terminal state)
    await this.statusService.notifyCodeReview(project.id, ticket.id, prUrl, correlationId);

    // P6 + P12: Persist PR record with pr_url using GitHubStatus enum
    await this.prisma.gitHubPush.create({
      data: {
        execution_id: execution.id,
        repository: project.github_repository_url,
        branch_name: execution.qa_failed_branch,
        pr_number: prNumber,
        pr_url: prUrl,
        push_status: GitHubStatus.PR_CREATED,
      },
    });

    // Status transition last — only after all side-effects are persisted
    await this.tracker.updateStatus(execution.id, ExecutionStatus.COMPLETED);

    this.logger.log(`${tag}QA failure resolved via PR ${prUrl}`);

    // P4: Return result object (AC-1)
    return { action: QaFailureResolutionAction.OPEN_PR, prUrl, prNumber };
  }

  private async handleCancel(
    execution: ExecutionWithTicketProject,
    correlationId?: string,
  ): Promise<QAResolutionResult> {
    const tag = correlationId ? `[${correlationId}] ` : '';
    const ticket = execution.ticket!;
    const project = ticket.project!;

    // P7: ClickUp notification before status transition
    await this.statusService.notifyCancel(project.id, ticket.id, correlationId);

    await this.tracker.updateStatus(execution.id, ExecutionStatus.FAILED);

    this.logger.log(`${tag}QA failure resolved via cancellation for execution ${execution.id}`);

    // P5: Return result object (AC-4)
    return { action: QaFailureResolutionAction.CANCEL, branchName: execution.qa_failed_branch };
  }

  // P13: Parse "owner/repo" from URL or slug; throws 422 for unrecognised formats
  private parseRepositoryUrl(repository: string): { owner: string; repo: string } {
    const clean = repository.replace(/\.git$/, '');
    const urlMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }
    const slugMatch = clean.match(/^([^/]+)\/([^/]+)$/);
    if (slugMatch) {
      return { owner: slugMatch[1], repo: slugMatch[2] };
    }
    throw new UnprocessableEntityException(
      `Cannot parse owner/repo from repository: "${repository}"`,
    );
  }
}
