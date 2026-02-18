import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { ExecutionService } from './execution.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionGateway } from './gateways/execution.gateway';
import { JwtModule } from '@nestjs/jwt';
import { ExecutionStateMachine } from './state-machine';
import { RetryHandlerService } from './retry-handler.service';
import { RetryClassifierService } from './retry-classifier.service';
import { RetrySchedulerService } from './retry-scheduler.service';
import { RetryConsumer } from './retry.consumer';
import { ExecutionController } from './execution.controller';
// Story 2.10: Queue Processing
import { AIExecutionPublisher } from './ai-execution.publisher';
import { AIExecutionConsumer } from './ai-execution.consumer';
import { SelfHealingOrchestratorService } from './self-healing-orchestrator.service';
import { queueMetricsProviders } from '../common/metrics/queue-metrics.provider';
import { AI_METRICS, CONTAINER_METRICS } from '../common/metrics/metrics.constants';
import { ApprovalService } from './services/approval.service';
import { ApprovalController } from './controllers/approval.controller';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 13.3: AI Cost Tracking & Optimization
import { CostTrackingModule } from '../cost-tracking/cost-tracking.module';
// Story 13.3.1: Self-Healing with Progress Validation
import { ProgressValidatorModule } from '../ai-monitoring/progress-validator.module';
import { ClickUpModule } from '../clickup/clickup.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
// Story 7.7: AI Capability Management & Limitations
import { CapabilitiesModule } from '../architecture-review/capabilities/capabilities.module';
// Story 10.2: Socket.IO Real-Time Infrastructure
import { RealtimeModule } from '../realtime/realtime.module';
// Story 10-U-4
import { ExecutionLogStreamingService } from './services/execution-log-streaming.service';
import { ExecutionLogRepository } from './repositories/execution-log.repository';
import { LogRetentionJob } from './jobs/log-retention.job';
import { ExecutionLogsController } from './controllers/execution-logs.controller';
// Story 10-U-5: Manual Intervention Circuit Breaker
import { ManualInterventionService } from './services/manual-intervention.service';
import { ManualInterventionController } from './controllers/manual-intervention.controller';
import { ContainerControlService } from './services/container-control.service';
import { ExecutionOverrideRepository } from './repositories/execution-override.repository';
// Execution Activity Persistence
import { ExecutionActivityRepository } from './repositories/execution-activity.repository';
// Audit Logging
import { AuditLogService } from '../common/audit/audit-log.service';

