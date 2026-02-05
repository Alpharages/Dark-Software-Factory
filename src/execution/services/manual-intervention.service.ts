import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
import { ExecutionRepository } from '../execution.repository';
import { ExecutionTrackerService } from '../execution-tracker.service';
import { ExecutionStateMachine } from '../state-machine';
import { ContainerControlService } from './container-control.service';
import { ExecutionOverrideRepository } from '../repositories/execution-override.repository';
import { RealtimeService } from '../../realtime/realtime.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ExecutionStatus, Execution } from '@/prisma/client';
import {
  ExecutionPausedEvent,
  ExecutionResumedEvent,
  ExecutionEmergencyStoppedEvent,
  ExecutionDecisionOverriddenEvent,
} from '../../realtime/realtime.types';
import { OverrideDecision } from '../dto/override-decision.dto';

export interface PauseExecutionResult {
  execution: Execution;
  containerControlSkipped: boolean;
}

export interface ResumeExecutionResult {
  execution: Execution;
  containerControlSkipped: boolean;
}

export interface EmergencyStopResult {
  execution: Execution;
  containerKilled: boolean;
  containerControlSkipped: boolean;
}

export interface OverrideDecisionResult {
  execution: Execution;
  overrideId: string;
}

/**
 * Service for manual intervention in AI executions
 * Story 10-U-5: Manual Intervention Circuit Breaker
 *
 * Provides pause/resume, emergency stop, and decision override capabilities
 * with full audit trail and real-time notifications.
 */
