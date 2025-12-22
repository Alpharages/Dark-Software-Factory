import { Module } from '@nestjs/common';
import { CircularDependencyDetectorService } from './circular-dependency-detector.service';
import { ClickUpModule } from '../clickup/clickup.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { DatabaseModule } from '../database/database.module';

/**
 * Dependencies Module
 * Story 12.1: Circular Dependency Detection
 *
 * Responsibilities:
 * - Detect circular dependencies in ClickUp task chains
 * - Alert PM with cycle visualization
 * - Block tickets caught in dependency cycles
 * - Audit log all dependency decisions
 *
 * Integration:
 * - Story 12.5 will wire this into TicketIntakeModule
 */
@Module({
  imports: [
    ClickUpModule,              // For ClickUp API access
    AIDecisionLoggerModule,     // For AI decision logging
    AppMetricsModule,           // For Prometheus metrics
    DatabaseModule,             // For database access
  ],
  providers: [CircularDependencyDetectorService],
  exports: [CircularDependencyDetectorService],
})
export class DependenciesModule {}

