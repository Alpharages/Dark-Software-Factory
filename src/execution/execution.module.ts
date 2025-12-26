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
import { ApprovalService } from './services/approval.service';
import { ApprovalController } from './controllers/approval.controller';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module';
import { QaAutomationModule } from '../qa-automation/qa-automation.module';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 13.3: AI Cost Tracking & Optimization
import { CostTrackingModule } from '../cost-tracking/cost-tracking.module';
// Story 13.3.1: Self-Healing with Progress Validation
import { ProgressValidatorModule } from '../ai-monitoring/progress-validator.module';
import { ClickUpModule } from '../clickup/clickup.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
// LoggerModule not needed - consumer uses NestJS Logger directly

/**
 * Execution Module
 *
 * Story 2.5: FR62 - System monitors AI execution progress
 * Story 2.9: FR63 - System retries failed executions with error context
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 *
 * Provides:
 * - Execution lifecycle management
 * - State machine for valid transitions
 * - Audit logging for all state changes
 * - RabbitMQ event emission
 * - Prometheus metrics
 * - Retry logic and error handling
 * - Queue publishing and consuming (Story 2.10)
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    forwardRef(() => AiRoutingModule), // For OrchestratorService in RetryConsumer & AIExecutionConsumer
    forwardRef(() => QaAutomationModule), // Story 3.7: For QaCheckPublisher
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 13.3: AI Cost Tracking & Optimization
    CostTrackingModule,
    // Story 13.3.1: Self-Healing with Progress Validation
    ProgressValidatorModule,
    ClickUpModule,
    AppMetricsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [ExecutionController, ApprovalController],
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
      name: 'execution_total',
      help: 'Total execution count by provider and status',
      labelNames: ['provider', 'status'],
    }),
    makeHistogramProvider({
      name: 'execution_duration_seconds',
      help: 'Execution duration in seconds',
      labelNames: ['provider', 'status'],
      buckets: [10, 30, 60, 120, 300, 600, 900, 1800],
    }),
    makeGaugeProvider({
      name: 'execution_status_gauge',
      help: 'Current execution count by status',
      labelNames: ['provider', 'status'],
    }),
    makeCounterProvider({
      name: 'execution_retry_total',
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

    // Self-Healing Metrics (Story 13.3.1)
    makeCounterProvider({
      name: 'ai_self_healing_attempts_total',
      help: 'Total self-healing attempts by outcome',
      labelNames: ['ticket_id', 'outcome'], // outcome: success, escalated, max_attempts
    }),
    makeGaugeProvider({
      name: 'ai_self_healing_progress',
      help: 'Self-healing progress percentage (error reduction)',
      labelNames: ['ticket_id'],
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
