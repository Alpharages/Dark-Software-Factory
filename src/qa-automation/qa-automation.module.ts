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
  ],
  exports: [LinterService, TestRunnerService, DockerExecutorService],
})
export class QaAutomationModule {}
