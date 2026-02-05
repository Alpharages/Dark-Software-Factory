import { Injectable, Logger, Optional } from '@nestjs/common';
import { InAppNotificationRepository } from '../repositories/in-app-notification.repository';
import { RealtimeService } from '../../realtime/realtime.service';
import { InAppNotification } from '@/prisma';

@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    private readonly repository: InAppNotificationRepository,
    @Optional() private readonly realtimeService?: RealtimeService,
  ) {}

  async createNotification(
    userId: string,
    eventType: string,
    title: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<InAppNotification> {
    // Create notification in database
    const notification = await this.repository.create({
      userId,
      eventType,
      title,
      message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: payload as any,
      read: false,
    });

    // Emit WebSocket event to user room
    if (this.realtimeService) {
      try {
        this.realtimeService.emitToUser(userId, 'notification.new', {
          notificationId: notification.id,
          title: notification.title,
          message: notification.message,
          eventType: notification.eventType,
          createdAt: notification.createdAt,
          payload: notification.payload,
        });
        this.logger.debug(`In-app notification emitted via WebSocket to user ${userId}`);
      } catch (error) {
        this.logger.error(`Failed to emit notification.new event:`, error);
        // We catch here because DB persistence succeeded, so notification is safe
      }
    } else {
      this.logger.warn('RealtimeService not available. Skipping WebSocket emission.');
    }

    return notification;
  }

  async markAsRead(notificationId: string, userId: string): Promise<InAppNotification> {
    return this.repository.markAsRead(notificationId, userId);
  }

  async markAllAsRead(userId: string): Promise<number> {
    return this.repository.markAllAsRead(userId);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.repository.getUnreadCount(userId);
  }
}