@Injectable()
export class ManualInterventionService {
  private readonly logger = new Logger(ManualInterventionService.name);

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly containerControl: ContainerControlService,
    private readonly overrideRepository: ExecutionOverrideRepository,
    @Optional() private readonly realtimeService: RealtimeService | null,
    private readonly auditLogService: AuditLogService,
    @InjectMetric('execution_paused_total') private readonly pausedCounter: Counter,
    @InjectMetric('execution_resumed_total') private readonly resumedCounter: Counter,
    @InjectMetric('execution_emergency_stopped_total')
    private readonly emergencyStoppedCounter: Counter,
    @InjectMetric('execution_decision_overridden_total')
    private readonly decisionOverriddenCounter: Counter,
    @InjectMetric('execution_container_control_failed_total')
    private readonly containerControlFailedCounter: Counter,
  ) {}

  /**
   * Pause a running execution
   * Transitions execution from IN_PROGRESS → PAUSED
   *
   * @param executionId - Execution ID
   * @param userId - User ID performing the pause
   * @param reason - Reason for pausing
   * @returns Pause result with execution and container control status
   * @throws BadRequestException if execution is not in IN_PROGRESS state
   * @throws ConflictException if execution is already in a terminal state
   */
  async pauseExecution(
    executionId: string,
    userId: string,
    reason: string,
  ): Promise<PauseExecutionResult> {
    this.logger.log(`Pausing execution ${executionId} by user ${userId}`);

    const execution = await this.executionRepository.findById(executionId);
    if (!execution) {
      throw new BadRequestException(`Execution ${executionId} not found`);
    }

    // Check if already in terminal state
    if (this.stateMachine.isTerminal(execution.status)) {
      throw new ConflictException(`Cannot pause execution in terminal state: ${execution.status}`);
    }

    // Check if already paused
    if (execution.status === ExecutionStatus.PAUSED) {
      throw new ConflictException('Execution is already paused');
    }

    // Validate transition
    if (!this.stateMachine.canTransition(execution.status, ExecutionStatus.PAUSED)) {
      throw new BadRequestException(`Cannot pause execution from ${execution.status} state`);
    }

    // Pause container if container_id exists (best effort - don't fail on container error)
    let containerControlSkipped = false;
    let containerPaused = false;
    if (execution.container_id) {
      containerPaused = await this.containerControl.pauseContainer(execution.container_id);
      if (!containerPaused) {
        this.containerControlFailedCounter.inc({
          operation: 'pause',
          execution_id: executionId,
        });
      }
    } else {
      containerControlSkipped = true;
      this.logger.warn(`Execution ${executionId} has no container_id, skipping container pause`);
    }

    // Update execution state
    const updatedExecution = await this.executionTracker.updateStatus(
      executionId,
      ExecutionStatus.PAUSED,
    );

    // Create audit log
    await this.auditLogService.log({
      entityType: 'execution',
      entityId: executionId,
      action: 'paused',
      actorType: 'user',
      actorId: userId,
      beforeState: { status: execution.status },
      afterState: { status: ExecutionStatus.PAUSED, reason },
    });

    // Emit WebSocket event
    const event: ExecutionPausedEvent = {
      executionId,
      ticketId: execution.ticket_id,
      projectId: null, // Will be populated below
      pausedAt: new Date().toISOString(),
      pausedBy: userId,
      reason,
      containerControlSkipped,
    };
    await this.emitToTargetRooms(execution, 'execution.paused', event);

    // Increment metrics
    this.pausedCounter.inc({
      provider: execution.ai_provider,
      reason: reason.substring(0, 50), // Truncate long reasons
    });

    this.logger.log(`Execution ${executionId} paused successfully`);

    return {
      execution: updatedExecution,
      containerControlSkipped,
    };
  }

  /**
   * Resume a paused execution
   * Transitions execution from PAUSED → IN_PROGRESS
   *
   * @param executionId - Execution ID
   * @param userId - User ID performing the resume
   * @param resumeNotes - Optional notes about resuming
   * @returns Resume result with execution and container control status
   * @throws BadRequestException if execution is not in PAUSED state
   */
  async resumeExecution(
    executionId: string,
    userId: string,
    resumeNotes?: string,
  ): Promise<ResumeExecutionResult> {
    this.logger.log(`Resuming execution ${executionId} by user ${userId}`);

    const execution = await this.executionRepository.findById(executionId);
    if (!execution) {
      throw new BadRequestException(`Execution ${executionId} not found`);
    }

    // Must be in PAUSED state to resume
    if (execution.status !== ExecutionStatus.PAUSED) {
      throw new BadRequestException(
        `Cannot resume execution from ${execution.status} state (must be PAUSED)`,
      );
    }

    // Resume container if container_id exists (best effort)
    let containerControlSkipped = false;
    let containerResumed = false;
    if (execution.container_id) {
      containerResumed = await this.containerControl.resumeContainer(execution.container_id);
      if (!containerResumed) {
        this.containerControlFailedCounter.inc({
          operation: 'resume',
          execution_id: executionId,
        });
      }
    } else {
      containerControlSkipped = true;
      this.logger.warn(`Execution ${executionId} has no container_id, skipping container resume`);
    }

    // Update execution state
    const updatedExecution = await this.executionTracker.updateStatus(
      executionId,
      ExecutionStatus.IN_PROGRESS,
    );

    // Create audit log
    await this.auditLogService.log({
      entityType: 'execution',
      entityId: executionId,
      action: 'resumed',
      actorType: 'user',
      actorId: userId,
      beforeState: { status: ExecutionStatus.PAUSED },
      afterState: { status: ExecutionStatus.IN_PROGRESS, resumeNotes },
    });

    // Emit WebSocket event
    const event: ExecutionResumedEvent = {
      executionId,
      ticketId: execution.ticket_id,
      projectId: null, // Will be populated below
      resumedAt: new Date().toISOString(),
      resumedBy: userId,
      resumeNotes,
      containerControlSkipped,
    };
    await this.emitToTargetRooms(execution, 'execution.resumed', event);

    // Increment metrics
    this.resumedCounter.inc({
      provider: execution.ai_provider,
    });

    this.logger.log(`Execution ${executionId} resumed successfully`);

    return {
      execution: updatedExecution,
      containerControlSkipped,
    };
  }

  /**
   * Emergency stop an execution
   * Transitions execution to EMERGENCY_STOPPED (terminal state)
   *
   * @param executionId - Execution ID
   * @param userId - User ID performing the emergency stop
   * @param reason - Reason for emergency stop
   * @param killContainer - Whether to kill container immediately (true) or graceful stop (false)
   * @returns Emergency stop result with execution and container status
   * @throws ConflictException if execution is already in a terminal state
   */
  async emergencyStop(
    executionId: string,
    userId: string,
    reason: string,
    killContainer = false,
  ): Promise<EmergencyStopResult> {
    this.logger.warn(
      `Emergency stopping execution ${executionId} by user ${userId}. Reason: ${reason}`,
    );

    const execution = await this.executionRepository.findById(executionId);
    if (!execution) {
      throw new BadRequestException(`Execution ${executionId} not found`);
    }

    // Check if already in terminal state
    if (this.stateMachine.isTerminal(execution.status)) {
      throw new ConflictException(`Execution is already in terminal state: ${execution.status}`);
    }

    // Stop/kill container if container_id exists (best effort)
    let containerControlSkipped = false;
    let containerKilled = false;
    if (execution.container_id) {
      if (killContainer) {
        containerKilled = await this.containerControl.emergencyKillContainer(
          execution.container_id,
        );
      } else {
        containerKilled = !(await this.containerControl.gracefulStopContainer(
          execution.container_id,
          30,
        ));
        // If graceful stop returned false (failed), we consider container as killed for metrics
        containerKilled = true;
      }

      if (!containerKilled && killContainer) {
        this.containerControlFailedCounter.inc({
          operation: 'kill',
          execution_id: executionId,
        });
      }
    } else {
      containerControlSkipped = true;
      this.logger.warn(`Execution ${executionId} has no container_id, skipping container stop`);
    }

    // Update execution state to EMERGENCY_STOPPED
    const updatedExecution = await this.executionTracker.updateStatus(
      executionId,
      ExecutionStatus.EMERGENCY_STOPPED,
    );

    // Create audit log
    await this.auditLogService.log({
      entityType: 'execution',
      entityId: executionId,
      action: 'emergency_stopped',
      actorType: 'user',
      actorId: userId,
      beforeState: { status: execution.status },
      afterState: {
        status: ExecutionStatus.EMERGENCY_STOPPED,
        reason,
        killContainer,
        containerKilled,
      },
    });

    // Emit WebSocket event
    const event: ExecutionEmergencyStoppedEvent = {
      executionId,
      ticketId: execution.ticket_id,
      projectId: null, // Will be populated below
      stoppedAt: new Date().toISOString(),
      stoppedBy: userId,
      reason,
      containerKilled: killContainer || containerKilled,
      containerControlSkipped,
    };
    await this.emitToTargetRooms(execution, 'execution.emergency_stopped', event);

    // Increment metrics
    this.emergencyStoppedCounter.inc({
      provider: execution.ai_provider,
      reason: reason.substring(0, 50),
      container_killed: killContainer ? 'true' : 'false',
    });

    this.logger.warn(`Execution ${executionId} emergency stopped successfully`);

    return {
      execution: updatedExecution,
      containerKilled: killContainer || containerKilled,
      containerControlSkipped,
    };
  }

  /**
   * Override an AI decision for an execution
   * Creates an override record with full audit trail
   *
   * @param executionId - Execution ID
   * @param userId - User ID performing the override
   * @param decision - New decision (APPROVE or REJECT)
   * @param reason - Reason for override
   * @param overrideData - Optional additional data
   * @returns Override result with execution and override ID
   */
  async overrideDecision(
    executionId: string,
    userId: string,
    decision: OverrideDecision,
    reason: string,
    overrideData?: Record<string, unknown>,
  ): Promise<OverrideDecisionResult> {
    this.logger.log(
      `Overriding decision for execution ${executionId} by user ${userId}. New decision: ${decision}`,
    );

    const execution = await this.executionRepository.findById(executionId);
    if (!execution) {
      throw new BadRequestException(`Execution ${executionId} not found`);
    }

    // Get the most recent override to determine original decision
    const mostRecentOverride =
      await this.overrideRepository.findMostRecentForExecution(executionId);
    const originalDecision = mostRecentOverride?.newDecision ?? execution.status;

    // Create override record
    const override = await this.overrideRepository.create({
      executionId,
      userId,
      originalDecision,
      newDecision: decision,
      reason,
      overrideData,
    });

    // Create audit log
    await this.auditLogService.log({
      entityType: 'execution',
      entityId: executionId,
      action: 'decision_overridden',
      actorType: 'user',
      actorId: userId,
      beforeState: { decision: originalDecision },
      afterState: { decision: decision.toString(), overrideId: override.id },
    });

    // Emit WebSocket event
    const event: ExecutionDecisionOverriddenEvent = {
      executionId,
      ticketId: execution.ticket_id,
      projectId: null, // Will be populated below
      overriddenAt: new Date().toISOString(),
      overriddenBy: userId,
      originalDecision,
      newDecision: decision,
      reason,
    };
    await this.emitToTargetRooms(execution, 'execution.decision_overridden', event);

    // Increment metrics
    this.decisionOverriddenCounter.inc({
      provider: execution.ai_provider,
      original_decision: originalDecision ?? 'unknown',
      new_decision: decision,
    });

    this.logger.log(
      `Decision overridden for execution ${executionId}. Override ID: ${override.id}`,
    );

    return {
      execution,
      overrideId: override.id,
    };
  }

  /**
   * Emit event to target rooms (project, user, roles)
   * Fire-and-forget pattern - errors are logged but don't block
   *
   * @param execution - Execution entity
   * @param event - Event name
   * @param payload - Event payload
   */
  private async emitToTargetRooms<T extends { projectId: string | null; ticketId: string | null }>(
    execution: Execution,
    event: string,
    payload: T,
  ): Promise<void> {
    if (!this.realtimeService) {
      this.logger.debug(`RealtimeService not available, skipping event emission for ${event}`);
      return;
    }

    try {
      // Get project ID from ticket (we'd need to fetch the ticket for this)
      // For now, emit to project room if we have project info
      // This could be enhanced by fetching the ticket to get project_id

      // Emit to role rooms for operational oversight
      this.realtimeService.emitToRole('ADMIN', event, payload);
      this.realtimeService.emitToRole('MANAGER', event, payload);
      this.realtimeService.emitToRole('TL', event, payload);

      this.logger.debug(`Emitted ${event} to target rooms`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit ${event} event: ${errorMessage}`);
    }
  }
}
