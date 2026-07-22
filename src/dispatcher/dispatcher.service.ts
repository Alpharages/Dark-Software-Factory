import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus, PMProvider } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ApprovalGateService } from '@/approval-gate/approval-gate.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { normalizeStatus } from '@/config/status-skill-map.config';
import { OpenHarnessRunnerService } from '@/openharness/openharness-runner.service';
import { OpenHarnessSkill, openHarnessSkillPrompt } from '@/openharness/skills.enum';
import { StatusSkillMapService } from '@/openharness/status-skill-map.service';
import { ITaskEvent, TaskProviderType } from '@/ticket-intake/dto';
import { DependencyGateService } from './dependency-gate.service';
import { ExecutionConcurrencyGate } from './execution-concurrency.gate';

/** Non-fatal error-metric label recorded when a ticket trips the loop-cap safety valve. */
const LOOP_CAP_EXCEEDED_METRIC = 'dispatcher_loop_cap_exceeded';

/** Non-fatal error-metric label recorded when opening the approval gate fails. */
const OPEN_GATE_FAILED_METRIC = 'dispatcher_open_gate_failed';
const DEPENDENCY_GATE_FAILED_METRIC = 'dispatcher_dependency_gate_failed';

/**
 * Debounce window for suppressing duplicate same-skill dispatches of one ticket.
 * Covers the fast-fail gap (a run that errors in ms never occupies QUEUED/
 * IN_PROGRESS, so the status guard alone lets rapid duplicate events re-spawn).
 * 60s comfortably spans a burst of duplicate webhook/poll events while staying
 * far below the minutes-apart cadence of any legitimate loopback re-run.
 * ponytail: fixed window; make it configurable if real re-runs ever land inside it.
 */
const DUPLICATE_DISPATCH_DEBOUNCE_MS = 60_000;

