import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { InAppNotification, Prisma } from '@/prisma';

@Injectable()
export class InAppNotificationRepository {
  private readonly logger = new Logger(InAppNotificationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(
    userId: string,
    unreadOnly: boolean = false,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ notifications: InAppNotification[]; total: number; unread: number }> {
    const skip = (page - 1) * limit;
    const where = { userId } as Prisma.InAppNotificationWhereInput;

    if (unreadOnly) {
      where.read = false;
    }

    const [notifications, total, unread] = await Promise.all([
      this.prisma.inAppNotification.findMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.prisma.inAppNotification.count({ where: where as any }),
      this.prisma.inAppNotification.count({ where: { userId, read: false } }),
    ]);

    return { notifications, total, unread };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.inAppNotification.count({
      where: { userId, read: false },
    });
  }

  async create(data: {
    userId: string;
    eventType: string;
    title: string;
    message: string;
    payload?: Prisma.InputJsonValue;
    read?: boolean;
  }): Promise<InAppNotification> {
    return this.prisma.inAppNotification.create({
      data: {
        ...data,
        payload: data.payload ?? undefined,
      },
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<InAppNotification> {
    return this.prisma.inAppNotification.update({
      where: { id: notificationId, userId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.inAppNotification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return result.count;
  }
}
