import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, Execution } from '@prisma/client';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ExecutionTrackerService } from './execution-tracker.service';
import {
  IAIExecutionMessage,
  IAIExecutionPayload,
  IStartExecutionInput,
  IExecutionFailure,
} from './interfaces';
import { PublishExecutionDto } from './dto';

/**
 * Convert priority (1-5, lower=higher) to complexity score (0-10, higher=more complex)
 * Priority 1 → Complexity 10, Priority 5 → Complexity 2
 */
const PRIORITY_TO_COMPLEXITY = (priority?: number): number => {
  if (!priority) return 6; // Default medium complexity
  return (6 - priority) * 2;
};

/**
 * AI Execution Publisher
 *
 * Publishes AI execution tasks to RabbitMQ queue for async processing.
 * Creates execution record before publishing.
 *
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
@Injectable()
export class AIExecutionPublisher {
  private readonly logger = new Logger(AIExecutionPublisher.name);

  constructor(
    private readonly publisher: RabbitMQPublisherService,
    private readonly executionTracker: ExecutionTrackerService,
    @InjectMetric('queue_messages_published_total')
    private readonly publishedCounter: Counter<string>,
    @InjectMetric('queue_publish_errors_total')
    private readonly publishErrorsCounter: Counter<string>,
  ) {}

  /**
   * Publish an AI execution task to the queue
   *
   * @param dto - Execution publish request
   * @param correlationId - Optional correlation ID (auto-generated if not provided)
   * @returns Created execution ID
   */
  async publishExecution(
    dto: PublishExecutionDto,
    correlationId?: string,
  ): Promise<{ executionId: string; correlationId: string }> {
    const corrId = correlationId || uuidv4();
    const messageId = uuidv4();

    // Determine AI provider (default to CURSOR_HEADLESS per Prisma enum)
    const aiProvider = dto.preferredProvider || AIProvider.CURSOR_HEADLESS;
    const priority = dto.priority || 3; // Default medium priority

    try {
      // 1. Create execution record in database via ExecutionTrackerService
      const executionInput: IStartExecutionInput = {
        correlationId: corrId,
        ticketId: dto.ticketId,
        clickupTaskId: dto.ticketId, // Using ticketId as clickupTaskId
        provider: aiProvider,
        prompt: dto.prompt,
        promptMetadata: {
          promptLength: dto.prompt.length,
          estimatedTokens: Math.ceil(dto.prompt.length / 4), // Rough token estimate
          templateVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
        },
        complexityScore: PRIORITY_TO_COMPLEXITY(dto.priority),
      };

      const execution: Execution = await this.executionTracker.startExecution(executionInput);
      const executionId = execution.id;

      // 2. Build queue message
      const payload: IAIExecutionPayload = {
        ticketId: dto.ticketId,
        executionId,
        aiProvider,
        priority,
        prompt: dto.prompt,
        repositoryUrl: dto.repositoryUrl,
        projectId: dto.projectId,
        targetBranch: dto.targetBranch,
        allowFallback: dto.allowFallback ?? true,
      };

      const message: IAIExecutionMessage = {
        messageId,
        timestamp: new Date().toISOString(),
        correlationId: corrId,
        payload,
      };

      // 3. Publish to queue with retry
      const published = await this.publisher.publishWithRetry(
        QUEUE_NAMES.AI_EXECUTION,
        message,
        3,
        corrId,
      );

      if (!published) {
        // Rollback: Mark execution as failed since it won't be processed
        await this.executionTracker.failExecution(
          {
            executionId,
            errorMessage: 'Failed to publish message to queue',
            isRetryable: true,
            errorCode: 'QUEUE_PUBLISH_FAILED',
          },
          corrId,
        );
        throw new Error('Failed to publish message to queue');
      }

      this.logger.log(
        `[${corrId}] Published execution ${executionId} to queue (priority: ${priority})`,
      );

      this.publishedCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        provider: aiProvider,
        priority: String(priority),
      });

      return { executionId, correlationId: corrId };
    } catch (error: any) {
      this.logger.error(`[${corrId}] Failed to publish execution: ${error.message}`);

      this.publishErrorsCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        error_type: error.name || 'UnknownError',
      });

      throw error;
    }
  }

  /**
   * Publish multiple executions (batch)
   */
  async publishBatch(
    executions: PublishExecutionDto[],
    correlationId?: string,
  ): Promise<{ executionIds: string[]; correlationId: string }> {
    const corrId = correlationId || uuidv4();
    const executionIds: string[] = [];

    for (const dto of executions) {
      const result = await this.publishExecution(dto, corrId);
      executionIds.push(result.executionId);
    }

    this.logger.log(`[${corrId}] Published batch of ${executionIds.length} executions`);

    return { executionIds, correlationId: corrId };
  }
}
