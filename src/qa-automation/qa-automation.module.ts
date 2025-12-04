/**
 * QA Automation Module
 * Story 3.1: Linting Integration for Multiple Languages
 * Story 3.2: Automated Test Execution Framework
 *
 * Provides:
 * - LinterService: Multi-language linting (ESLint, Flake8, golangci-lint)
 * - TestRunnerService: Multi-framework test execution (Jest, PyTest, Go, Mocha)
 * - DockerExecutorService: Isolated test execution in containers
 * - Prometheus metrics for linting and testing operations
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
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

@Module({
  imports: [DatabaseModule, SentryModule, ConfigModule],
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
  ],
  exports: [LinterService, TestRunnerService, DockerExecutorService, CoverageService],
})
export class QaAutomationModule {}
