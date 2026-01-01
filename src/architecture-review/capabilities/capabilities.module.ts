import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiCapabilityService } from './ai-capability.service';
import { PatternDetectorService } from './pattern-detector.service';
import { CapabilitiesController } from './capabilities.controller';
import { DatabaseModule } from '../../database/database.module';
import { ArchitectureReviewNotificationService } from '../architecture-review-notification.service';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(), // Enable cron jobs
  ],
  controllers: [CapabilitiesController],
  providers: [AiCapabilityService, PatternDetectorService, ArchitectureReviewNotificationService],
  exports: [AiCapabilityService, PatternDetectorService],
})
export class CapabilitiesModule {}
