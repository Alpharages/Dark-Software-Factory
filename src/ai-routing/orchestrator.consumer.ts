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
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { OrchestratorService } from './orchestrator.service';
import { PromptGeneratorService } from './prompt-generator.service';
import { IOrchestrationInput, IRoutingResult } from './interfaces';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

/**
 * Orchestrator Queue Consumer
 *
 * Consumes from: ai-execution-queue (receives IRoutingResult from routing service)
 * Generates prompts, updates execution records, and delegates to OrchestratorService
 */
@Injectable()
export class OrchestratorConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(OrchestratorConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly orchestrator: OrchestratorService,
    private readonly promptGenerator: PromptGeneratorService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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

      // Ensure queue exists (config must match rabbitmq.service.ts)
      await channel.assertQueue(QUEUE_NAMES.AI_EXECUTION, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': `dlx-${QUEUE_NAMES.AI_EXECUTION}`,
        },
      });

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
   * Process incoming routing result (implements abstract from base)
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const routingResult = payload as IRoutingResult;
    const { ticketId, executionId, provider } = routingResult;

    this.logger.log(`[${correlationId}] Processing routing result for ticket ${ticketId}`);
    this.logger.log(
      `[${correlationId}] Provider selected: primary=${provider}, fallback=null, complexity=${routingResult.complexityScore}`,
    );

    // 1. Generate prompt from routing result
    const promptResult = await this.promptGenerator.generatePrompt(routingResult);
    this.logger.log(
      `[${correlationId}] Prompt generated: ${promptResult.metadata.promptLength} chars`,
    );

    // 2. Update execution record with prompt
    await this.prisma.execution.update({
      where: { id: executionId },
      data: { prompt: promptResult.prompt },
    });

    // 3. Get repository URL from config
    const repositoryUrl = this.configService.get<string>('github.defaultRepository', '');

    this.logger.log(
      `[${correlationId}] Retrieved repository URL: "${repositoryUrl}" (from config github.defaultRepository)`,
    );

    if (!repositoryUrl) {
      throw new Error('github.defaultRepository not configured in .env');
    }

    // 4. Convert to orchestration input
    const input: IOrchestrationInput = {
      correlationId,
      executionId,
      ticketId,
      prompt: promptResult.prompt,
      repositoryUrl,
      allowFallback: true,
    };

    // 5. Execute orchestration
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
