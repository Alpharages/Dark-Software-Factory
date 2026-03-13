import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { TicketStatus } from '@/prisma/client';
import { ClickUpService } from './clickup.service';
import { ConfigService } from '@nestjs/config';
import { Inject, forwardRef } from '@nestjs/common';
import { IntegrationProvider } from '@/prisma/client';
import { ProjectIntegrationService } from '../integrations/project-integration.service';
// Story 20.1: Provider-Agnostic Intake
import { mapClickUpToTaskEvent, TaskTriggerSource } from '@/ticket-intake/dto';
import { IRawTaskEvent } from '@/ticket-intake/interfaces/ticket-intake.interface';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';

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
    private readonly clickup: ClickUpService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => ProjectIntegrationService))
    private readonly integrationService: ProjectIntegrationService,
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
    } catch (_error) {
      this.logger.error(
        `Failed to start consumer: ${(_error as Error).message}`,
        (_error as Error).stack,
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
   * Story 20.1: Now uses provider-agnostic ITaskEvent for routing to intake
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

      // Get repository URL from config fallback (temporary until Story 4.9)
      const defaultRepository = this.config.get<string>(
        'github.defaultRepository',
        'https://github.com/default-org/default-repo',
      );

      // Resolve project_id: look up by github_repository_url, fall back to first active project
      let project = await this.prisma.project.findFirst({
        where: { github_repository_url: defaultRepository },
        select: { id: true },
      });

      if (!project) {
        project = await this.prisma.project.findFirst({
          where: { is_active: true },
          select: { id: true },
          orderBy: { created_at: 'asc' },
        });
      }

      if (!project) {
        this.loggerService.warn(
          'No project found for auto-creating ticket - skipping ticket creation',
          {
            taskId: message.task_id,
            defaultRepository,
          },
        );
        return;
      }

      // CS1-3: ai_trigger_status gate (FR-CS20) — place after project resolved, before ticket lookup
      const integration = await this.integrationService.findByProjectAndProvider(
        project.id,
        IntegrationProvider.CLICKUP,
      );

      if (!integration) {
        this.loggerService.warn('project has no CLICKUP integration — all tasks discarded', {
          projectId: project.id,
          taskId: message.task_id,
        });
        return;
      }

      if (!integration.ai_trigger_status) {
        this.loggerService.warn(
          'integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings',
          { projectId: project.id, taskId: message.task_id },
        );
        return;
      }

      if (message.status.toLowerCase() !== integration.ai_trigger_status.toLowerCase()) {
        this.loggerService.debug(
          `task ${message.task_id} status '${message.status}' — not at trigger '${integration.ai_trigger_status}', skipping`,
        );
        return;
      }

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

        // Fetch full task details from ClickUp API to get description
        let taskDescription = '';
        try {
          const fullTask = await this.clickup.getTask(message.task_id);
          taskDescription = fullTask.description || fullTask.text_content || '';
          this.loggerService.debug('Fetched full task details from ClickUp', {
            taskId: message.task_id,
            hasDescription: !!taskDescription,
          });
        } catch (_error) {
          this.loggerService.warn('Failed to fetch task description from ClickUp', {
            taskId: message.task_id,
            error: (_error as Error).message,
          });
        }

        // Auto-create ticket for production polling workflow
        // This ensures new ClickUp tasks are automatically synced to database
        ticket = await this.prisma.ticket.create({
          data: {
            clickup_task_id: message.task_id,
            project_id: project.id,
            title: message.name || `Task ${message.task_id}`,
            description: taskDescription, // Now includes fetched description
            acceptance_criteria: '',
            ticket_quality_score: 0, // Not validated through intake flow
            status: TicketStatus.QUEUED,
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

        // Story 20.1: Route newly created ticket using provider-agnostic ITaskEvent
        const correlationId = `webhook-${message.task_id}-${Date.now()}`;
        const triggerSource =
          message.source === 'webhook' ? TaskTriggerSource.WEBHOOK : TaskTriggerSource.SYNC;

        // Create IRawTaskEvent from ClickUp message
        const rawEvent: IRawTaskEvent = {
          taskId: message.task_id,
          taskName: message.name || `Task ${message.task_id}`,
          taskDescription: taskDescription,
          taskStatus: message.status,
          taskUrl: `https://app.clickup.com/t/${message.task_id}`,
          listId: 'clickup-polling', // Fallback - should be from project mapping
          listName: 'ClickUp Polling',
          projectId: project.id,
          projectName: 'Default Project',
          spaceId: '',
          eventType: 'taskCreated',
          tags: [],
          customFields: (message.custom_fields || {}) as Record<string, unknown>,
          creatorEmail: 'system@clickup-polling',
          eventTimestamp: message.date_updated,
          receivedAt: new Date().toISOString(),
          correlationId,
          webhookEventId: message.webhookId || '',
        };

        // Map to provider-agnostic ITaskEvent
        const taskEvent = mapClickUpToTaskEvent(rawEvent, triggerSource);

        // Publish to ticket-intake-queue
        await this.rabbitMQService.publishToQueue(QUEUE_NAMES.TICKET_INTAKE, taskEvent, {
          persistent: true,
          correlationId,
        });

        this.loggerService.log('Routed new ticket to intake queue for processing', {
          ticketId: ticket.id,
          clickUpTaskId: message.task_id,
          correlationId,
          providerType: taskEvent.providerType,
          triggerSource: taskEvent.triggerSource,
        });

        return; // Skip status update for newly created tickets
      }

      // Status synchronization disabled pending runtime status discovery (CS1-2)
      // and project-level ai_trigger_status configuration (CS1-3)

      const duration = Date.now() - startTime;
      this.metrics.recordHistogram('clickup_task_sync_duration_seconds', duration / 1000, {
        source: message.source,
      });
    } catch (_error) {
      const err = _error as Error;
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
      throw _error;
    }
  }
}
