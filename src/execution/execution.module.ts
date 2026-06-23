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
import { ExecutionController } from './execution.controller';
import { queueMetricsProviders } from '../common/metrics/queue-metrics.provider';
import { AI_METRICS, CONTAINER_METRICS } from '../common/metrics/metrics.constants';
import { ApprovalService } from './services/approval.service';
import { ApprovalController } from './controllers/approval.controller';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 13.3: AI Cost Tracking & Optimization
import { CostTrackingModule } from '../cost-tracking/cost-tracking.module';
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
import { ExecutionOverrideRepository } from './repositories/execution-override.repository';
// Execution Activity Persistence
import { ExecutionActivityRepository } from './repositories/execution-activity.repository';
// Audit Logging
import { AuditLogService } from '../common/audit/audit-log.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { GitHubModule } from '../github/github.module';
import { QAFailureResolutionService } from './services/qa-failure-resolution.service';

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
 * - Audit logging for all state changes
 * - RabbitMQ event emission
 * - Prometheus metrics
 * - WebSocket event streaming (Story 10.2)
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 13.3: AI Cost Tracking & Optimization
    CostTrackingModule,
    ClickUpModule,
    IntegrationsModule,
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
    forwardRef(() => GitHubModule),
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
    ApprovalService,

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

    // QA Failure Resolution (WR-4.3)
    QAFailureResolutionService,
  ],
  exports: [
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionGateway,
    ApprovalService,
  ],
})
export class ExecutionModule {}
