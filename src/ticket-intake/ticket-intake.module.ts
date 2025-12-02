import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { TicketIntakeService } from './ticket-intake.service';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { TicketIntakeConsumer } from './ticket-intake.consumer';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

// Metric names (must match service injection)
const METRICS = {
  INTAKE_TOTAL: 'dsf_ticket_intake_total',
  INTAKE_DURATION: 'dsf_ticket_intake_duration_seconds',
  VALIDATION_TOTAL: 'dsf_ticket_validation_total',
  QUALITY_SCORE: 'dsf_ticket_quality_score',
};

/**
 * Ticket Intake Module
 * FR57: Parse ticket details from ClickUp
 * FR58: Validate ticket quality
 *
 * Processes incoming tickets from the webhook queue:
 * - Consumes from ticket-intake-queue (Story 2.1)
 * - Validates ticket data quality
 * - Calculates quality scores
 * - Routes validated tickets to AI processing
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RabbitMQModule],
  providers: [
    // Services
    TicketIntakeService,
    TicketValidatorService,
    TicketQualityService,
    // Consumer
    TicketIntakeConsumer,
    // Prometheus Metrics
    makeCounterProvider({
      name: METRICS.INTAKE_TOTAL,
      help: 'Total tickets processed',
      labelNames: ['event_type', 'status'],
    }),
    makeCounterProvider({
      name: METRICS.VALIDATION_TOTAL,
      help: 'Ticket validation results',
      labelNames: ['result'],
    }),
    makeHistogramProvider({
      name: METRICS.INTAKE_DURATION,
      help: 'Ticket processing duration in seconds',
      buckets: [0.1, 0.5, 1, 2.5, 5, 10],
    }),
    makeHistogramProvider({
      name: METRICS.QUALITY_SCORE,
      help: 'Ticket quality score distribution',
      labelNames: ['grade'],
      buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    }),
  ],
  exports: [TicketIntakeService, TicketValidatorService, TicketQualityService],
})
export class TicketIntakeModule {}
