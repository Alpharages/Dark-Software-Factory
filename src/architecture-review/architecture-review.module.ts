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

@Module({
  imports: [ClickUpModule, AIDecisionLoggerModule, EventBusModule, CapabilitiesModule],
  controllers: [ArchitectureReviewController, ArchitectureConstraintsController],
  providers: [
    AdrService,
    RiskAssessmentService,
    ArchitectureReviewNotificationService,
    EscalationService,
    EscalationDetectorService,
    ConstraintValidatorService,
    ArchitectureConstraintsService,
  ],
  exports: [AdrService],
})
export class ArchitectureReviewModule {}
