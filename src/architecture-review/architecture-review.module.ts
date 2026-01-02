import { Module } from '@nestjs/common';
import { ArchitectureReviewController } from './architecture-review.controller';
import { AdrService } from './adr.service';
import { RiskAssessmentService } from './risk-assessment.service';
import { EventBusModule } from '../common/event-bus.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { ArchitectureConstraintsController } from './architecture-constraints.controller';
import { ArchitectureConstraintsService } from './architecture-constraints.service';
import { ConstraintValidatorService } from './constraint-validator.service';
import { ClickUpModule } from '../clickup/clickup.module';
import { EscalationService } from './escalation.service';
import { EscalationDetectorService } from './escalation-detector.service';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { AdrMetricsService } from './metrics/adr-metrics.service';
import { AdrInsightsService } from './metrics/adr-insights.service';
import { AdrAlertService } from './metrics/adr-alert.service';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { AppMetricsModule } from '../common/metrics/metrics.module';

import { ArchitectureReviewMetricsController } from './architecture-review-metrics.controller';

@Module({
  imports: [
    ClickUpModule,
    AIDecisionLoggerModule,
    EventBusModule,
    CapabilitiesModule,
    AppMetricsModule,
  ],
  controllers: [
    ArchitectureReviewController,
    ArchitectureConstraintsController,
    ArchitectureReviewMetricsController,
  ],
  providers: [
    AdrService,
    RiskAssessmentService,
    ArchitectureReviewNotificationService,
    EscalationService,
    EscalationDetectorService,
    ConstraintValidatorService,
    ArchitectureConstraintsService,
    AdrMetricsService,
    AdrInsightsService,
    AdrAlertService,
    makeCounterProvider({
      name: 'adr_reviews_total',
      help: 'Total number of ADR reviews',
      labelNames: ['status', 'risk_level', 'project_id'],
    }),
    makeHistogramProvider({
      name: 'adr_review_duration_seconds',
      help: 'Duration of ADR reviews in seconds',
      labelNames: ['risk_level'],
      buckets: [180, 300, 600, 900, 1200, 1800, 3600],
    }),
    makeGaugeProvider({
      name: 'adr_queue_depth',
      help: 'Current depth of the ADR review queue',
    }),
    makeGaugeProvider({
      name: 'adr_approval_rate',
      help: 'Current approval rate of ADRs',
      labelNames: ['status'],
    }),
  ],
  exports: [AdrService],
})
export class ArchitectureReviewModule {}
