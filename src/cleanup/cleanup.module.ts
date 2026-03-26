import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { ExecutionModule } from '@/execution/execution.module';
import { LoggerModule } from '@/common/logger/logger.module';
import { CleanupService } from './cleanup.service';
import { CleanupSchedulerService } from './cleanup-scheduler.service';
import { ExecutionCleanupListener } from './listeners/execution-cleanup.listener';

/**
 * Prometheus metric providers for cleanup operations
 */
const cleanupMetricProviders = [
  makeHistogramProvider({
    name: 'cleanup_duration_seconds',
    help: 'Duration of cleanup operations in seconds',
    labelNames: ['status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  makeCounterProvider({
    name: 'cleanup_containers_total',
    help: 'Total number of container cleanup operations',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: 'cleanup_bytes_reclaimed_total',
    help: 'Total bytes reclaimed from workspace cleanup',
  }),
  makeCounterProvider({
    name: 'cleanup_failures_total',
    help: 'Total cleanup failures by type',
    labelNames: ['type'],
  }),
  makeGaugeProvider({
    name: 'cleanup_orphaned_resources',
    help: 'Number of resources pending cleanup',
  }),
];

/**
 * Cleanup Module
 * Story 23.2: Automated Container Cleanup -> OS-3.2: Final DooD Elimination
 *
 * Provides automated cleanup of resources after AI execution completion.
 */
@Module({
  imports: [ConfigModule, LoggerModule, ScheduleModule.forRoot(), ExecutionModule],
  providers: [
    CleanupService,
    CleanupSchedulerService,
    ExecutionCleanupListener,
    ...cleanupMetricProviders,
  ],
  exports: [CleanupService],
})
export class CleanupModule {}
