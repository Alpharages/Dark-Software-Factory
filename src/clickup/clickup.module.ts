import { Module } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { SentryModule } from '../common/sentry/sentry.module';

/**
 * ClickUp API Integration Module
 * Story 4.6: Deployment Status Synchronization
 *
 * Provides ClickUp API client for updating task status and adding comments
 */
@Module({
  imports: [SentryModule],
  providers: [ClickUpService],
  exports: [ClickUpService],
})
export class ClickUpModule {}
