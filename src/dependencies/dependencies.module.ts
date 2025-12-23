import { Module } from '@nestjs/common';
import { CircularDependencyDetectorService } from './circular-dependency-detector.service';
import { DependencyManagerService } from './dependency-manager.service';
import { ClickUpModule } from '../clickup/clickup.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

/**
 * Dependencies Module
 * Story 12.1: Circular Dependency Detection
 * Story 12.2: Dependency Manager & ETA Calculator
 *
 * Responsibilities:
 * - Detect circular dependencies in ClickUp task chains
 * - Validate ticket dependencies are resolved before execution
 * - Calculate ETAs for blocked tickets using historical data
 * - Notify dependent tickets when blockers complete
 * - Alert PM with cycle visualization
 * - Audit log all dependency decisions
 *
 * Integration:
 * - Story 12.5 will wire this into TicketIntakeModule
 */
@Module({
  imports: [
    ClickUpModule, // For ClickUp API access
    AIDecisionLoggerModule, // For AI decision logging
    AppMetricsModule, // For Prometheus metrics
    DatabaseModule, // For database access
    RabbitMQModule, // For RabbitMQ queue operations (Story 12.2)
  ],
  providers: [CircularDependencyDetectorService, DependencyManagerService],
  exports: [CircularDependencyDetectorService, DependencyManagerService],
})
export class DependenciesModule {}
