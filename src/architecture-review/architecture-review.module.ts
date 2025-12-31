import { Module } from '@nestjs/common';
import { AdrService } from './adr.service';
import { ArchitectureReviewController } from './architecture-review.controller';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';

@Module({
    imports: [DatabaseModule, AppMetricsModule],
    controllers: [ArchitectureReviewController],
    providers: [AdrService],
    exports: [AdrService],
})
export class ArchitectureReviewModule { }
