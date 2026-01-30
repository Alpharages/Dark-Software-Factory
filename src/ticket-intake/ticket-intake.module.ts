import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { MulterModule } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { memoryStorage } from 'multer';
import { TicketIntakeService } from './ticket-intake.service';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { TicketQualityController } from './ticket-quality.controller';
import { TicketIntakeConsumer } from './ticket-intake.consumer';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
// Story 2.12: Context Extraction
import { ContextExtractionService } from './context-extraction.service';
import { ContextCacheService } from './context-cache.service';
import { ContextDocumentController } from './context-document.controller';
import { PdfExtractor, MarkdownExtractor, TextExtractor, DocxExtractor } from './extractors';
import { contextMetricsProviders } from '../common/metrics/context-metrics.provider';
// Story 4.9: Project Mapping
import { ProjectModule } from '../projects/project.module';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
// Story 12.5: Dependency Management
import { DependenciesModule } from '../dependencies/dependencies.module';

// Metric names (must match service injection)
const METRICS = {
  INTAKE_TOTAL: 'dsf_ticket_intake_total',
  INTAKE_DURATION: 'dsf_ticket_intake_duration_seconds',
  VALIDATION_TOTAL: 'dsf_ticket_validation_total',
  QUALITY_SCORE: 'dsf_ticket_quality_score',
  WAITING_DEPENDENCIES: 'dsf_ticket_waiting_dependencies_total',
  CIRCULAR_DEPENDENCIES: 'dsf_circular_dependencies_detected_total',
};

/**
 * Ticket Intake Module
 * FR57: Parse ticket details from ClickUp
 * FR58: Validate ticket quality
 * Story 2.11: PM-facing quality scoring API
 * Story 2.12: Context document extraction (FR3, FR59)
 *
 * Processes incoming tickets from the webhook queue:
 * - Consumes from ticket-intake-queue (Story 2.1)
 * - Validates ticket data quality
 * - Calculates quality scores
 * - Routes validated tickets to AI processing
 * - Exposes PM-facing quality scoring API
 * - Handles context document uploads and extraction
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    // Story 4.9: Project Mapping
    ProjectModule,
    // Story 12.5: Dependency Management
    DependenciesModule,
    // Story 2.12: Cache for context extraction
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: config.get('context.cacheTtlHours', 24) * 60 * 60 * 1000,
        max: 500,
      }),
    }),
    // Story 2.12: File uploads
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
      },
    }),
    // Story 2.12: Rate limiting for uploads
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
  ],
  controllers: [
    TicketQualityController,
    ContextDocumentController, // Story 2.12
  ],
  providers: [
    // Services
    TicketIntakeService,
    TicketValidatorService,
    TicketQualityService,
    // Consumer
    TicketIntakeConsumer,
    // Story 2.12: Context extraction
    ContextExtractionService,
    ContextCacheService,
    PdfExtractor,
    MarkdownExtractor,
    TextExtractor,
    DocxExtractor,
    // Prometheus Metrics
    makeCounterProvider({
      name: METRICS.INTAKE_TOTAL,
      help: 'Total tickets processed',
      labelNames: ['provider', 'trigger', 'status'],
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
    makeCounterProvider({
      name: METRICS.WAITING_DEPENDENCIES,
      help: 'Total tickets waiting for dependencies',
    }),
    makeCounterProvider({
      name: METRICS.CIRCULAR_DEPENDENCIES,
      help: 'Total circular dependencies detected',
    }),
    // Story 2.12: Context metrics
    ...contextMetricsProviders,
  ],
  exports: [
    TicketIntakeService,
    TicketValidatorService,
    TicketQualityService,
    ContextExtractionService, // Story 2.12
    ContextCacheService, // Story 2.12
  ],
})
export class TicketIntakeModule {}
