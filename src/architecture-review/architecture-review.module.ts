import { Module } from '@nestjs/common';
import { AdrService } from './adr.service';
import { ArchitectureReviewController } from './architecture-review.controller';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { ClickUpModule } from '../clickup/clickup.module';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';

@Module({
    imports: [DatabaseModule, AppMetricsModule, ClickUpModule],
    controllers: [ArchitectureReviewController],
    providers: [AdrService, ArchitectureReviewNotificationService],
    exports: [AdrService, ArchitectureReviewNotificationService],
})
export class ArchitectureReviewModule { }
