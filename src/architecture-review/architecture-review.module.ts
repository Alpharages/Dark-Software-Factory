import { Module, forwardRef } from '@nestjs/common';
import { ArchitectureReviewController } from './architecture-review.controller';
import { AdrService } from './adr.service';
import { RiskAssessmentService } from './risk-assessment.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { ClickUpModule } from '../clickup/clickup.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';

@Module({
    imports: [ClickUpModule, AIDecisionLoggerModule],
    controllers: [ArchitectureReviewController],
    providers: [
        AdrService,
        RiskAssessmentService,
        ArchitectureReviewNotificationService
    ],
    exports: [AdrService, RiskAssessmentService],
})
export class ArchitectureReviewModule { }
