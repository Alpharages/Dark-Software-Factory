/**
 * QA Automation Module
 * Story 3.1: Linting Integration for Multiple Languages
 * Story 3.2: Automated Test Execution Framework
 * Story 3.3: Test Coverage Calculation & Enforcement
 * Story 3.4: Basic Security & Code Quality Checks
 * Story 3.5: Quality Gate Decision Engine
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LinterService } from './linter.service';
import { TestRunnerService } from './test-runner.service';
import { DockerExecutorService } from './docker-executor.service';
import { CoverageService } from './coverage.service';
import { CoverageBaselineService } from './coverage-baseline.service';
import { CoverageFileParser } from './coverage-file.parser';
import { DependencyScannerService } from './scanners/dependency-scanner.service';
import { SecretsScannerService } from './scanners/secrets-scanner.service';
import { ComplexityAnalyzerService } from './scanners/complexity-analyzer.service';
import { SecurityPatternService } from './scanners/security-pattern.service';
import { CodeReviewService } from './code-review.service';
import { QualityGatesService } from './quality-gates.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { QaOrchestratorConsumer } from './qa-orchestrator.consumer';
import { QaResultsService } from './qa-results.service';
import { QaResultsController, QualityGateController } from './qa-results.controller';
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [DatabaseModule, SentryModule, ConfigModule, RabbitMQModule],
  controllers: [QaResultsController, QualityGateController],
  providers: [
    // Story 3.1 - Linting
    LinterService,
    makeCounterProvider({
      name: QA_METRICS.LINTING_TOTAL,
      help: 'Total linting executions',
      labelNames: ['language', 'result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.LINTING_DURATION,
      help: 'Linting duration in seconds',
      labelNames: ['language'],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeGaugeProvider({
      name: QA_METRICS.LINTING_ISSUES,
      help: 'Current linting issue count by language and severity',
      labelNames: ['language', 'severity'],
    }),

    // Story 3.2 - Test Runner
    TestRunnerService,
    DockerExecutorService,
    makeCounterProvider({
      name: QA_METRICS.TEST_EXECUTIONS_TOTAL,
      help: 'Total test executions',
      labelNames: ['framework', 'result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.TEST_DURATION,
      help: 'Test execution duration in seconds',
      labelNames: ['framework'],
      buckets: [5, 15, 30, 60, 120, 300, 600],
    }),
    makeCounterProvider({
      name: QA_METRICS.TEST_PASSED_TOTAL,
      help: 'Total tests passed',
      labelNames: ['framework'],
    }),
    makeCounterProvider({
      name: QA_METRICS.TEST_FAILED_TOTAL,
      help: 'Total tests failed',
      labelNames: ['framework'],
    }),

    // Story 3.3 - Coverage
    CoverageService,
    CoverageBaselineService,
    CoverageFileParser,
    makeCounterProvider({
      name: QA_METRICS.COVERAGE_ANALYSIS_TOTAL,
      help: 'Total coverage analyses performed',
      labelNames: ['projectId'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.COVERAGE_ANALYSIS_DURATION,
      help: 'Coverage analysis duration in seconds',
      labelNames: ['projectId'],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeGaugeProvider({
      name: QA_METRICS.COVERAGE_PERCENT,
      help: 'Coverage percentage by type',
      labelNames: ['projectId', 'type'], // type: lines, branches, etc.
    }),
    makeHistogramProvider({
      name: QA_METRICS.COVERAGE_DELTA,
      help: 'Coverage delta compared to baseline',
      labelNames: ['projectId', 'type'],
      buckets: [-10, -5, -2, -1, -0.1, 0, 0.1, 1, 2, 5, 10],
    }),
    makeCounterProvider({
      name: QA_METRICS.COVERAGE_THRESHOLD_FAILURES,
      help: 'Total coverage threshold failures',
      labelNames: ['projectId'],
    }),

    // Story 3.4 - Security Scanning
    DependencyScannerService,
    SecretsScannerService,
    ComplexityAnalyzerService,
    SecurityPatternService,
    CodeReviewService,
    makeCounterProvider({
      name: QA_METRICS.SECURITY_SCANS_TOTAL,
      help: 'Total security scans executed',
      labelNames: ['result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.SECURITY_SCAN_DURATION,
      help: 'Security scan duration in seconds',
      buckets: [10, 30, 60, 120, 180],
    }),
    makeCounterProvider({
      name: QA_METRICS.SECURITY_VULNERABILITIES,
      help: 'Total security vulnerabilities detected',
      labelNames: ['severity'],
    }),
    makeCounterProvider({
      name: QA_METRICS.SECURITY_SECRETS_DETECTED,
      help: 'Total secrets detected in code',
    }),
    makeCounterProvider({
      name: QA_METRICS.SECURITY_COMPLEXITY_ISSUES,
      help: 'Total code complexity issues detected',
    }),
    makeCounterProvider({
      name: QA_METRICS.SECURITY_PATTERN_FINDINGS,
      help: 'Total security pattern violations detected',
      labelNames: ['type'],
    }),

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
  ],
  exports: [
    LinterService,
    TestRunnerService,
    DockerExecutorService,
    CoverageService,
    CodeReviewService,
    QualityGatesService,
    QaOrchestratorService,
    QaResultsService,
  ],
})
export class QaAutomationModule {}
