import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionActivity } from '@/prisma/client';

export interface CreateActivityInput {
  executionId: string;
  activity: string;
  detail?: string | null;
  rawContent?: string | null;
  category: string;
  icon: string;
  suggestedPercent?: number | null;
  timestamp?: Date;
}

@Injectable()
export class ExecutionActivityRepository {
  private readonly logger = new Logger(ExecutionActivityRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a single activity event
   */
  async save(data: CreateActivityInput): Promise<ExecutionActivity> {
    return this.prisma.executionActivity.create({
      data: {
        executionId: data.executionId,
        activity: data.activity,
        detail: data.detail ?? null,
        rawContent: data.rawContent ?? null,
        category: data.category,
        icon: data.icon,
        suggestedPercent: data.suggestedPercent ?? null,
        timestamp: data.timestamp || new Date(),
      },
    });
  }

  /**
   * Save a batch of activity events (for bulk inserts)
   */
  async saveBatch(activities: CreateActivityInput[]): Promise<void> {
    if (activities.length === 0) return;

    await this.prisma.executionActivity.createMany({
      data: activities.map((a) => ({
        executionId: a.executionId,
        activity: a.activity,
        detail: a.detail ?? null,
        rawContent: a.rawContent ?? null,
        category: a.category,
        icon: a.icon,
        suggestedPercent: a.suggestedPercent ?? null,
        timestamp: a.timestamp || new Date(),
      })),
    });
  }

  /**
   * Find activities by execution ID with pagination and optional category filter
   */
  async findByExecution(
    executionId: string,
    options?: {
      categories?: string[];
      page?: number;
      limit?: number;
    },
  ): Promise<[ExecutionActivity[], number]> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 100;
    const skip = (page - 1) * limit;

    const where = {
      executionId,
      ...(options?.categories && options.categories.length > 0
        ? { category: { in: options.categories } }
        : {}),
    };

    const [activities, total] = await Promise.all([
      this.prisma.executionActivity.findMany({
        where,
        orderBy: { timestamp: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.executionActivity.count({ where }),
    ]);

    return [activities, total];
  }

  /**
   * Get the latest N activities for an execution (for dashboard timeline)
   */
  async findLatest(executionId: string, limit = 20): Promise<ExecutionActivity[]> {
    return this.prisma.executionActivity.findMany({
      where: { executionId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Delete activities older than X days (retention policy)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.executionActivity.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }
}
