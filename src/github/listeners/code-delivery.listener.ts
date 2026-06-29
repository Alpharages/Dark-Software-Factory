import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '@/common/event-bus.service';
import { PrismaService } from '@/database/prisma.service';
import { OpenHarnessCodeReadyEvent } from '@/openharness/events/openharness-code-ready.event';
import { GitHubBranchPushService } from '../services/github-branch-push.service';
import { GitHubPROrchestrator } from '../services/github-pr-orchestrator.service';

/**
 * Delivers a completed OpenHarness execution's code to GitHub.
 *
 * On `openharness.code-ready` it always pushes the execution branch, then opens
 * a PR only when approval is NOT required:
 *
 *   effective require-approval = project.require_pr_approval ?? github.requireApprovalForPr
 *
 *   - require-approval = true  → push only; the PR is opened later when the PM
 *     approves at the approval gate.
 *   - require-approval = false → push then immediately open the PR.
 *
 * Lives in the GitHub module (not OpenHarness) and is reached purely via the
 * global EventBus, so the OpenHarness module never imports GitHub — avoiding the
 * OpenHarness → GitHub → ApprovalGate → Dispatcher → OpenHarness cycle.
 */
@Injectable()
export class CodeDeliveryListener implements OnModuleInit {
  private readonly logger = new Logger(CodeDeliveryListener.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pushService: GitHubBranchPushService,
    private readonly prOrchestrator: GitHubPROrchestrator,
  ) {}

  onModuleInit(): void {
    this.eventBus.on('openharness.code-ready', (event) => {
      void this.handle(event);
    });
  }

  async handle(event: OpenHarnessCodeReadyEvent): Promise<void> {
    const tag = `[${event.correlationId}]`;
    if (!event.projectId) {
      this.logger.warn(
        `${tag} code-ready for execution ${event.executionId} has no projectId — skipping delivery`,
      );
      return;
    }

    try {
      const result = await this.pushService.pushExecutionBranch({
        executionId: event.executionId,
        projectId: event.projectId,
        repoDir: event.repoDir,
        branch: event.branch,
        repositoryUrl: event.repositoryUrl,
      });

      if (!result.pushed) {
        this.logger.log(
          `${tag} No push for execution ${event.executionId} (${result.skippedReason})`,
        );
        return;
      }

      if (await this.requiresApproval(event.projectId)) {
        this.logger.log(
          `${tag} Branch pushed for execution ${event.executionId}; PR deferred until approval`,
        );
        return;
      }

      this.logger.log(
        `${tag} Approval not required — opening PR for execution ${event.executionId}`,
      );
      const pr = await this.prOrchestrator.createPullRequest(
        event.executionId,
        event.correlationId,
      );
      if (!pr.success) {
        this.logger.error(
          `${tag} PR creation failed for execution ${event.executionId}: ${pr.error}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${tag} Code delivery failed for execution ${event.executionId}: ${message}`,
      );
    }
  }

  /**
   * Effective approval policy: the per-project override wins when set, otherwise
   * the global default applies.
   */
  private async requiresApproval(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { require_pr_approval: true },
    });
    if (project?.require_pr_approval !== null && project?.require_pr_approval !== undefined) {
      return project.require_pr_approval;
    }
    return this.config.get<boolean>('github.requireApprovalForPr') ?? true;
  }
}
