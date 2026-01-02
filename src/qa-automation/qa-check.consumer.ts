/**
 * QA Check Consumer
 * Story 3.7: RabbitMQ QA Queue Processing
 *
 * Consumes QA check messages from qa-check-queue and orchestrates parallel QA checks
 * AC#2: Creates QA result record, runs checks in parallel, stores partial results,
 *       evaluates gate, publishes result events
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QUEUE_METRICS } from '../common/metrics/metrics.constants';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { IQaQueueMessage } from './interfaces';

/**
 * QA Check Consumer
 * Extends RabbitMQConsumerBase for consistent error handling and retry logic
 * AC#3: Exposes queue depth, processing rate, consumer count metrics
 * AC#4: Implements exponential backoff retry and DLQ routing
 */
@Injectable()
export class QaCheckConsumer extends RabbitMQConsumerBase implements OnModuleInit, OnModuleDestroy {
  protected readonly logger = new Logger(QaCheckConsumer.name); // Required by RabbitMQConsumerBase
  private readonly loggerService: LoggerService; // Story 3.7: Use LoggerService for structured logging
  private readonly concurrency: number;
  private readonly depthCheckInterval: number;
  private depthIntervalId?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly configService: ConfigService,
    private readonly qaOrchestratorService: QaOrchestratorService,
    private readonly sentryService: SentryService,
    logger: LoggerService,
    @InjectMetric(QUEUE_METRICS.DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric(QUEUE_METRICS.CONSUMER_COUNT)
    private readonly consumerCountGauge: Gauge<string>,
    @InjectMetric(QUEUE_METRICS.PROCESSING_RATE)
    private readonly processingRateCounter: Counter<string>,
  ) {
    super();
    this.loggerService = logger; // Use LoggerService for structured logging
    this.concurrency = this.configService.get<number>('qa.check.concurrency', 5);
    this.depthCheckInterval = this.configService.get<number>('qa.check.depthIntervalMs', 30000);
  }

  /**
   * Start consuming on module init
   */
  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  /**
   * Graceful shutdown - stop consuming and clean up resources
   */
  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.depthIntervalId) {
      clearInterval(this.depthIntervalId);
    }
    this.consumerCountGauge.dec({ queue: QUEUE_NAMES.QA_CHECK });
    this.loggerService.log('QA check consumer shutting down gracefully', 'QaCheckConsumer');
  }

  /**
   * Start consuming from qa-check-queue
   */
  async startConsuming(): Promise<void> {
    this.loggerService.log(`Starting QA consumer for ${QUEUE_NAMES.QA_CHECK}`, 'QaCheckConsumer');

    try {
      const channel = this.rabbitMQService.getChannel();

      // Assert queue with DLQ configuration
      await channel.assertQueue(QUEUE_NAMES.QA_CHECK, {
        durable: true,
        deadLetterExchange: 'dlx-exchange',
        deadLetterRoutingKey: `dlx-${QUEUE_NAMES.QA_CHECK}`,
      });

      // Set prefetch for controlled concurrency
      await channel.prefetch(this.concurrency);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.QA_CHECK,
        (message: amqp.ConsumeMessage | null) => {
          if (message && !this.isShuttingDown) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      // Update metrics
      this.consumerCountGauge.inc({ queue: QUEUE_NAMES.QA_CHECK });
      this.startQueueDepthMonitoring(channel);

      this.loggerService.log(
        `QA consumer started (concurrency=${this.concurrency})`,
        'QaCheckConsumer',
      );
    } catch (_error) {
      this.sentryService.captureException(_error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { queue: QUEUE_NAMES.QA_CHECK },
      });
      throw _error;
    }
  }

  /**
   * Process a QA check message
   * Called by RabbitMQConsumerBase.handleMessage()
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const message = payload as IQaQueueMessage;
    const startTime = Date.now();

    try {
      this.loggerService.log(`Processing QA check for execution ${message.executionId}`, {
        context: 'QaCheckConsumer',
        correlationId,
        ticketId: message.ticketId,
        fileCount: message.codeFiles.length,
      });

      // Orchestrate parallel QA checks
      const result = await this.qaOrchestratorService.runQaChecks(message, correlationId);

      // Update metrics
      this.processingRateCounter.inc({
        queue: QUEUE_NAMES.QA_CHECK,
        status: result.passed ? 'success' : 'failed',
      });

      this.loggerService.log(
        `QA check completed: ${result.passed ? 'PASSED' : 'FAILED'} (${Date.now() - startTime}ms)`,
        { context: 'QaCheckConsumer', correlationId, executionId: message.executionId },
      );
    } catch (_error) {
      this.sentryService.captureException(_error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, correlationId },
      });
      throw _error; // Re-throw to trigger retry logic in base class
    }
  }

  /**
   * Monitor queue depth periodically and update Prometheus gauge
   * AC#3: Exposes dsf_queue_depth{queue="qa-check"}
   */
  private startQueueDepthMonitoring(channel: amqp.Channel): void {
    const checkDepth = async () => {
      try {
        const queueInfo = await channel.checkQueue(QUEUE_NAMES.QA_CHECK);
        this.queueDepthGauge.set({ queue: QUEUE_NAMES.QA_CHECK }, queueInfo.messageCount);
      } catch (_error) {
        this.loggerService.warn(
          `Failed to check queue depth: ${(_error as Error).message}`,
          'QaCheckConsumer',
        );
      }
    };

    this.depthIntervalId = setInterval(checkDepth, this.depthCheckInterval);
    checkDepth(); // Run immediately
  }
}
