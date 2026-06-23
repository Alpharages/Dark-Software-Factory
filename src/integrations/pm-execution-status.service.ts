import { Injectable, Logger } from '@nestjs/common';
import { PMProvider } from '@prisma/client';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMFieldAutoFillService, InferenceContext } from './pm-field-auto-fill.service';
import { PrismaService } from '@/database/prisma.service';

export enum ExecutionPhase {
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  QA_FAILED = 'QA_FAILED',
}

/**
 * PMExecutionStatusService
 *
 * Updates the ClickUp task status at key execution lifecycle points.
 *
 * Pre-condition strategy — two complementary layers:
 *
 *   Layer 1 — CS2 pipeline (generic, handles ANY required custom field):
 *     PMFieldPreCheckService  → discovers all missing required fields on the task
 *     PMFieldAutoFillService  → fills them (factual data first, then AI-inferred)
 *     This covers every custom field a workspace has marked as required, regardless
 *     of what they are. New required fields are handled automatically.
 *
 * Execution order:
 *   1. CS2 pipeline fills all missing required custom fields
 *   2. Status transition — phase maps to the closest live ClickUp status
 *
 * Always best-effort — never throws, never blocks execution.
 */
@Injectable()
export class PMExecutionStatusService {
  private readonly logger = new Logger(PMExecutionStatusService.name);

