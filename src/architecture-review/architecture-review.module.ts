import { Module, forwardRef } from '@nestjs/common';
import { ArchitectureReviewController } from './architecture-review.controller';
import { AdrService } from './adr.service';
import { RiskAssessmentService } from './risk-assessment.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { ArchitectureConstraintsController } from './architecture-constraints.controller';
import { ArchitectureConstraintsService } from './architecture-constraints.service';
import { ConstraintValidatorService } from './constraint-validator.service';
import { ClickUpModule } from '../clickup/clickup.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';

@Module({
    imports: [ClickUpModule, AIDecisionLoggerModule],
    controllers: [ArchitectureReviewController, ArchitectureConstraintsController],
    providers: [
        AdrService,
        RiskAssessmentService,
        ArchitectureReviewNotificationService,
        ArchitectureConstraintsService,
        ConstraintValidatorService
    ],
    exports: [AdrService, RiskAssessmentService, ArchitectureConstraintsService, ConstraintValidatorService],
})
export class ArchitectureReviewModule { }
