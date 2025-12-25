import { Module } from '@nestjs/common';
import { StorageManagerService } from './storage-manager.service';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { makeGaugeProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';

/**
 * Storage Module
 * Story 14.3: Storage Manager Service
 *
 * Provides centralized storage management for AI workspace archival,
 * disk monitoring, and retention policies.
 */
@Module({
  imports: [DatabaseModule, AppMetricsModule],
  providers: [
    StorageManagerService,
    // Story 14.3: Prometheus Metrics (AC#6)
    makeGaugeProvider({
      name: 'storage_disk_usage_bytes',
      help: 'Disk usage in bytes for workspace storage',
      labelNames: ['type'], // 'used', 'available', 'total'
    }),
    makeGaugeProvider({
      name: 'storage_archives_total',
      help: 'Total number of workspace archives (ARCHIVED status)',
    }),
    makeCounterProvider({
      name: 'storage_cleanup_operations_total',
      help: 'Total number of storage cleanup operations performed',
    }),
  ],
  exports: [StorageManagerService],
})
export class StorageModule {}
