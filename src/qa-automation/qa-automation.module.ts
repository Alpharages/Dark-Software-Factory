/**
 * QA Automation Module
 * Story 3.1: Linting Integration for Multiple Languages
 *
 * Provides:
 * - LinterService: Multi-language linting (ESLint, Flake8, golangci-lint)
 * - Prometheus metrics for linting operations
 */

import { Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LinterService } from './linter.service';
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

@Module({
  imports: [DatabaseModule, SentryModule],
  providers: [
    LinterService,

    // Prometheus metrics for linting
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
  ],
  exports: [LinterService],
})
export class QaAutomationModule {}
