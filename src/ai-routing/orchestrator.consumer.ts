/**
 * Orchestrator Consumer
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * RabbitMQ consumer for async AI execution via orchestration.
 * Listens to orchestration queue and delegates to OrchestratorService.
 *
 * FR60-65: AI code generation orchestration
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { OrchestratorService } from './orchestrator.service';
import { IOrchestrationInput } from './interfaces';

/**
 * Queue message structure for orchestration requests
 */
interface IOrchestrationMessage {
  correlationId: string;
  ticketId: string;
  executionId: string;
  prompt: string;
  repositoryUrl: string;
  baseBranch?: string;
  targetFiles?: string[];
  tags?: string[];
  estimatedFilesCount?: number;
  providerOverride?: AIProvider;
  allowFallback?: boolean;
  timeoutMs?: number;
  title?: string;
  acceptanceCriteria?: string;
}

/**
 * Orchestrator Queue Consumer
 *
 * Consumes from: ai-execution-queue (or dedicated orchestration queue)
 * Delegates to OrchestratorService for intelligent provider selection and fallback
 */
@Injectable()
export class OrchestratorConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(OrchestratorConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly orchestrator: OrchestratorService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async startConsuming(): Promise<void> {
    this.logger.log(`Starting orchestrator consumer for ${QUEUE_NAMES.AI_EXECUTION}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.AI_EXECUTION, { durable: true });

      // Set prefetch for controlled concurrency (process 2 at a time for AI execution)
      await channel.prefetch(2);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.AI_EXECUTION,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log('Orchestrator consumer started successfully');
    } catch (error) {
      this.logger.error('Failed to start orchestrator consumer', error);
    }
  }

  /**
   * Process incoming orchestration request (implements abstract from base)
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const message = payload as IOrchestrationMessage;
    const ticketId = message.ticketId;

    this.logger.log(`[${correlationId}] Processing orchestration request for ticket ${ticketId}`);

    // Convert message to orchestration input
    const input: IOrchestrationInput = {
      correlationId: message.correlationId || correlationId,
      executionId: message.executionId,
      ticketId: message.ticketId,
      prompt: message.prompt,
      repositoryUrl: message.repositoryUrl,
      baseBranch: message.baseBranch,
      targetFiles: message.targetFiles,
      tags: message.tags,
      estimatedFilesCount: message.estimatedFilesCount,
      providerOverride: message.providerOverride,
      allowFallback: message.allowFallback ?? true,
      timeoutMs: message.timeoutMs,
      title: message.title,
      acceptanceCriteria: message.acceptanceCriteria,
    };

    // Execute orchestration
    const result = await this.orchestrator.execute(input);

    if (result.success) {
      this.logger.log(
        `[${correlationId}] Orchestration completed: ` +
          `provider=${result.executedBy}, files=${result.filesChanged.length}`,
      );
    } else {
      // Throw error to trigger retry logic in base class
      if (result.error?.isRetryable) {
        throw new Error(`Retryable: ${result.error.message}`);
      }
      this.logger.warn(
        `[${correlationId}] Orchestration failed (non-retryable): ${result.error?.message}`,
      );
    }
  }
}
