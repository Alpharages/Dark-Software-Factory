import { Injectable, Logger } from '@nestjs/common';
import { PMProvider } from '@prisma/client';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMFieldAutoFillService, InferenceContext } from './pm-field-auto-fill.service';
import { AgentSkillRunner } from '@/ai-routing/agent-skills/agent-skill-runner.service';
import {
  ClickUpStatusSkill,
  IClickUpStatusSkillContext,
} from '@/ai-routing/agent-skills/skills/clickup-status.skill';
import { ExecutionPhase } from '@/ai-routing/agent-skills/skills/execution-phase.enum';
import { PrismaService } from '@/database/prisma.service';

export { ExecutionPhase };

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
 *   Layer 2 — Skill flags (handles core ClickUp field automation rules):
 *     ClickUpStatusSkill returns needsAssignee / needsDueDate / needsTimeEstimate.
 *     These are core task fields (not custom fields) that common automation rules
 *     block status transitions on. The skill reasons about whether they're needed
 *     based on the task's current state and the target status.
 *
 * Execution order:
 *   1. CS2 pipeline fills all missing required custom fields
 *   2. Skill sets core field pre-conditions (assignee, due date, estimate)
 *   3. Status transition — all automation conditions satisfied
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
    private readonly skillRunner: AgentSkillRunner,
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

      // 6. Build skill context with task's current state
      const skillContext: IClickUpStatusSkillContext = {
        taskName: task.name,
        currentStatus: task.status.name,
        availableStatuses: statuses.map((s) => s.name),
        phase,
        hasAssignee: (task.assignees?.length ?? 0) > 0,
        hasDueDate: !!task.dueDate,
        hasTimeEstimate: false, // not in NormalizedTask; skill defaults to checking
      };

      // 7. Run the AI skill — selects target status AND core field pre-conditions
      const skill = new ClickUpStatusSkill();
      const result = await this.skillRunner.run(skill, skillContext, correlationId);

      if (!result) {
        this.logger.warn(`${tag}Skill returned no result for phase ${phase} — skipping`);
        return;
      }

      // 8. Validate skill's status choice against the live list (hallucination guard)
      const validTarget = statuses.find((s) => s.name.toLowerCase() === result.value.toLowerCase());
      if (!validTarget) {
        this.logger.warn(
          `${tag}Skill selected '${result.value}' which is not in the status list — skipping`,
        );
        return;
      }

      // ── LAYER 2: Core field pre-conditions from the skill decision ─────────────
      // Handles ClickUp core fields (assignee, due_date, time_estimate) that
      // automation rules commonly require but aren't in the required-fields API.
      const decision = ClickUpStatusSkill.decodeDecision(result);
      if (decision) {
        const prepOpts: Parameters<typeof provider.prepareForTransition>[1] = {};

        if (decision.needsAssignee) {
          // Prefer the stored bot user ID (set during OAuth). If missing,
          // fetch the workspace owner (the user who authorized the OAuth app)
          // as the fallback assignee so automation rules are satisfied.
          const assigneeId =
            integration.bot_user_id ?? (await this.resolveWorkspaceOwner(provider, tag));
          if (assigneeId) {
            prepOpts.assigneeId = assigneeId;
          }
        }
        if (decision.needsDueDate) {
          prepOpts.dueDateMs = Date.now() + 48 * 60 * 60 * 1000; // +48h
        }
        if (decision.needsTimeEstimate) {
          prepOpts.timeEstimateMs = 2 * 60 * 60 * 1000; // 2h
        }

        if (Object.keys(prepOpts).length > 0) {
          this.logger.log(`${tag}Setting core pre-conditions: ${Object.keys(prepOpts).join(', ')}`);
          await provider.prepareForTransition(clickupTaskId, prepOpts);
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

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

  /**
   * Move ClickUp ticket to the project's configured qa_failure_status.
   * If qa_failure_status is not configured (field added by WR-4.2), logs a
   * warning and posts a configuration-gap comment instead — never throws.
   *
   * @param projectId     DSF project UUID
   * @param ticketId      Internal DSF ticket UUID
   * @param branchName    The pushed feature branch (included in comment)
   * @param correlationId For log tracing
   */
  async notifyQAFailure(
    projectId: string,
    ticketId: string,
    branchName: string | null,
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

      // 4. Read qa_failure_status from project settings (added by WR-4.2).
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      const qaFailureStatus = project?.qa_failure_status ?? null;

      if (!qaFailureStatus) {
        // AC-4: Not configured — warn + post comment, never throw
        this.logger.warn(
          `${tag}Project ${projectId} has no qa_failure_status configured — posting comment`,
        );
        const gapComment =
          `⚠️ **QA Failure — Configuration Gap**\n\n` +
          `The AI agent exhausted all QA retries. The branch \`${branchName ?? 'unknown'}\` has been pushed but no PR was created.\n\n` +
          `**Action required:** Configure \`qa_failure_status\` in project settings so this ticket can be moved to the correct ClickUp status automatically.`;
        await provider.addComment(clickupTaskId, gapComment);
        return;
      }

      // 5. Runtime discovery — resolve qa_failure_status name to a live status (hallucination guard)
      const task = await provider.getTask(clickupTaskId);
      if (!task.listId) {
        this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping`);
        return;
      }
      const statuses = await provider.getStatuses(task.listId);
      const target = statuses.find((s) => s.name.toLowerCase() === qaFailureStatus.toLowerCase());
      if (!target) {
        this.logger.warn(
          `${tag}qa_failure_status '${qaFailureStatus}' not found in list statuses — skipping`,
        );
        return;
      }

      // 6. Apply transition
      await provider.updateStatus(clickupTaskId, target.name);
      this.logger.log(
        `${tag}ClickUp ${clickupTaskId}: '${task.status.name}' → '${target.name}' (QA_FAILED)`,
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `${tag}QA failure notification skipped for ticket ${ticketId}: ${err.message}`,
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
