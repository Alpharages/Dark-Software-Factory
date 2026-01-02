import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiCapabilityService } from './ai-capability.service';
import { PatternDetectorService } from './pattern-detector.service';
import { AiCapabilityTrackerService } from './ai-capability-tracker.service';
import { CapabilitiesController } from './capabilities.controller';
import { DatabaseModule } from '../../database/database.module';
import { ArchitectureReviewNotificationService } from '../architecture-review-notification.service';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(), // Enable cron jobs
  ],
  controllers: [CapabilitiesController],
  providers: [
    AiCapabilityService,
    PatternDetectorService,
    AiCapabilityTrackerService,
    ArchitectureReviewNotificationService,
  ],
  exports: [AiCapabilityService, PatternDetectorService, AiCapabilityTrackerService],
})
export class CapabilitiesModule {}
