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

/** Non-fatal error-metric label recorded when a ticket trips the loop-cap safety valve. */
const LOOP_CAP_EXCEEDED_METRIC = 'dispatcher_loop_cap_exceeded';

/** Non-fatal error-metric label recorded when opening the approval gate fails. */
const OPEN_GATE_FAILED_METRIC = 'dispatcher_open_gate_failed';

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
        | 'loop-cap-exceeded'
        | 'error';
      executionId?: string;
      error?: string;
      skill?: string;
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

    const activeExecution = await this.prisma.execution.findFirst({
      where: {
        ticket: { clickup_task_id: event.externalId },
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });

    if (activeExecution) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: active execution ${activeExecution.id} for ${event.externalId}`,
      );
      return {
        dispatched: false,
        reason: 'active-execution',
        executionId: activeExecution.id,
      };
    }

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