export type DispatchResult =
  | { dispatched: true; executionId: string; skill: string }
  | {
      dispatched: false;
      reason:
        | 'missing-status'
        | 'ticket-not-found'
        | 'no-mapping'
        | 'loop-complete'
        | 'awaiting-approval'
        | 'active-execution'
        | 'blocked'
        | 'loop-cap-exceeded'
        | 'execution-not-found'
        | 'not-retryable'
        | 'error';
      executionId?: string;
      error?: string;
      skill?: string;
      unresolved?: string[];
    };

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  /**
   * In-process per-ticket dispatch lock. The DB active-execution check
   * (`findFirst` → `runForTicket` create) is not atomic: two concurrent
   * dispatches for the SAME status event both pass the check before either
   * creates a row, yielding a double-dispatch (OHP-2.6 idempotency finding —
   * reproduced when the poller delivered duplicate task messages). This set
   * serialises dispatch per external task id within the instance; a held entry
   * means a run is already in flight, so the duplicate is skipped. Single-tenant
   * MVP scope — a multi-instance deployment additionally needs a DB-level guard.
   */
  private readonly inFlightTickets = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly statusSkillMap: StatusSkillMapService,
    private readonly runner: OpenHarnessRunnerService,
    private readonly configService: ConfigService,
    // forwardRef: the gate feeds REJECT/REWORK back into `redispatchImplement`,
    // so dispatcher ⇄ gate is a deliberate cycle.
    @Inject(forwardRef(() => ApprovalGateService))
    private readonly approvalGate: ApprovalGateService,
    private readonly dependencyGate: DependencyGateService,
    private readonly concurrencyGate: ExecutionConcurrencyGate,
    // Optional so a missing metrics provider never breaks fire-and-forget dispatch,
    // and the service stays trivially constructable in unit tests.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async dispatch(event: ITaskEvent): Promise<DispatchResult> {
    const status = event.originalProviderStatus;
    if (!status) {
      this.logger.debug(`[${event.correlationId}] Dispatch skipped: missing provider status`);
      return { dispatched: false, reason: 'missing-status' };
    }

    // Atomically claim this task so a concurrent duplicate event cannot race past
    // the (non-atomic) active-execution check below. Held until dispatch resolves,
    // which — because dispatch awaits the full run — spans the entire execution.
    if (this.inFlightTickets.has(event.externalId)) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: dispatch already in flight for ${event.externalId}`,
      );
      return { dispatched: false, reason: 'active-execution' };
    }
    this.inFlightTickets.add(event.externalId);
    try {
      return await this.dispatchInner(event, status);
    } finally {
      this.inFlightTickets.delete(event.externalId);
    }
  }

  private async dispatchInner(event: ITaskEvent, status: string): Promise<DispatchResult> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { clickup_task_id: event.externalId },
      select: {
        id: true,
        project: {
          select: {
            integrations: {
              where: this.providerWhere(event),
              select: { provider: true, ai_trigger_status: true },
            },
            id: true,
          },
        },
      },
    });

    if (!ticket) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: no ticket for ${event.externalId}`,
      );
      return { dispatched: false, reason: 'ticket-not-found' };
    }

    const mappedSkill = await this.statusSkillMap.resolveSkill(status, ticket.project.id);
    const skill =
      mappedSkill ??
      (this.isProjectTrigger(status, ticket.project.integrations[0]?.ai_trigger_status)
        ? this.requiredConfig('openharness.defaultSkill')
        : null);

    if (!skill) {
      if (this.statusSkillMap.isLoopTerminal(status)) {
        const execution = await this.prisma.execution.findFirst({
          where: { ticket_id: ticket.id },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        });

        if (execution) {
          // Gate-open runs off the webhook-driven path: errors must be logged +
          // recorded, never rethrown into the synchronous 200 path (AC9 / OHP-2.2
          // fire-and-forget). `dispatch` keeps its never-throw contract.
          try {
            await this.approvalGate.openGate(execution.id, event.correlationId);
            return { dispatched: false, reason: 'awaiting-approval', executionId: execution.id };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `[${event.correlationId}] Failed to open approval gate for ${event.externalId} (${execution.id}): ${message}`,
              error instanceof Error ? error.stack : undefined,
            );
            this.metrics?.incrementErrors(OPEN_GATE_FAILED_METRIC);
            return {
              dispatched: false,
              reason: 'error',
              error: message,
              executionId: execution.id,
            };
          }
        }

        this.logger.log(
          `[${event.correlationId}] Dispatch loop complete for ${event.externalId} status ${status}`,
        );
        return { dispatched: false, reason: 'loop-complete' };
      }

      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: no skill mapping for ${event.externalId} status ${status}`,
      );
      return { dispatched: false, reason: 'no-mapping' };
    }

    // Duplicate guard. A QUEUED/IN_PROGRESS run means one is live. But a run that
    // fails FAST (e.g. NoEligibleAccountError → row created FAILED in ms) never
    // occupies those states, so rapid duplicate events for the same ticket+skill
    // each slip past and spawn another execution (observed: 3 code-reviews 86ms
    // apart). So also suppress a re-dispatch when the SAME skill was dispatched
    // for this ticket within the debounce window, whatever its status — no
    // legitimate re-run of one skill happens twice within seconds (loopbacks are
    // minutes apart). Kept as one query so it's a single round-trip.
    const activeExecution = await this.prisma.execution.findFirst({
      where: {
        ticket: { clickup_task_id: event.externalId },
        OR: [
          { status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] } },
          {
            ai_provider: AIProvider.OPENHARNESS,
            prompt: openHarnessSkillPrompt(skill),
            created_at: { gte: new Date(Date.now() - DUPLICATE_DISPATCH_DEBOUNCE_MS) },
          },
        ],
      },
      select: { id: true },
    });

    if (activeExecution) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: active or recently-dispatched execution ${activeExecution.id} for ${event.externalId}`,
      );
      return {
        dispatched: false,
        reason: 'active-execution',
        executionId: activeExecution.id,
      };
    }

    const blocked = await this.checkDependencyGate(ticket.id, event.correlationId, skill);
    if (blocked) return blocked;

    if (mappedSkill === OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT) {
      // Safety valve against unbounded ping-pong (e.g. changes-requested ⇄ re-implement).
      // `loopMaxIterations` caps the TOTAL implement runs per ticket — the initial
      // trigger-initiated run plus every loopback (all share this prompt). So the
      // default of 5 permits the first implement plus 4 re-implements before the
      // valve trips. The prompt predicate is the shared `openHarnessSkillPrompt`
      // helper the runner writes, so the count can never silently drift to zero.
      const loopCount = await this.prisma.execution.count({
        where: {
          ticket_id: ticket.id,
          ai_provider: AIProvider.OPENHARNESS,
          prompt: openHarnessSkillPrompt(skill),
        },
      });

      if (loopCount >= this.statusSkillMap.loopMaxIterations) {
        // Flag the ticket: warn log (carries the task id) + a durable, queryable
        // metric signal — the AC7 "recorded non-fatal signal", not a thrown error.
        this.logger.warn(
          `[${event.correlationId}] Dispatch skipped: loop cap exceeded for ${event.externalId} (${loopCount}/${this.statusSkillMap.loopMaxIterations})`,
        );
        this.metrics?.incrementErrors(LOOP_CAP_EXCEEDED_METRIC);
        return { dispatched: false, reason: 'loop-cap-exceeded', skill };
      }
    }

    // Per-project concurrency cap (§3.5). Waits for a free slot rather than
    // dropping the ticket — the global cap is RabbitMQ prefetch, which bounds
    // how many dispatches can be parked here at once.
    const releaseSlot = await this.concurrencyGate.acquire(ticket.project.id);
    try {
      const executionId = await this.runner.runForTicket(ticket.id, {
        skill,
        workspaceDir: this.requiredConfig('openharness.workspaceDir'),
      });
      this.logger.log(
        `[${event.correlationId}] Dispatched ${event.externalId} to OpenHarness skill ${skill} (${executionId})`,
      );
      return { dispatched: true, executionId, skill };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${event.correlationId}] Dispatch failed for ${event.externalId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { dispatched: false, reason: 'error', error: message, skill };
    } finally {
      releaseSlot();
    }
  }

  /**
   * Guarded re-dispatch of the implement skill for a ticket. Applies the same
   * active-execution and loop-cap safety valves as the status-driven dispatch
   * path, so callers — notably the approval gate's REJECT/REWORK loop-back —
   * feed the existing loop instead of forking an unguarded run. Never throws:
   * returns a `DispatchResult` describing the outcome.
   */
  async redispatchImplement(ticketId: string, correlationId: string): Promise<DispatchResult> {
    if (this.inFlightTickets.has(ticketId)) {
      this.logger.debug(
        `[${correlationId}] Re-dispatch skipped: dispatch already in flight for ticket ${ticketId}`,
      );
      return { dispatched: false, reason: 'active-execution' };
    }
    this.inFlightTickets.add(ticketId);
    try {
      return await this.redispatchImplementInner(ticketId, correlationId);
    } finally {
      this.inFlightTickets.delete(ticketId);
    }
  }

  private async redispatchImplementInner(
    ticketId: string,
    correlationId: string,
  ): Promise<DispatchResult> {
    const skill = OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT;

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, project_id: true },
    });
    if (!ticket) {
      return { dispatched: false, reason: 'ticket-not-found' };
    }

    const activeExecution = await this.prisma.execution.findFirst({
      where: {
        ticket_id: ticketId,
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });
    if (activeExecution) {
      this.logger.debug(
        `[${correlationId}] Re-dispatch skipped: active execution ${activeExecution.id} for ticket ${ticketId}`,
      );
      return { dispatched: false, reason: 'active-execution', executionId: activeExecution.id };
    }

    const blocked = await this.checkDependencyGate(ticketId, correlationId, skill);
    if (blocked) return blocked;

    const loopCount = await this.prisma.execution.count({
      where: {
        ticket_id: ticketId,
        ai_provider: AIProvider.OPENHARNESS,
        prompt: openHarnessSkillPrompt(skill),
      },
    });
    if (loopCount >= this.statusSkillMap.loopMaxIterations) {
      this.logger.warn(
        `[${correlationId}] Re-dispatch skipped: loop cap exceeded for ticket ${ticketId} (${loopCount}/${this.statusSkillMap.loopMaxIterations})`,
      );
      this.metrics?.incrementErrors(LOOP_CAP_EXCEEDED_METRIC);
      return { dispatched: false, reason: 'loop-cap-exceeded', skill };
    }

    // Honour the per-project Max Concurrent Executions cap on this path too, so
    // a loopback/retry re-dispatch can't run past the limit that the initial
    // status-driven dispatch (and every code-review/QA run) already respects.
    const releaseSlot = await this.concurrencyGate.acquire(ticket.project_id);
    try {
      const executionId = await this.runner.runForTicket(ticketId, {
        skill,
        workspaceDir: this.requiredConfig('openharness.workspaceDir'),
      });
      this.logger.log(
        `[${correlationId}] Re-dispatched ticket ${ticketId} to OpenHarness skill ${skill} (${executionId})`,
      );
      return { dispatched: true, executionId, skill };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${correlationId}] Re-dispatch failed for ticket ${ticketId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { dispatched: false, reason: 'error', error: message, skill };
    } finally {
      releaseSlot();
    }
  }

  /**
   * Retry a finished execution by re-running the implement skill for its ticket.
   *
   * Only terminal executions are retryable — a QUEUED/IN_PROGRESS/PAUSED run is
   * still live and `redispatchImplement`'s own active-execution guard would
   * reject it anyway; we reject here first so the caller gets a clear reason.
   * The retry creates a fresh execution; the old row is left as history.
   */
  async retryExecution(executionId: string, correlationId: string): Promise<DispatchResult> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { ticket_id: true, status: true, error_context: true },
    });
    if (!execution) {
      return { dispatched: false, reason: 'execution-not-found' };
    }

    // A PAUSED-awaiting-input run also retries by re-dispatch: the agent stopped
    // to ask a question, and re-running is how it picks up the answer (the
    // container-resume path is a no-op and would strand it — the exact bug the
    // manual Resume button hit). Everything else is only retryable once terminal.
    const awaitingInput = execution.error_context?.includes('"awaitingInput":true') ?? false;
    // EMERGENCY_STOPPED is deliberately NOT retryable: it's an operator's manual
    // kill, so auto/loopback retry must not resurrect it (only an explicit new
    // dispatch should).
    const terminalRetryable: ExecutionStatus[] = [
      ExecutionStatus.FAILED,
      ExecutionStatus.TIMEOUT,
      ExecutionStatus.CANCELLED,
    ];
    const retryable =
      terminalRetryable.includes(execution.status) ||
      (execution.status === ExecutionStatus.PAUSED && awaitingInput);
    if (!retryable) {
      return { dispatched: false, reason: 'not-retryable' };
    }

    // Clear the awaiting-input marker before re-dispatch so the poller can't also
    // fire on the same row — the fresh run owns the lifecycle from here.
    if (awaitingInput) {
      await this.prisma.execution.update({
        where: { id: executionId },
        data: { error_context: null },
      });
    }

    return this.redispatchImplement(execution.ticket_id, correlationId);
  }

  async releaseDependencyHold(ticketRef: string, correlationId: string): Promise<DispatchResult> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { OR: [{ id: ticketRef }, { clickup_task_id: ticketRef }] },
      select: { id: true },
    });

    if (!ticket) {
      return { dispatched: false, reason: 'ticket-not-found' };
    }

    return this.redispatchImplement(ticket.id, correlationId);
  }

  private async checkDependencyGate(
    ticketId: string,
    correlationId: string,
    skill: string,
  ): Promise<DispatchResult | null> {
    try {
      const result = await this.dependencyGate.check(ticketId);
      if (!result.blocked) return null;

      await this.dependencyGate.markBlocked(ticketId, result);
      return {
        dispatched: false,
        reason: 'blocked',
        unresolved: result.unresolved,
        skill,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${correlationId}] Dependency gate failed for ticket ${ticketId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.metrics?.incrementErrors(DEPENDENCY_GATE_FAILED_METRIC);
      return { dispatched: false, reason: 'error', error: message, skill };
    }
  }

  private providerWhere(event: ITaskEvent): { provider?: PMProvider } {
    if (event.providerType === TaskProviderType.CLICKUP) {
      return { provider: PMProvider.CLICKUP };
    }
    return {};
  }

  private isProjectTrigger(status: string, triggerStatus: string | null | undefined): boolean {
    return !!triggerStatus && normalizeStatus(status) === normalizeStatus(triggerStatus);
  }

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value;
  }
}