  constructor(
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly fieldPreCheck: PMFieldPreCheckService,
    private readonly fieldAutoFill: PMFieldAutoFillService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Update the ClickUp task to the status that best fits the execution phase.
   *
   * @param projectId    DSF project UUID
   * @param ticketId     Internal DSF ticket UUID (resolved to clickup_task_id internally)
   * @param phase        STARTED | COMPLETED | FAILED
   * @param correlationId For log tracing
   */
  async updateByPhase(
    projectId: string,
    ticketId: string,
    phase: ExecutionPhase,
    correlationId?: string,
  ): Promise<void> {
    const tag = correlationId ? `[${correlationId}] ` : '';

    try {
      // 1. Resolve the ClickUp external task ID from the internal DSF ticket UUID
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { clickup_task_id: true, title: true, description: true },
      });

      if (!ticket?.clickup_task_id) {
        this.logger.warn(`${tag}No clickup_task_id for ticket ${ticketId} — skipping`);
        return;
      }

      const clickupTaskId = ticket.clickup_task_id;

      // 2. Resolve the project's ClickUp OAuth integration
      const integration = await this.integrationService.findByProjectAndProvider(
        projectId,
        PMProvider.CLICKUP,
      );

      if (!integration) {
        this.logger.warn(`${tag}No CLICKUP integration for project ${projectId} — skipping`);
        return;
      }

      // 3. Get the provider (handles OAuth token refresh transparently)
      const provider = await this.providerFactory.getProvider(integration);

      // 4. Fetch the task — current status, listId, assignees
      const task = await provider.getTask(clickupTaskId);

      if (!task.listId) {
        this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping`);
        return;
      }

      // 5. Fetch the live workflow statuses for this list
      const statuses = await provider.getStatuses(task.listId);
      if (statuses.length === 0) {
        this.logger.warn(`${tag}No statuses found for list ${task.listId} — skipping`);
        return;
      }

      // ── LAYER 1: CS2 pipeline — fills ALL required custom fields ──────────────
      // This handles any required field the workspace has configured, regardless of
      // what it is. New required fields are covered automatically without code changes.
      await this.runFieldPreCheckPipeline({
        integration,
        clickupTaskId,
        listId: task.listId,
        taskTitle: ticket.title,
        taskDescription: ticket.description,
        tag,
        correlationId: correlationId ?? 'no-correlation',
      });
      // ─────────────────────────────────────────────────────────────────────────

      const targetStatus = this.statusForPhase(phase);
      const validTarget = statuses.find((s) => s.name.toLowerCase() === targetStatus);
      if (!validTarget) {
        this.logger.warn(`${tag}No status matching phase ${phase} in list — skipping`);
        return;
      }

      // 9. Apply the transition — all pre-conditions satisfied
      await provider.updateStatus(clickupTaskId, validTarget.name);

      this.logger.log(
        `${tag}ClickUp ${clickupTaskId}: '${task.status.name}' → '${validTarget.name}' (phase: ${phase})`,
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `${tag}Status update skipped for ticket ${ticketId} (phase: ${phase}): ${err.message}`,
      );
    }
  }

  private statusForPhase(phase: ExecutionPhase): string {
    switch (phase) {
      case ExecutionPhase.STARTED:
        return 'coding';
      case ExecutionPhase.COMPLETED:
        return 'pr ready';
      case ExecutionPhase.FAILED:
      case ExecutionPhase.QA_FAILED:
        return 'blocked';
    }
  }

  /**
   * Move ClickUp ticket to the project's configured qa_failure_status.
   * If qa_failure_status is not configured (field added by WR-4.2), logs a
   * warning and posts a configuration-gap comment instead — never throws.
   */
  async notifyQAFailure(
    projectId: string,
    ticketId: string,
    branchName: string | null,
    correlationId?: string,
  ): Promise<void> {
    const contextNote =
      `The AI agent exhausted all QA retries. The branch \`${branchName ?? 'unknown'}\` ` +
      `has been pushed but no PR was created.`;

    await this.moveTicketToConfiguredStatus(
      projectId,
      ticketId,
      'qa_failure_status',
      contextNote,
      correlationId,
    );
  }

  /**
   * Move ClickUp ticket to the project's configured code_review_status (WR-4.3).
   * Called after open_pr action creates a PR on the qa-failed branch.
   * If code_review_status is not configured, logs warning and posts config-gap comment — never throws.
   */
  async notifyCodeReview(
    projectId: string,
    ticketId: string,
    prUrl: string,
    correlationId?: string,
  ): Promise<void> {
    await this.moveTicketToConfiguredStatus(
      projectId,
      ticketId,
      'code_review_status',
      `Code review PR created: ${prUrl}`,
      correlationId,
    );
  }

  /**
   * Move ClickUp ticket to the project's configured manual_review_status (WR-4.3).
   * Called after cancel action. If manual_review_status not configured, logs warning — never throws.
   */
  async notifyCancel(projectId: string, ticketId: string, correlationId?: string): Promise<void> {
    await this.moveTicketToConfiguredStatus(
      projectId,
      ticketId,
      'manual_review_status',
      'Execution cancelled by PM — branch preserved for manual developer review.',
      correlationId,
    );
  }

  /**
   * Generic helper: read a configured status field from the Project model,
   * resolve the live ClickUp status ID, and apply the transition.
   * Logs a warning and posts a config-gap comment if the field is null — never throws.
   *
   * @param statusField  One of: 'qa_failure_status' | 'code_review_status' | 'manual_review_status'
   * @param contextNote  Included in the config-gap comment if status not configured
   */
  private async moveTicketToConfiguredStatus(
    projectId: string,
    ticketId: string,
    statusField: 'qa_failure_status' | 'code_review_status' | 'manual_review_status',
    contextNote: string,
    correlationId?: string,
  ): Promise<void> {
    const tag = correlationId ? `[${correlationId}] ` : '';
    try {
      // 1. Resolve clickup_task_id
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { clickup_task_id: true },
      });
      if (!ticket?.clickup_task_id) {
        this.logger.warn(`${tag}No clickup_task_id for ticket ${ticketId} — skipping`);
        return;
      }
      const clickupTaskId = ticket.clickup_task_id;

      // 2. Resolve integration
      const integration = await this.integrationService.findByProjectAndProvider(
        projectId,
        PMProvider.CLICKUP,
      );
      if (!integration) {
        this.logger.warn(`${tag}No CLICKUP integration for project ${projectId} — skipping`);
        return;
      }

      // 3. Get provider
      const provider = await this.providerFactory.getProvider(integration);

      // 4. Read configured status field from Project (WR-4.2 adds these fields)
      // Use explicit ternary to avoid indexed access strict mode issues
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      let configuredStatus: string | null = null;
      if (statusField === 'qa_failure_status') {
        configuredStatus = project?.qa_failure_status ?? null;
      } else if (statusField === 'code_review_status') {
        configuredStatus = project?.code_review_status ?? null;
      } else {
        configuredStatus = project?.manual_review_status ?? null;
      }

      if (!configuredStatus) {
        this.logger.warn(
          `${tag}Project ${projectId} has no ${statusField} configured — posting comment`,
        );
        await provider.addComment(
          clickupTaskId,
          `⚠️ **Status Transition Skipped — Configuration Gap**\n\n` +
            `${contextNote}\n\n` +
            `**Action required:** Configure \`${statusField}\` in project settings to enable automatic ClickUp status transitions.`,
        );
        return;
      }

      // 5. Runtime status discovery (no hardcoded IDs)
      const task = await provider.getTask(clickupTaskId);
      if (!task.listId) {
        this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping`);
        return;
      }
      const statuses = await provider.getStatuses(task.listId);
      const target = statuses.find((s) => s.name.toLowerCase() === configuredStatus.toLowerCase());
      if (!target) {
        this.logger.warn(
          `${tag}${statusField} '${configuredStatus}' not found in list statuses — skipping`,
        );
        return;
      }

      // 6. Apply transition
      await provider.updateStatus(clickupTaskId, target.name);
      this.logger.log(
        `${tag}ClickUp ${clickupTaskId}: '${task.status.name}' → '${target.name}' (${statusField})`,
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `${tag}Status transition skipped for ticket ${ticketId} [${statusField}]: ${err.message}`,
      );
    }
  }

  /**
   * Revert the ClickUp task to its pre-trigger status and post a failure comment.
   * Used when a sandbox crash or timeout is detected (no code pushed).
   *
   * @param projectId    DSF project UUID
   * @param ticketId     Internal DSF ticket UUID
   * @param failureReason Specific error message/category
   * @param correlationId For log tracing
   */
  async revertToPreTriggerStatus(
    projectId: string,
    ticketId: string,
    failureReason: string,
    correlationId?: string,
  ): Promise<void> {
    const tag = correlationId ? `[${correlationId}] ` : '';

    try {
      // 1. Resolve ticket
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { clickup_task_id: true },
      });

      if (!ticket?.clickup_task_id) {
        this.logger.warn(`${tag}No clickup_task_id for ticket ${ticketId} — skipping revert`);
        return;
      }

      const clickupTaskId = ticket.clickup_task_id;

      // 2. Resolve integration
      const integration = await this.integrationService.findByProjectAndProvider(
        projectId,
        PMProvider.CLICKUP,
      );

      if (!integration) {
        this.logger.warn(`${tag}No CLICKUP integration for project ${projectId} — skipping revert`);
        return;
      }

      // 3. Resolve ai_trigger_status
      if (!integration.ai_trigger_status) {
        this.logger.warn(
          `${tag}No ai_trigger_status configured for project ${projectId} — falling back to FAILED phase update`,
        );
        return this.updateByPhase(projectId, ticketId, ExecutionPhase.FAILED, correlationId);
      }

      // 4. Resolve provider
      const provider = await this.providerFactory.getProvider(integration);

      // 5. Status revert — requires listId; best-effort, does NOT block comment posting
      const task = await provider.getTask(clickupTaskId);
      if (!task.listId) {
        this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping status revert`);
      } else {
        // 6. Resolve target status ID
        const statuses = await provider.getStatuses(task.listId);
        const targetStatus = statuses.find(
          (s) => s.name.toLowerCase() === integration.ai_trigger_status?.toLowerCase(),
        );

        if (targetStatus) {
          // 7. Update status
          await provider.updateStatus(clickupTaskId, targetStatus.name);
          this.logger.log(
            `${tag}Reverted ticket ${clickupTaskId} to status '${targetStatus.name}'`,
          );
        } else {
          this.logger.warn(
            `${tag}Could not find status '${integration.ai_trigger_status}' in list ${task.listId} — skipping status revert`,
          );
        }
      }

