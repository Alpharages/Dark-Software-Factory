import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { TaskType, ExecutionStatus } from '@/prisma/client';
import { AiCapabilityService } from './ai-capability.service';
import { ArchitectureReviewNotificationService } from '../architecture-review-notification.service';

export interface DetectedPattern {
  taskType: TaskType;
  failureRate: number;
  executionsSampled: number;
  patternSignature: string;
  exampleIds: string[];
}

@Injectable()
export class PatternDetectorService {
  private readonly logger = new Logger(PatternDetectorService.name);

  // Configurable thresholds
  private readonly WARNING_THRESHOLD = 40; // Alert TL at 40% failure rate
  private readonly CRITICAL_THRESHOLD = 70; // Disable task at 70% failure rate
  private readonly SAMPLE_SIZE = 50; // Analyze last 50 executions per task type

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityService: AiCapabilityService,
    private readonly notificationService: ArchitectureReviewNotificationService,
  ) { }

  /**
   * Scheduled job to analyze execution patterns and detect AI limitations
   * Runs daily at 2 AM to avoid impacting production workloads
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'pattern-detection-analysis',
  })
  async analyzeExecutionPatterns(): Promise<void> {
    this.logger.log('Starting scheduled pattern detection analysis');

    try {
      const taskTypes = Object.values(TaskType);
      const detectedPatterns: DetectedPattern[] = [];

      for (const taskType of taskTypes) {
        const pattern = await this.analyzeTaskType(taskType);

        if (pattern) {
          detectedPatterns.push(pattern);
          await this.handleDetectedPattern(pattern);
        }
      }

      if (detectedPatterns.length > 0) {
        this.logger.log(`Pattern detection complete: ${detectedPatterns.length} patterns detected`);
      } else {
        this.logger.log('Pattern detection complete: No concerning patterns found');
      }
    } catch (error) {
      this.logger.error('Pattern detection analysis failed', (error as Error).stack);
    }
  }

  /**
   * Analyze a specific task type for failure patterns
   * Returns pattern details if failure rate exceeds threshold
   */
  async analyzeTaskType(taskType: TaskType): Promise<DetectedPattern | null> {
    try {
      // Fetch last N executions for this task type
      const executions = await this.prisma.execution.findMany({
        where: {
          task_type: taskType,
          status: {
            in: [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED],
          },
        },
        orderBy: { created_at: 'desc' },
        take: this.SAMPLE_SIZE,
        select: {
          id: true,
          status: true,
          error_message: true,
        },
      });

      if (executions.length === 0) {
        return null; // No data to analyze
      }

      // Calculate failure rate
      const failures = executions.filter((e) => e.status === ExecutionStatus.FAILED);
      const failureRate = (failures.length / executions.length) * 100;

      // Only return pattern if it exceeds warning threshold
      if (failureRate < this.WARNING_THRESHOLD) {
        return null;
      }

      // Generate pattern signature from common error patterns
      const errorMessages = failures
        .map((f) => f.error_message)
        .filter((msg): msg is string => Boolean(msg));
      const patternSignature = this.generatePatternSignature(errorMessages);

      const pattern: DetectedPattern = {
        taskType,
        failureRate: Math.round(failureRate * 100) / 100,
        executionsSampled: executions.length,
        patternSignature,
        exampleIds: failures.slice(0, 5).map((f) => f.id), // First 5 examples
      };

      return pattern;
    } catch (error) {
      this.logger.error(`Failed to analyze task type ${taskType}`, (error as Error).stack);
      return null;
    }
  }

  /**
   * Handle a detected failure pattern
   * - Save/update pattern in database
   * - Notify TL if warning threshold exceeded
   * - Disable task type if critical threshold exceeded
   */
  private async handleDetectedPattern(pattern: DetectedPattern): Promise<void> {
    try {
      // Save or update pattern in database
      await this.prisma.aiTaskPattern.upsert({
        where: {
          id: `${pattern.taskType}-${pattern.patternSignature}`,
        },
        create: {
          id: `${pattern.taskType}-${pattern.patternSignature}`,
          task_type: pattern.taskType,
          failure_rate: pattern.failureRate,
          pattern_signature: pattern.patternSignature,
          example_ids: pattern.exampleIds,
        },
        update: {
          failure_rate: pattern.failureRate,
          example_ids: pattern.exampleIds,
          updated_at: new Date(),
        },
      });

      // Determine severity and action
      const isCritical = pattern.failureRate >= this.CRITICAL_THRESHOLD;

      if (isCritical) {
        // Disable the task type
        await this.capabilityService.updateLimitations(
          pattern.taskType,
          `Critical failure rate detected: ${pattern.failureRate}% (${pattern.executionsSampled} samples)`,
          'Manual intervention required - AI disabled for this task type',
          true, // isDisabled
        );

        this.logger.warn(
          `CRITICAL: Disabled ${pattern.taskType} due to ${pattern.failureRate}% failure rate`,
        );
      }

      // Notify TL about the pattern
      await this.notifyTechLead(pattern, isCritical);
    } catch (error) {
      this.logger.error(
        `Failed to handle detected pattern for ${pattern.taskType}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Generate a pattern signature from error messages
   * Uses simple keyword extraction for MVP
   */
  private generatePatternSignature(errorMessages: string[]): string {
    if (errorMessages.length === 0) {
      return 'unknown-pattern';
    }

    // Extract common keywords (simple implementation)
    const keywords: Record<string, number> = {};

    errorMessages.forEach((msg) => {
      const words = msg
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4); // Filter short words

      words.forEach((word) => {
        keywords[word] = (keywords[word] || 0) + 1;
      });
    });

    // Find most common keyword
    const sortedKeywords = Object.entries(keywords).sort(([, a], [, b]) => b - a);

    if (sortedKeywords.length > 0) {
      return `${sortedKeywords[0][0]}-error`;
    }

    return 'pattern-detected';
  }

  /**
   * Notify Tech Lead about detected pattern (C7 fix: proper type safety)
   */
  private async notifyTechLead(pattern: DetectedPattern, isCritical: boolean): Promise<void> {
    try {
      await this.notificationService.notifyAiCapabilityPattern(
        {
          taskType: pattern.taskType,
          failureRate: pattern.failureRate,
          executionsSampled: pattern.executionsSampled,
          patternSignature: pattern.patternSignature,
          exampleIds: pattern.exampleIds,
        },
        isCritical,
      );

      const severity = isCritical ? 'CRITICAL' : 'WARNING';
      this.logger.log(`Notified TL about ${severity} pattern in ${pattern.taskType}`);
    } catch (error) {
      this.logger.error('Failed to notify TL', (error as Error).stack);
      // Don't throw - notification failures shouldn't block pattern detection
    }
  }

  /**
   * Manual trigger for pattern analysis (for testing/debugging)
   */
  async triggerAnalysis(): Promise<DetectedPattern[]> {
    const taskTypes = Object.values(TaskType);
    const patterns: DetectedPattern[] = [];

    for (const taskType of taskTypes) {
      const pattern = await this.analyzeTaskType(taskType);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }
}
