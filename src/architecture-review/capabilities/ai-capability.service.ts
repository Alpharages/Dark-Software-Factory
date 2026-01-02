import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TaskType } from '@/prisma/client';

export interface CapabilityMetrics {
  taskType: TaskType;
  successCount: number;
  failureCount: number;
  totalExecutions: number;
  successRate: number;
  knownIssues?: string;
  workaround?: string;
  isDisabled: boolean;
}

export interface TrackExecutionOptions {
  taskType: TaskType;
  success: boolean;
  errorDetails?: string;
}

@Injectable()
export class AiCapabilityService {
  private readonly logger = new Logger(AiCapabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Track the result of an AI execution for capability metrics
   * Updates success/failure counts for the given task type
   */
  async trackExecutionResult(
    taskType: TaskType,
    success: boolean,
    errorDetails?: string,
  ): Promise<void> {
    try {
      // Upsert capability record
      await this.prisma.aiCapability.upsert({
        where: { task_type: taskType },
        create: {
          task_type: taskType,
          success_count: success ? 1 : 0,
          failure_count: success ? 0 : 1,
        },
        update: {
          success_count: success ? { increment: 1 } : undefined,
          failure_count: success ? undefined : { increment: 1 },
          updated_at: new Date(),
        },
      });

      this.logger.log(
        `Tracked ${success ? 'success' : 'failure'} for ${taskType}${
          errorDetails ? `: ${errorDetails}` : ''
        }`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to track execution result for ${taskType}`,
        (_error as Error).stack,
      );
      // Don't throw - tracking failures shouldn't block execution
    }
  }

  /**
   * Get capability metrics for all task types or specific type
   * Returns success rates, known issues, and workarounds
   */
  async getCapabilityMetrics(taskType?: TaskType): Promise<CapabilityMetrics[]> {
    try {
      const where = taskType ? { task_type: taskType } : {};

      const capabilities = await this.prisma.aiCapability.findMany({
        where,
        orderBy: { task_type: 'asc' },
      });

      return capabilities.map((cap) => {
        const totalExecutions = cap.success_count + cap.failure_count;
        const successRate = totalExecutions > 0 ? (cap.success_count / totalExecutions) * 100 : 0;

        return {
          taskType: cap.task_type,
          successCount: cap.success_count,
          failureCount: cap.failure_count,
          totalExecutions,
          successRate: Math.round(successRate * 100) / 100, // Round to 2 decimals
          knownIssues: cap.known_issues || undefined,
          workaround: cap.workaround || undefined,
          isDisabled: cap.is_disabled,
        };
      });
    } catch (_error) {
      this.logger.error('Failed to get capability metrics', (_error as Error).stack);
      throw _error;
    }
  }

  /**
   * Get AI limitations for a specific task type
   * Returns known issues and workarounds if the task is problematic
   */
  async getLimitations(
    taskType: TaskType,
  ): Promise<{ knownIssues?: string; workaround?: string } | null> {
    try {
      const capability = await this.prisma.aiCapability.findUnique({
        where: { task_type: taskType },
        select: {
          known_issues: true,
          workaround: true,
          is_disabled: true,
        },
      });

      if (!capability || capability.is_disabled) {
        return null;
      }

      return {
        knownIssues: capability.known_issues || undefined,
        workaround: capability.workaround || undefined,
      };
    } catch (_error) {
      this.logger.error(`Failed to get limitations for ${taskType}`, (_error as Error).stack);
      return null;
    }
  }

  /**
   * Update known issues and workarounds for a task type
   */
  async updateLimitations(
    taskType: TaskType,
    knownIssues?: string,
    workaround?: string,
    isDisabled?: boolean,
  ): Promise<void> {
    try {
      await this.prisma.aiCapability.upsert({
        where: { task_type: taskType },
        create: {
          task_type: taskType,
          known_issues: knownIssues,
          workaround,
          is_disabled: isDisabled ?? false,
        },
        update: {
          known_issues: knownIssues,
          workaround,
          is_disabled: isDisabled,
          updated_at: new Date(),
        },
      });

      this.logger.log(`Updated limitations for ${taskType}`);
    } catch (_error) {
      this.logger.error(`Failed to update limitations for ${taskType}`, (_error as Error).stack);
      throw _error;
    }
  }

  /**
   * Check if a task type is disabled (AI should not attempt it)
   */
  async isTaskDisabled(taskType: TaskType): Promise<boolean> {
    try {
      const capability = await this.prisma.aiCapability.findUnique({
        where: { task_type: taskType },
        select: { is_disabled: true },
      });

      return capability?.is_disabled ?? false;
    } catch (_error) {
      this.logger.error(`Failed to check if ${taskType} is disabled`, (_error as Error).stack);
      return false; // Fail open - allow execution if check fails
    }
  }
}
