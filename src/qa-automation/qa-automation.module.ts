import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { QualityGatesService } from './quality-gates.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { QaOrchestratorConsumer } from './qa-orchestrator.consumer';
import { QaResultsService } from './qa-results.service';
import { QaResultsController, QualityGateController } from './qa-results.controller';
import { QaCheckPublisher } from './qa-check.publisher';
import { QaCheckConsumer } from './qa-check.consumer';
import { QaMetricsService } from './qa-metrics.service';
import {
  QA_METRICS,
  QUEUE_METRICS,
  METRICS_CONSTANTS,
  LABELS,
} from '../common/metrics/metrics.constants';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service'; // Story 3.10

import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module'; // Story 3.10: For OrchestratorService
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 13.4: Self-Healing Integration
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    ConfigModule,
    RabbitMQModule,
    LoggerModule,
    AppMetricsModule,
    forwardRef(() => AiRoutingModule), // Story 3.10: AiQaOrchestrator needs OrchestratorService (circular dep fix)
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 13.4: Self-Healing Integration
    forwardRef(() => ExecutionModule), // Provides SelfHealingOrchestratorService
  ],
  controllers: [QaResultsController, QualityGateController],
  providers: [
    // Story 3.10 - AI QA Orchestrator (replaces custom services)
    AiQaOrchestrator,

    // Story 3.5 - Quality Gate Decision Engine
    QualityGatesService,
    QaOrchestratorService,
    QaOrchestratorConsumer,
    QaResultsService,
    makeCounterProvider({
      name: QA_METRICS.QUALITY_GATE_EVALUATIONS_TOTAL,
      help: 'Total quality gate evaluations',
      labelNames: ['status', 'project_id'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.QUALITY_GATE_DURATION,
      help: 'Quality gate evaluation duration in seconds',
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeHistogramProvider({
      name: QA_METRICS.QUALITY_SCORE_HISTOGRAM,
      help: 'Distribution of quality scores (0-100)',
      labelNames: ['project_id'],
      buckets: [0, 20, 40, 60, 70, 80, 90, 100],
    }),
    makeCounterProvider({
      name: QA_METRICS.CHECKS_TOTAL,
      help: 'Total QA checks orchestrated',
      labelNames: ['check_type', 'status', 'project_id', 'provider'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'QA check duration in seconds',
      labelNames: ['check_type', 'status', 'project_id', 'provider'],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),

    // Story 3.6 - QA Results Storage & Retrieval
    makeCounterProvider({
      name: QA_METRICS.QA_RESULTS_QUERIES_TOTAL,
      help: 'Total number of QA results queries',
      labelNames: ['query_type'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.QA_RESULTS_QUERY_DURATION,
      help: 'QA results query duration in seconds',
      labelNames: ['query_type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    }),

    // Story 3.7 - RabbitMQ QA Queue Processing
    QaCheckPublisher,
    QaCheckConsumer,
    // Queue metrics needed by QaCheckConsumer
    makeGaugeProvider({
      name: QUEUE_METRICS.DEPTH,
      help: 'Current queue depth',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.CONSUMER_COUNT,
      help: 'Number of active consumers',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.PROCESSING_RATE,
      help: 'Queue processing rate (messages per minute)',
      labelNames: [LABELS.QUEUE, LABELS.STATUS],
    }),

    // Story 13.4: Self-Healing Integration metrics
    makeCounterProvider({
      name: QA_METRICS.SELF_HEALING_TRIGGERED_TOTAL,
      help: 'Total number of self-healing workflows triggered by QA failures',
      labelNames: ['ticket_id', 'execution_id'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.ORCHESTRATOR_SELF_HEALING_DURATION_SECONDS,
      help: 'Time spent in self-healing workflow (histogram)',
      labelNames: ['outcome'], // SUCCESS, ESCALATED, MAX_ATTEMPTS
      buckets: [5, 10, 30, 60, 120, 300], // seconds
    }),

    // Story 3.8 - QA Metrics & Prometheus Integration
    QaMetricsService,
    // Note: Other QUEUE_METRICS are registered in AppMetricsModule (Story 1.8)
  ],
  exports: [
    AiQaOrchestrator, // Story 3.10
    QualityGatesService,
    QaOrchestratorService,
    QaResultsService,
    QaCheckPublisher, // Story 3.7
    QaCheckConsumer, // Story 3.7
    QaMetricsService, // Story 3.8
  ],
})
export class QaAutomationModule {}
