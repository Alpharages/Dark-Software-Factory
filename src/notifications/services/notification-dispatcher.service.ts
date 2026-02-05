import { Injectable, Logger } from '@nestjs/common';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { SlackNotificationService } from './slack-notification.service';
import { EmailNotificationService } from './email-notification.service';
import { InAppNotificationService } from './in-app-notification.service';
import { UsersService } from '../../auth/users/users.service';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { AuditLogService } from '../../common/audit/audit-log.service';

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly rateLimits = new Map<string, { count: number; lastReset: number }>();
  private readonly MAX_NOTIFICATIONS_PER_HOUR = 100;

  constructor(
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly slackService: SlackNotificationService,
    private readonly emailService: EmailNotificationService,
    private readonly inAppService: InAppNotificationService,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
    @InjectMetric('notifications_dispatched_total')
    private readonly dispatchedCounter: Counter<string>,
    @InjectMetric('notifications_failed_total')
    private readonly failedCounter: Counter<string>,
  ) {}

  async dispatch(event: {
    userId: string;
    eventType: string;
    title: string;
    message: string;
    payload: Record<string, unknown>;
    channels?: string[]; // Optional override
  }): Promise<void> {
    const { userId, eventType, title, message, payload, channels: overrideChannels } = event;

    try {
      // 0. Rate Limiting
      if (this.isRateLimited(userId)) {
        this.logger.warn(`User ${userId} rate limited for notifications`);
        this.failedCounter.inc({ user_id: userId, channel: 'all', event_type: eventType });
        return;
      }

      // 1. Fetch user once
      const user = await this.usersService.getUserById(userId);
      if (!user) {
        this.logger.error(`User ${userId} not found during notification dispatch`);
        return;
      }

      // 2. Fetch user preferences
      const preference = await this.preferenceRepo.findByUserAndEventType(userId, eventType);

      let channels = overrideChannels;
      let filterCriteria = null;

      if (preference) {
        if (!preference.enabled) {
          this.logger.debug(`Notification for ${eventType} disabled by user ${userId}`);
          return;
        }
        if (!channels) {
          channels = preference.channels as string[];
        }
        filterCriteria = preference.filterCriteria;
      } else if (!channels) {
        channels = ['in_app'];
      }

      // 3. Apply Filters
      if (
        filterCriteria &&
        !this.matchesFilters(payload, filterCriteria as Record<string, unknown>)
      ) {
        this.logger.debug(`Notification ${eventType} filtered out for user ${userId}`);
        this.dispatchedCounter.inc({
          user_id: userId,
          event_type: eventType,
          channel: 'none',
          status: 'filtered',
        });
        return;
      }

      // 4. Dispatch to Channels
      const promises: Promise<unknown>[] = [];

      if (channels.includes('in_app')) {
        promises.push(
          this.inAppService
            .createNotification(userId, eventType, title, message, payload)
            .then(() =>
              this.dispatchedCounter.inc({
                user_id: userId,
                event_type: eventType,
                channel: 'in_app',
                status: 'sent',
              }),
            )
            .catch((e) => {
              this.logger.error(`Failed to send In-App notification: ${e.message}`);
              this.failedCounter.inc({ user_id: userId, channel: 'in_app', event_type: eventType });
            }),
        );
      }

      if (channels.includes('email') && user.email) {
        promises.push(
          this.emailService
            .sendEmail(userId, user.email, eventType, payload)
            .then(() =>
              this.dispatchedCounter.inc({
                user_id: userId,
                event_type: eventType,
                channel: 'email',
                status: 'sent',
              }),
            )
            .catch((e) => {
              this.logger.error(`Failed to send email notification: ${e.message}`);
              this.failedCounter.inc({ user_id: userId, channel: 'email', event_type: eventType });
            }),
        );
      } else if (channels.includes('email')) {
        this.logger.warn(`User ${userId} has no email configured`);
      }

      if (channels.includes('slack') && user.slackMemberId) {
        promises.push(
          this.slackService
            .sendSlackMessage(userId, eventType, payload, user.slackMemberId)
            .then(() =>
              this.dispatchedCounter.inc({
                user_id: userId,
                event_type: eventType,
                channel: 'slack',
                status: 'sent',
              }),
            )
            .catch((e) => {
              this.logger.error(`Failed to dispatch slack notification: ${e.message}`);
              this.failedCounter.inc({ user_id: userId, channel: 'slack', event_type: eventType });
            }),
        );
      } else if (channels.includes('slack')) {
        this.logger.debug(`User ${userId} has no slackMemberId configured`);
      }

      await Promise.allSettled(promises);

      // Audit Log
      await this.auditLogService.log({
        entityType: 'Notification',
        entityId: userId,
        action: 'DISPATCH',
        actorType: 'system',
        afterState: { eventType, channels },
      });
    } catch (error) {
      this.logger.error(`Error dispatching notification for ${userId} / ${eventType}`, error);
      this.failedCounter.inc({ user_id: userId, channel: 'dispatch_error', event_type: eventType });
    }
  }

  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(userId);

    if (!limit || now - limit.lastReset > 3600000) {
      this.rateLimits.set(userId, { count: 1, lastReset: now });
      return false;
    }

    if (limit.count >= this.MAX_NOTIFICATIONS_PER_HOUR) {
      return true;
    }

    limit.count++;
    return false;
  }

  private matchesFilters(
    payload: Record<string, unknown>,
    criteria: Record<string, unknown>,
  ): boolean {
    if (!criteria) return true;

    if (criteria.projectId && payload.projectId !== criteria.projectId) {
      return false;
    }

    if (criteria.severity && Array.isArray(criteria.severity)) {
      if (!criteria.severity.includes(payload.severity)) {
        return false;
      }
    }

    return true;
  }
}
