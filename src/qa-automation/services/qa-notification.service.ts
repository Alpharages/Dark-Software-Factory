import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { RealtimeService } from '@/realtime/realtime.service';
import {
  GateType,
  QaFailureSeverity,
  QaGateFailedEvent,
  QaAllGatesFailedEvent,
  QaGateBlockedEvent,
  LintingFailureDetails,
  TestFailureDetails,
  CoverageFailureDetails,
  SecurityFailureDetails,
  ComplexityFailureDetails,
} from '@/realtime/realtime.types';

// Metrics constants
// Note: We need to register these in the module
const METRIC_NOTIFICATIONS_EMITTED = 'qa_notifications_emitted_total';
const METRIC_EMISSION_ERRORS = 'qa_notification_emission_errors_total';

interface ExecutionWithTicket {
  id: string;
  ticketId: string;
  ticket?: {
    projectId: string | null;
    project?: {
      pm_id: string | null;
    } | null;
  } | null;
}

type FailureDetails =
  | LintingFailureDetails
  | TestFailureDetails
  | CoverageFailureDetails
  | SecurityFailureDetails
  | ComplexityFailureDetails
  | Record<string, unknown>;

@Injectable()
export class QaNotificationService {
  private readonly logger = new Logger(QaNotificationService.name);

  constructor(
    @Optional() private readonly realtimeService?: RealtimeService,
    @InjectMetric(METRIC_NOTIFICATIONS_EMITTED)
    private readonly notificationsCounter?: Counter<string>,
    @InjectMetric(METRIC_EMISSION_ERRORS)
    private readonly emissionErrorsCounter?: Counter<string>,
  ) {}

  /**
   * Emit event when a single quality gate fails
   */
  async emitGateFailed(
    execution: ExecutionWithTicket,
    gateType: GateType,
    failureDetails: FailureDetails,
    severity: QaFailureSeverity,
  ): Promise<void> {
    if (!this.realtimeService) {
      this.logger.warn('RealtimeService not available, skipping QA notification');
      return;
    }

    const payload: QaGateFailedEvent = {
      executionId: execution.id,
      ticketId: execution.ticketId,
      projectId: execution.ticket?.projectId || null,
      gateType,
      failureDetails,
      severity,
      failedAt: new Date(),
    };

    await this.emitToTargetRooms(execution, 'qa.gate_failed', payload, severity);

    this.safeIncrementCounter(this.notificationsCounter, { gate_type: gateType, severity });
  }

  /**
   * Emit event when multiple quality gates fail (aggregated)
   */
  async emitAllGatesFailed(
    execution: ExecutionWithTicket,
    failedGates: Array<{
      gateType: GateType;
      failureDetails: FailureDetails;
      severity: QaFailureSeverity;
    }>,
    summary: {
      totalFailures: number;
      criticalCount: number;
      highCount: number;
      mediumCount: number;
      lowCount: number;
    },
  ): Promise<void> {
    if (!this.realtimeService) return;

    const payload: QaAllGatesFailedEvent = {
      executionId: execution.id,
      ticketId: execution.ticketId,
      projectId: execution.ticket?.projectId || null,
      failedGates,
      summary,
      failedAt: new Date(),
    };

    // Use highest severity logic for routing
    let overallSeverity: QaFailureSeverity = 'LOW';
    if (summary.criticalCount > 0) overallSeverity = 'CRITICAL';
    else if (summary.highCount > 0) overallSeverity = 'HIGH';
    else if (summary.mediumCount > 0) overallSeverity = 'MEDIUM';

    // Check for security failures in the aggregated list
    const hasSecurityFailures = failedGates.some((g) => g.gateType === 'SECURITY');

    await this.emitToTargetRooms(
      execution,
      'qa.all_gates_failed',
      { ...payload, hasSecurityFailures }, // Pass flag for routing
      overallSeverity,
    );

    this.safeIncrementCounter(this.notificationsCounter, {
      gate_type: 'AGGREGATED',
      severity: overallSeverity,
    });
  }

  /**
   * Emit event when quality gate blocks deployment/merge
   */
  async emitGateBlocked(
    execution: ExecutionWithTicket,
    blockedBy: GateType[],
    canOverride: boolean,
    overrideRoles: string[],
  ): Promise<void> {
    if (!this.realtimeService) return;

    const payload: QaGateBlockedEvent = {
      executionId: execution.id,
      ticketId: execution.ticketId,
      projectId: execution.ticket?.projectId || null,
      blockedBy,
      canOverride,
      overrideRoles,
      blockedAt: new Date(),
    };

    await this.emitToTargetRooms(execution, 'qa.gate_blocked', payload, 'HIGH');

    this.safeIncrementCounter(this.notificationsCounter, {
      gate_type: 'BLOCKED',
      severity: 'HIGH',
    });
  }

  /**
   * Route notification to appropriate rooms based on severity and role
   */
  private async emitToTargetRooms(
    execution: ExecutionWithTicket,
    event: string,
    payload: unknown,
    severity: QaFailureSeverity,
  ): Promise<void> {
    if (!this.realtimeService) return;

    const projectId = execution.ticket?.projectId;
    const pmId = execution.ticket?.project?.pm_id;

    try {
      // 1. Notify Assigned PM
      if (typeof pmId === 'string') {
        // Fire and forget
        this.realtimeService.emitToUser(pmId, event, payload);
      }

      // 2. Notify Project Room
      if (projectId) {
        this.realtimeService.emitToProject(projectId, event, payload);
      } else {
        // Fallback if no project context
        this.realtimeService.emitToRole('ADMIN', event, payload);
      }

      // 3. Notify Lead QA (Always)
      this.realtimeService.emitToRole('LEAD_QA', event, payload);

      // 4. Escalation rules
      if (severity === 'CRITICAL') {
        this.realtimeService.emitToRole('MANAGER', event, payload);
      }

      // 5. Security Routing Logic
      let notifyAdmin = false;

      // Check for single gate failure
      if (
        payload &&
        typeof payload === 'object' &&
        'gateType' in payload &&
        (payload as { gateType?: unknown }).gateType === 'SECURITY'
      ) {
        notifyAdmin = true;
      }

      // Check for aggregated failure with security flag
      if (
        payload &&
        typeof payload === 'object' &&
        'hasSecurityFailures' in payload &&
        (payload as { hasSecurityFailures?: boolean }).hasSecurityFailures === true
      ) {
        notifyAdmin = true;
      }

      if (notifyAdmin) {
        this.realtimeService.emitToRole('ADMIN', event, payload);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit QA notification ${event}: ${errorMessage}`);
      this.safeIncrementCounter(this.emissionErrorsCounter, {
        event,
        reason: 'emission_failed',
      });
    }
  }

  private safeIncrementCounter(
    counter: Counter<string> | undefined,
    labels: Record<string, string | number>,
  ): void {
    try {
      if (counter) {
        counter.inc(labels);
      }
    } catch (_e) {
      // Ignore metric errors to prevent logic breakage
    }
  }
}
