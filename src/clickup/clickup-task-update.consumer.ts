/**
 * ClickUp Task Update Consumer
 *
 * Processes task updates from RabbitMQ queue (unified webhook + polling)
 * Updates local database and triggers downstream workflows
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { TicketStatus } from '@prisma/client';

interface ClickUpTaskUpdateMessage {
  task_id: string;
  name: string;
  status: string;
  date_updated: string;
  assignees?: Array<{ id: number; username: string }>;
  custom_fields?: Array<{ id: string; name: string; value: unknown }>;
  source: 'webhook' | 'polling';
  webhookId?: string;
  polledAt?: string;
}

const CLICKUP_TASK_UPDATED_QUEUE = 'clickup-task-updated-queue';

@Injectable()
export class ClickUpTaskUpdateConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(ClickUpTaskUpdateConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  /**
   * Start consuming on module init
   */
  async onModuleInit(): Promise<void> {
    // Small delay to ensure RabbitMQ connection is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startConsuming();
  }

  /**
   * Start consuming from clickup-task-updated-queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${CLICKUP_TASK_UPDATED_QUEUE}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(CLICKUP_TASK_UPDATED_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': `dlx-${CLICKUP_TASK_UPDATED_QUEUE}`,
        },
      });

      // Set prefetch for controlled concurrency
      await channel.prefetch(5);

      // Start consuming
      await channel.consume(
        CLICKUP_TASK_UPDATED_QUEUE,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`✅ Consumer started for ${CLICKUP_TASK_UPDATED_QUEUE} (prefetch: 5)`);
    } catch (error) {
      this.logger.error(
        `Failed to start consumer: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Process a message from the queue (called by RabbitMQConsumerBase)
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const message = payload as ClickUpTaskUpdateMessage;

    this.loggerService.log('Processing ClickUp task update from queue', {
      taskId: message.task_id,
      source: message.source,
      status: message.status,
      correlationId,
    });

    // Delegate to existing business logic
    await this.handleTaskUpdate(message);
  }

  /**
   * Process task updates (called externally or via message broker)
   * Handles both webhook and polling sources
   *
   * Production behavior: Auto-creates tickets if they don't exist
   * This ensures polling discovers new tasks without manual intervention
   */
  async handleTaskUpdate(message: ClickUpTaskUpdateMessage): Promise<void> {
    const startTime = Date.now();

    try {
      this.loggerService.log('Processing ClickUp task update', {
        taskId: message.task_id,
        source: message.source,
        status: message.status,
      });

      // Find ticket by ClickUp task ID
      let ticket = await this.prisma.ticket.findUnique({
        where: { clickup_task_id: message.task_id },
        include: { executions: true },
      });

      if (!ticket) {
        this.loggerService.log('Ticket not found - creating new ticket from ClickUp task', {
          taskId: message.task_id,
          source: message.source,
        });

        // Auto-create ticket for production polling workflow
        // This ensures new ClickUp tasks are automatically synced to database
        ticket = await this.prisma.ticket.create({
          data: {
            clickup_task_id: message.task_id,
            project_id: 'clickup-polling', // Default project ID
            title: message.name || `Task ${message.task_id}`,
            description: '', // Will be enriched later if needed
            acceptance_criteria: '',
            ticket_quality_score: 0, // Not validated through intake flow
            status:
              (this.mapClickUpStatusToTicketStatus(message.status) as TicketStatus) ||
              TicketStatus.QUEUED,
          },
          include: { executions: true },
        });

        this.loggerService.log('Created new ticket from ClickUp polling', {
          ticketId: ticket.id,
          clickUpTaskId: message.task_id,
          status: ticket.status,
        });

        // Audit log for creation
        await this.audit.log({
          entityType: 'ticket',
          entityId: ticket.id,
          action: 'created_from_clickup_sync',
          actorType: 'system',
          afterState: {
            clickUpTaskId: message.task_id,
            source: message.source,
            status: ticket.status,
          },
        });

        this.metrics.incrementCounter('clickup_task_sync_total', {
          source: message.source,
          status: 'created',
        });

        // Route newly created ticket to intake queue for validation and AI processing
        const intakeMessageId = `intake-${ticket.id}-${Date.now()}`;
        await this.rabbitMQService.publishToQueue(
          'ticket-intake-queue',
          {
            messageId: intakeMessageId,
            correlationId: intakeMessageId,
            payload: {
              taskId: message.task_id,
              taskName: message.name || `Task ${message.task_id}`,
              taskDescription: '',
              taskUrl: `https://app.clickup.com/t/${message.task_id}`,
              listId: 'clickup-polling',
              projectId: 'clickup-polling',
              eventType: 'taskCreated',
              tags: [],
              creatorEmail: 'system@clickup-polling',
            },
          },
          {
            persistent: true,
            correlationId: intakeMessageId,
          },
        );

        this.loggerService.log('Routed new ticket to intake queue for processing', {
          ticketId: ticket.id,
          clickUpTaskId: message.task_id,
          messageId: intakeMessageId,
        });

        return; // Skip status update for newly created tickets
      }

      // Update ticket status based on ClickUp status
      const newStatus = this.mapClickUpStatusToTicketStatus(message.status);

      if (newStatus && ticket.status !== newStatus) {
        const previousStatus = ticket.status;

        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: newStatus as TicketStatus },
        });

        this.loggerService.log('Updated ticket status from ClickUp', {
          ticketId: ticket.id,
          previousStatus,
          newStatus,
          clickUpTaskId: message.task_id,
        });

        // Audit log
        await this.audit.log({
          entityType: 'ticket',
          entityId: ticket.id,
          action: 'status_synced_from_clickup',
          actorType: 'system',
          beforeState: { status: previousStatus },
          afterState: {
            status: newStatus,
            clickUpStatus: message.status,
            source: message.source,
          },
        });

        // Record metric
        this.metrics.incrementCounter('clickup_task_sync_total', {
          source: message.source,
          status: 'success',
        });
      }

      const duration = Date.now() - startTime;
      this.metrics.recordHistogram('clickup_task_sync_duration_seconds', duration / 1000, {
        source: message.source,
      });
    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - startTime;

      this.loggerService.error('Failed to process ClickUp task update', err.stack || err.message, {
        taskId: message.task_id,
        source: message.source,
        duration,
      });

      this.sentry.captureException(err, {
        tags: { operation: 'clickup_task_sync' },
        extra: {
          taskId: message.task_id,
          source: message.source,
        },
      });

      this.metrics.incrementCounter('clickup_task_sync_total', {
        source: message.source,
        status: 'error',
      });

      // Re-throw to trigger RabbitMQ retry
      throw error;
    }
  }

  /**
   * Map ClickUp status names to internal ticket status
   * Customize based on your ClickUp workflow
   */
  private mapClickUpStatusToTicketStatus(clickUpStatus: string): string | null {
    const statusMap: Record<string, string> = {
      'to do': 'QUEUED',
      'in progress': 'AI_PROCESSING',
      review: 'QA_REVIEW',
      deployed: 'DEPLOYED',
      done: 'COMPLETED',
      closed: 'COMPLETED',
    };

    const normalized = clickUpStatus.toLowerCase();
    return statusMap[normalized] || null;
  }
}
