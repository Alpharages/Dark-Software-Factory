import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionLog } from '@/prisma/client';

@Injectable()
export class ExecutionLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a single log entry
   */
  async save(data: {
    executionId: string;
    level: string;
    message: string;
    source: string;
    timestamp?: Date;
  }): Promise<ExecutionLog> {
    return this.prisma.executionLog.create({
      data: {
        executionId: data.executionId,
        level: data.level,
        message: data.message,
        source: data.source,
        timestamp: data.timestamp || new Date(),
      },
    });
  }

  /**
   * Save a batch of logs
   * Optimized for bulk insertion
   */
  async saveBatch(
    logs: Array<{
      executionId: string;
      level: string;
      message: string;
      source: string;
      timestamp?: Date;
    }>,
  ): Promise<void> {
    if (logs.length === 0) return;

    await this.prisma.executionLog.createMany({
      data: logs.map((log) => ({
        executionId: log.executionId,
        level: log.level,
        message: log.message,
        source: log.source,
        timestamp: log.timestamp || new Date(),
      })),
    });
  }

  /**
   * Find logs by execution ID with pagination and filtering
   */
  async findByExecution(
    executionId: string,
    levels?: string[],
    page = 1,
    limit = 100,
  ): Promise<[ExecutionLog[], number]> {
    const skip = (page - 1) * limit;
    const where = {
      executionId,
      ...(levels && levels.length > 0 ? { level: { in: levels } } : {}),
    };

    const [logs, total] = await Promise.all([
      this.prisma.executionLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.executionLog.count({ where }),
    ]);

    return [logs, total];
  }

  /**
   * Delete logs older than X days
   * Used for retention policy
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.executionLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }
}
