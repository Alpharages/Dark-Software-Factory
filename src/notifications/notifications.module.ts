import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeModule } from '../realtime/realtime.module'; // Adjust path if needed
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module'; // Needed for JwtAuthGuard if not global

import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { InAppNotificationsController } from './controllers/in-app-notifications.controller';

import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { InAppNotificationRepository } from './repositories/in-app-notification.repository';

import { SlackNotificationService } from './services/slack-notification.service';
import { EmailNotificationService } from './services/email-notification.service';
import { InAppNotificationService } from './services/in-app-notification.service';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    forwardRef(() => RealtimeModule), // Use forwardRef if circular dependency likely, or just RealtimeModule
    AuthModule,
  ],
  controllers: [NotificationPreferencesController, InAppNotificationsController],
  providers: [
    NotificationPreferenceRepository,
    InAppNotificationRepository,
    SlackNotificationService,
    EmailNotificationService,
    InAppNotificationService,
    NotificationDispatcherService,
    makeCounterProvider({
      name: 'notifications_dispatched_total',
      help: 'Total number of notifications dispatched',
      labelNames: ['user_id', 'event_type', 'channel', 'status'],
    }),
    makeCounterProvider({
      name: 'notifications_failed_total',
      help: 'Total number of failed notifications',
      labelNames: ['user_id', 'channel', 'event_type'],
    }),
  ],
  exports: [NotificationDispatcherService],
})
export class NotificationsModule {}
