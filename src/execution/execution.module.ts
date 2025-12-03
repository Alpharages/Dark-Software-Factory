import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { ExecutionService } from './execution.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

/**
 * Execution Module
 *
 * Story 2.5: FR62 - System monitors AI execution progress
 *
 * Provides:
 * - Execution lifecycle management
 * - State machine for valid transitions
 * - Audit logging for all state changes
 * - RabbitMQ event emission
 * - Prometheus metrics
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RabbitMQModule],
  providers: [
    // Core services
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionStateMachine,

    // Prometheus metrics
    makeCounterProvider({
      name: 'execution_total',
      help: 'Total execution count by provider and status',
      labelNames: ['provider', 'status'],
    }),
    makeHistogramProvider({
      name: 'execution_duration_seconds',
      help: 'Execution duration in seconds',
      labelNames: ['provider', 'status'],
      buckets: [10, 30, 60, 120, 300, 600, 900, 1800],
    }),
    makeGaugeProvider({
      name: 'execution_status_gauge',
      help: 'Current execution count by status',
      labelNames: ['provider', 'status'],
    }),
    makeCounterProvider({
      name: 'execution_retry_total',
      help: 'Total execution retry count',
      labelNames: ['provider'],
    }),
  ],
  exports: [ExecutionService, ExecutionTrackerService, ExecutionRepository, ExecutionStateMachine],
})
export class ExecutionModule {}
