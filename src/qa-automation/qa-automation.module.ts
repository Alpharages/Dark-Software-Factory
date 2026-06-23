import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { QaNotificationService } from './services/qa-notification.service'; // Story 10.3
import {
  QA_METRICS,
  QUEUE_METRICS,
  METRICS_CONSTANTS,
  LABELS,
} from '../common/metrics/metrics.constants';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service'; // Story 3.10
import { ExecutionCompletedListener } from './listeners/execution-completed.listener';

import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { RealtimeModule } from '../realtime/realtime.module'; // Story 10.3
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 13.4: Self-Healing Integration
import { ProductionApprovalModule } from './production-approval/production-approval.module';
import { QualityGateConfigModule } from './quality-gate-config/quality-gate-config.module';
import { GitHubModule } from '../github/github.module';

// Story 8.1: QA Review Queue & Sampling Configuration
import { QaSamplingConfigService } from './services/qa-sampling-config.service';
import {
  QaSamplingService,
  PercentageSamplingStrategy,
  RiskBasedSamplingStrategy,
  CompositeSamplingStrategy,
  RiskScoringService,
} from './services/qa-sampling.service';
import { QaReviewQueueService } from './services/qa-review-queue.service';
import { QaReviewMetricsService } from './services/qa-review-metrics.service';
import { AiCodeReviewService } from './services/ai-code-review.service'; // Story 8.2
import {
  QaSamplingConfigController,
  QaReviewQueueController,
  QaReviewSamplesController,
} from './controllers/qa-review.controller';
import {
  QaReviewQueueConsumer,
  QaReviewQueueLegacyConsumer,
} from './consumers/qa-review-queue.consumer';
import { BugEscapeModule } from './bug-escape/bug-escape.module'; // Story 8.5

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    ConfigModule,
    RabbitMQModule,
    LoggerModule,
    AppMetricsModule,
    forwardRef(() => RealtimeModule), // Story 10.3: For QA notifications
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 8.3: Production Approval
    ProductionApprovalModule,
    QualityGateConfigModule,
    BugEscapeModule, // Story 8.5
    GitHubModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        ttl: config.get('AI_REVIEW_CACHE_TTL', 3600), // 1 hour
        max: config.get('AI_REVIEW_CACHE_MAX', 100), // Max 100 cached reviews
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60000, // 1 minute
            limit: config.get('AI_REVIEW_RATE_LIMIT', 10), // 10 per minute
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    QaResultsController,
    QualityGateController,
    // Story 8.1: QA Review Queue & Sampling Controllers
    QaSamplingConfigController,
    QaReviewQueueController,
    // Story 8.UI: Samples endpoints for Lead QA Review Dashboard
    QaReviewSamplesController,
  ],
  providers: [
    // Story 3.10 - AI QA Orchestrator (replaces custom services)
    AiQaOrchestrator,

    // Story 3.5 - Quality Gate Decision Engine
    QualityGatesService,
    QaOrchestratorService,
    QaOrchestratorConsumer,
    QaResultsService,
    QaNotificationService, // Story 10.3
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

    // Story 10.3: QA Notification Metrics
    makeCounterProvider({
      name: 'qa_notifications_emitted_total',
      help: 'Total QA notifications emitted',
      labelNames: ['gate_type', 'severity'],
    }),
    makeCounterProvider({
      name: 'qa_notification_emission_errors_total',
      help: 'Total QA notification emission errors',
      labelNames: ['event', 'reason'],
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

    // Story 3.8 - QA Metrics & Prometheus Integration
    QaMetricsService,

    // Story 8.1 - QA Review Queue & Sampling Configuration
    // Sampling Strategy Services
    QaSamplingConfigService,
    RiskScoringService,
    PercentageSamplingStrategy,
    RiskBasedSamplingStrategy,
    CompositeSamplingStrategy,
    QaSamplingService,
    // Queue Management Service
    QaReviewQueueService,
    // Metrics Service
    QaReviewMetricsService,
    // RabbitMQ Consumers
    QaReviewQueueConsumer,
    QaReviewQueueLegacyConsumer,
    // Story 8.1 - Prometheus Metrics for QA Review Queue
    makeGaugeProvider({
      name: QA_METRICS.REVIEW_QUEUE_DEPTH,
      help: 'Current QA review queue size by status',
      labelNames: ['status'],
    }),
    makeGaugeProvider({
      name: QA_METRICS.REVIEW_SAMPLING_RATE,
      help: 'Configured sampling percentage',
    }),
    makeCounterProvider({
      name: QA_METRICS.REVIEW_TICKETS_SAMPLED_TOTAL,
      help: 'Total tickets sampled by strategy',
      labelNames: ['strategy', 'risk_level'],
    }),
    makeCounterProvider({
      name: QA_METRICS.REVIEW_TICKETS_BY_RISK_TOTAL,
      help: 'Total tickets sampled by risk level',
      labelNames: ['risk_level'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.REVIEW_QUEUE_DURATION_SECONDS,
      help: 'Time from queue entry to review decision',
      labelNames: ['risk_level'],
      buckets: [60, 300, 600, 1800, 3600, 7200, 14400], // 1min to 4 hours
    }),
    makeCounterProvider({
      name: QA_METRICS.REVIEW_DECISIONS_TOTAL,
      help: 'Review decisions by outcome',
      labelNames: ['decision'],
    }),

    // Story 8.2: AI Code Review Service & Metrics
    AiCodeReviewService,
    makeCounterProvider({
      name: QA_METRICS.AI_REVIEW_GENERATION_TOTAL,
      help: 'Total AI reviews generated',
      labelNames: ['risk_level'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.AI_REVIEW_GENERATION_DURATION,
      help: 'AI review generation duration',
      buckets: [5, 10, 30, 60, 120, 300], // seconds
    }),
    makeCounterProvider({
      name: QA_METRICS.AI_REVIEW_FINDINGS_TOTAL,
      help: 'Total findings identified by AI',
      labelNames: ['risk_level', 'severity'],
    }),
    makeCounterProvider({
      name: QA_METRICS.AI_REVIEW_FINDING_STATUS_UPDATES,
      help: 'Total finding status updates',
      labelNames: ['status'],
    }),

    // Story 8.5: Bug Escape Metrics
    makeCounterProvider({
      name: QA_METRICS.BUG_ESCAPES_TOTAL,
      help: 'Total bug escapes detected',
      labelNames: ['category', 'project_id', 'ai_provider'],
    }),
    makeGaugeProvider({
      name: QA_METRICS.BUG_ESCAPE_RATE_PERCENT,
      help: 'Global bug escape rate percentage',
      labelNames: ['project_id'],
    }),
    makeCounterProvider({
      name: QA_METRICS.BUG_ESCAPE_THRESHOLD_BREACHES_TOTAL,
      help: 'Total times escape rate exceeded target',
      labelNames: ['project_id'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.BUG_ESCAPE_RESOLUTION_TIME_HOURS,
      help: 'Time to resolve bug escapes in hours',
      buckets: [1, 4, 8, 24, 48, 72, 168], // 1h to 1 week
    }),

    ExecutionCompletedListener,

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
    QaNotificationService, // Story 10.3
    // Story 8.1 - Export services for use by other modules
    QaSamplingConfigService,
    QaSamplingService,
    RiskScoringService,
    QaReviewQueueService,
    QaReviewMetricsService,
    QaReviewQueueConsumer,
    AiCodeReviewService, // Story 8.2
    ExecutionCompletedListener,
  ],
})
export class QaAutomationModule {}
