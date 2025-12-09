/**
 * QA Automation Module
 * Story 3.1: Linting Integration for Multiple Languages
 * Story 3.2: Automated Test Execution Framework
 * Story 3.3: Test Coverage Calculation & Enforcement
 * Story 3.4: Basic Security & Code Quality Checks
 * Story 3.5: Quality Gate Decision Engine
 * Story 3.6: QA Results Storage & Retrieval
 * Story 3.7: RabbitMQ QA Queue Processing
 * Story 3.8: QA Metrics & Prometheus Integration
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
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
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service'; // Story 3.10

import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module'; // Story 3.10: For OrchestratorService

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    ConfigModule,
    RabbitMQModule,
    LoggerModule,
    AppMetricsModule,
    AiRoutingModule, // Story 3.10: AiQaOrchestrator needs OrchestratorService
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
      labelNames: ['status', 'project_id', 'result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'QA check duration in seconds',
      labelNames: ['check_type'],
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

    // Story 3.8 - QA Metrics & Prometheus Integration
    QaMetricsService,
    // Note: QUEUE_METRICS are registered in AppMetricsModule (Story 1.8)
    // Don't duplicate here to avoid Prometheus registration errors
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