/**
 * Execution Module
 *
 * Story 2.5: FR62 - System monitors AI execution progress
 * Story 2.9: FR63 - System retries failed executions with error context
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 * Story 10.2: WebSocket Execution Progress Streaming
 *
 * Provides:
 * - Execution lifecycle management
 * - State machine for valid transitions
 * - Audit logging for all state changes
 * - RabbitMQ event emission
 * - Prometheus metrics
 * - Retry logic and error handling
 * - Queue publishing and consuming (Story 2.10)
 * - WebSocket event streaming (Story 10.2)
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    forwardRef(() => AiRoutingModule), // For OrchestratorService in RetryConsumer & AIExecutionConsumer
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 13.3: AI Cost Tracking & Optimization
    CostTrackingModule,
    // Story 13.3.1: Self-Healing with Progress Validation
    ProgressValidatorModule,
    ClickUpModule,
    AppMetricsModule,
    // Story 7.7: AI Capability Management & Limitations
    CapabilitiesModule,
    // Story 10.2: Socket.IO Real-Time Infrastructure
    RealtimeModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '1h',
        algorithm: 'HS256',
      },
      verifyOptions: {
        algorithms: ['HS256'],
      },
    }),
  ],
  controllers: [
    ExecutionController,
    ApprovalController,
    ExecutionLogsController,
    ManualInterventionController,
  ],
  providers: [
    // Core services
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionGateway,
    ExecutionStateMachine,
    ApprovalService,

    // Retry Services (Story 2.9)
    RetryHandlerService,
    RetryClassifierService,
    RetrySchedulerService,
    RetryConsumer,

    // Queue Processing Services (Story 2.10)
    AIExecutionPublisher,
    AIExecutionConsumer,

    // Self-Healing (Story 13.3.1)
    SelfHealingOrchestratorService,

    // Queue Metrics Providers (Story 2.10)
    ...queueMetricsProviders,

    // Prometheus metrics
    makeCounterProvider({
      name: AI_METRICS.EXECUTIONS_TOTAL,
      help: 'Total execution count by provider and status',
      labelNames: ['provider', 'status'],
    }),
    makeHistogramProvider({
      name: AI_METRICS.EXECUTION_DURATION,
      help: 'Execution duration in seconds',
      labelNames: ['provider', 'status'],
      buckets: [10, 30, 60, 120, 300, 600, 900, 1800],
    }),
    makeGaugeProvider({
      name: 'dsf_execution_status_gauge', // Should ideally be in constants too
      help: 'Current execution count by status',
      labelNames: ['provider', 'status'],
    }),
    makeCounterProvider({
      name: 'dsf_execution_retry_total', // Should ideally be in constants too
      help: 'Total execution retry count',
      labelNames: ['provider'],
    }),

    // Retry Metrics (Story 2.9)
    makeCounterProvider({
      name: 'retry_attempts_total',
      help: 'Total retry attempts',
      labelNames: ['error_code', 'provider', 'retryable'],
    }),
    makeCounterProvider({
      name: 'retry_exhausted_total',
      help: 'Retries exhausted (permanent failures)',
      labelNames: ['error_code'],
    }),
    makeCounterProvider({
      name: 'retry_success_total',
      help: 'Successful retry completions',
    }),
    makeCounterProvider({
      name: 'retry_scheduled_total',
      help: 'Retries scheduled',
      labelNames: ['attempt'],
    }),
    makeHistogramProvider({
      name: 'retry_delay_seconds',
      help: 'Retry delay in seconds',
      buckets: [1, 2, 4, 8, 16, 30, 60],
    }),
    makeGaugeProvider({
      name: 'retry_active_count',
      help: 'Currently active retries awaiting execution',
    }),

    makeCounterProvider({
      name: CONTAINER_METRICS.LOG_BYTES_TOTAL,
      help: 'Total bytes of container logs streamed',
      labelNames: ['execution_id', 'source'],
    }),
    makeHistogramProvider({
      name: CONTAINER_METRICS.EXEC_DURATION_SECONDS,
      help: 'Duration of container execution steps',
      labelNames: ['execution_id', 'status'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
    }),
    // Self-Healing Metrics (Story 13.3.1)
    makeCounterProvider({
      name: AI_METRICS.SELF_HEALING_ATTEMPTS_TOTAL,
      help: 'Total self-healing attempts by outcome',
      labelNames: ['ticket_id', 'outcome'], // outcome: success, escalated, max_attempts
    }),
    makeGaugeProvider({
      name: AI_METRICS.SELF_HEALING_PROGRESS,
      help: 'Self-healing progress percentage (error reduction)',
      labelNames: ['ticket_id'],
    }),
    // Story 10.2: WebSocket Emission Metrics
    makeCounterProvider({
      name: 'websocket_emission_errors_total',
      help: 'WebSocket emission failures',
      labelNames: ['event', 'reason'],
    }),

    // Story 10-U-4: Execution Log Streaming
    ExecutionLogStreamingService,
    ExecutionLogRepository,
    LogRetentionJob,

    // Execution Activity Persistence (Live Activity Timeline)
    ExecutionActivityRepository,

    // Story 10-U-5: Manual Intervention Circuit Breaker
    ManualInterventionService,
    ContainerControlService,
    ExecutionOverrideRepository,
    AuditLogService,

    // Log Streaming Metrics
    makeCounterProvider({
      name: 'execution_logs_emitted_total',
      help: 'Total logs emitted via WebSocket',
      labelNames: ['execution_id', 'level', 'source'],
    }),
    makeCounterProvider({
      name: 'execution_logs_dropped_total',
      help: 'Logs dropped due to rate limiting',
      labelNames: ['execution_id', 'reason'],
    }),
    makeCounterProvider({
      name: 'execution_logs_retention_deleted_total',
      help: 'Total logs deleted by retention policy',
    }),
    makeCounterProvider({
      name: 'websocket_log_emission_errors_total',
      help: 'WebSocket log emission failures',
      labelNames: ['event', 'reason'],
    }),
    makeGaugeProvider({
      name: 'execution_log_buffer_size',
      help: 'Current size of execution log buffer',
    }),

    // Story 10-U-5: Manual Intervention Metrics
    makeCounterProvider({
      name: 'execution_paused_total',
      help: 'Total number of executions paused',
      labelNames: ['provider', 'reason'],
    }),
    makeCounterProvider({
      name: 'execution_resumed_total',
      help: 'Total number of executions resumed',
      labelNames: ['provider'],
    }),
    makeCounterProvider({
      name: 'execution_emergency_stopped_total',
      help: 'Total number of executions emergency stopped',
      labelNames: ['provider', 'reason', 'container_killed'],
    }),
    makeCounterProvider({
      name: 'execution_decision_overridden_total',
      help: 'Total number of AI decisions overridden',
      labelNames: ['provider', 'original_decision', 'new_decision'],
    }),
    makeCounterProvider({
      name: 'execution_container_control_failed_total',
      help: 'Total number of container control operation failures',
      labelNames: ['operation', 'execution_id'],
    }),
  ],
  exports: [
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionStateMachine,
    RetryHandlerService,
    RetryClassifierService,
    RetrySchedulerService,
    // Story 2.10: Export queue services
    AIExecutionPublisher,
    AIExecutionConsumer,
    // Story 13.3.1: Export self-healing service
    SelfHealingOrchestratorService,
    ExecutionGateway,
    ApprovalService,
  ],
})
export class ExecutionModule {}
