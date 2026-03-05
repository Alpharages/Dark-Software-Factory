import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationPreference, Prisma } from '@/prisma/client';
import { CreateNotificationPreferenceDto } from '../dto/create-notification-preference.dto';
import { UpdateNotificationPreferenceDto } from '../dto/update-notification-preference.dto';

@Injectable()
export class NotificationPreferenceRepository {
  private readonly logger = new Logger(NotificationPreferenceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
    });
  }

  async findByUserAndEventType(
    userId: string,
    eventType: string,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: {
        userId_eventType: {
          userId,
          eventType,
        },
      },
    });
  }

  async create(
    userId: string,
    data: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.create({
      data: {
        userId,
        ...data,
        channels: data.channels as Prisma.InputJsonValue, // Prisma Json handling
        filterCriteria: data.filterCriteria
          ? (data.filterCriteria as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    // Ownership check is done implicitly by where clause if needed,
    // but typically service layer ensures ownership before calling update.
    // However, including userId in where clause safeguards against ID enumeration.
    return this.prisma.notificationPreference.update({
      where: { id, userId },
      data: {
        ...data,
        channels: data.channels ? (data.channels as Prisma.InputJsonValue) : undefined,
        filterCriteria: data.filterCriteria
          ? (data.filterCriteria as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async delete(id: string, userId: string): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.delete({
      where: { id, userId },
    });
  }
}