      // 8. Add failure comment — always posted, independent of status revert (AC-3)
      const comment = [
        '⚠️ **Execution Failed — No Code Pushed**',
        '',
        `The agent did not complete. Reason: ${failureReason}`,
        '',
        'No branch was created and no code was pushed.',
      ].join('\n');

      await provider.addComment(clickupTaskId, comment);
      this.logger.log(`${tag}Posted failure comment to ticket ${clickupTaskId}`);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `${tag}Failed to revert pre-trigger status for ticket ${ticketId}: ${err.message}`,
      );
    }
  }

  /**
   * Resolve the workspace owner's provider user ID.
   * Calls getSelf() — the authenticated OAuth user — as the fallback when
   * bot_user_id is not stored on the integration record.
   * Returns null and logs a warning on any error.
   */
  private async resolveWorkspaceOwner(
    provider: import('./providers/pm-provider.interface').IPMProvider,
    tag: string,
  ): Promise<string | null> {
    try {
      const self = await provider.getSelf();
      this.logger.log(`${tag}Using workspace owner ${self.name} (${self.id}) as fallback assignee`);
      return self.id;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${tag}Could not fetch workspace owner for assignee fallback: ${msg}`);
      return null;
    }
  }

  /**
   * CS2 required-field pipeline.
   * Discovers all missing required custom fields and fills them via factual
   * rules then AI inference. Best-effort — never throws.
   */
  private async runFieldPreCheckPipeline(opts: {
    integration: Parameters<PMFieldPreCheckService['checkRequiredFields']>[0];
    clickupTaskId: string;
    listId: string;
    taskTitle: string;
    taskDescription: string;
    tag: string;
    correlationId: string;
  }): Promise<void> {
    try {
      const preCheck = await this.fieldPreCheck.checkRequiredFields(
        opts.integration,
        opts.clickupTaskId,
        opts.listId,
        opts.correlationId,
      );

      if (preCheck.allFilled || preCheck.preCheckFailed) return;

      this.logger.log(
        `${opts.tag}CS2: ${preCheck.missingFields.length} required field(s) missing — auto-filling`,
      );

      // Factual fill (PR URL, duration, dates, etc.)
      const factualResult = await this.fieldAutoFill.fillFactualFields(
        opts.integration,
        opts.clickupTaskId,
        preCheck.missingFields,
        {}, // ExecutionContext — no deployment data at this point; factual fill will skip what it can't resolve
        opts.correlationId,
      );

      // AI-inferred fill for whatever remains
      if (factualResult.remainingFields.length > 0) {
        const inferenceCtx: InferenceContext = {
          ticketTitle: opts.taskTitle,
          ticketDescription: opts.taskDescription,
        };

        await this.fieldAutoFill.fillInferredFields(
          opts.integration,
          opts.clickupTaskId,
          factualResult.remainingFields,
          inferenceCtx,
          opts.correlationId,
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${opts.tag}CS2 pipeline failed (continuing): ${msg}`);
    }
  }
}
