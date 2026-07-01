import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProjectIntegration } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { PMProviderFactory } from '../providers/pm-provider.factory';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { QUEUE_NAMES } from '../../rabbitmq/rabbitmq.config';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { LoggerService } from '../../common/logger/logger.service';
import { IRawTaskEvent } from '../../ticket-intake/interfaces/ticket-intake.interface';
import { ITaskEvent, TaskTriggerSource, mapClickUpToTaskEvent } from '../../ticket-intake/dto';
import { DevelopmentGateService } from '../../ticket-intake/services/development-gate.service';

type IntegrationRow = ProjectIntegration & {
  project: { id: string; name: string };
};

@Injectable()
export class PmPollingOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly rabbitmq: RabbitMQService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly developmentGate: DevelopmentGateService,
  ) {}

  @Cron('0 * * * * *') // every minute at second 0 — matches project cron convention
  async pollDueIntegrations(): Promise<void> {
    const integrations = await this.prisma.projectIntegration.findMany({
      where: { polling_enabled: true },
      include: { project: { select: { id: true, name: true } } },
    });

    for (const raw of integrations as IntegrationRow[]) {
      if (!this.isDue(raw)) continue;

      const start = Date.now();

      try {
        // Decrypt tokens before passing to factory — never pass encrypted raw record
        const integration = await this.integrationService.getDecryptedIntegration(raw.id);
        if (!integration) continue;

        // since is from the raw query to avoid race between findMany and getDecryptedIntegration
        const since = raw.polling_last_run_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
        const provider = await this.providerFactory.getProvider(integration);
        const tasks = await provider.getUpdatedTasks(integration.workspace_id, since);

        for (const task of tasks) {
          const messageId = `polling-${integration.id}-${task.id}-${Date.now()}`;

          // CS1-6: Development gate — only tasks at trigger status enter the dev queue
          const gateDecision = await this.developmentGate.check(
            task.id,
            task.status.name,
            integration,
            'polling',
            messageId,
          );
          if (!gateDecision.allowed) {
            continue; // silently skip this task
          }

          // Build IRawTaskEvent intermediary — NOT published directly
          const rawEvent: IRawTaskEvent = {
            correlationId: messageId,
            webhookEventId: '',
            eventType: 'taskUpdated',
            taskId: task.id,
            taskName: task.name,
            taskDescription: task.description ?? null,
            taskStatus: task.status.name,
            listId: task.listId, // ClickUp list ID → used as projectIdentifier for DSF project lookup
            listName: '',
            spaceId: '',
            projectId: raw.project.id,
            projectName: raw.project.name,
            taskUrl: task.url,
            tags: task.tags ?? [],
            customFields: task.customFields ?? {},
            creatorEmail: '',
            eventTimestamp: task.dateUpdated ?? new Date().toISOString(),
            receivedAt: new Date().toISOString(),
          };

          // Publish ITaskEvent (not IRawTaskEvent) — avoids deprecated legacy path
          const taskEvent: ITaskEvent = mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.POLLING);

          await this.rabbitmq.publishToQueue(
            QUEUE_NAMES.TICKET_INTAKE,
            { messageId, correlationId: messageId, payload: taskEvent },
            { persistent: true, correlationId: messageId, headers: { 'x-source': 'polling' } },
          );

          this.metrics.incrementCounter('pm_polling_tasks_discovered_total', {
            provider: integration.provider,
            integration_id: integration.id,
          });
        }

        // Use service — no direct Prisma calls (CS0-1: service encrypts on write)
        await this.integrationService.updateIntegration(integration.id, {
          polling_last_run_at: new Date(),
        });

        this.metrics.incrementCounter('pm_polling_runs_total', {
          provider: integration.provider,
          status: 'success',
        });

        this.metrics.recordHistogram('pm_polling_duration_seconds', (Date.now() - start) / 1000, {
          provider: integration.provider,
        });

        this.logger.log(
          `Polled ${integration.provider}/${integration.workspace_id}: ${tasks.length} tasks`,
          { integrationId: integration.id },
        );
      } catch (error: unknown) {
        this.logger.error(
          'Polling failed for integration',
          error instanceof Error ? error.stack : String(error),
          { integrationId: raw.id, provider: raw.provider, workspaceId: raw.workspace_id },
        );

        this.sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { operation: 'pm_polling' },
          extra: { integrationId: raw.id, provider: raw.provider },
        });

        this.metrics.incrementCounter('pm_polling_errors_total', { provider: raw.provider });
        this.metrics.incrementCounter('pm_polling_runs_total', {
          provider: raw.provider,
          status: 'error',
        });
        // NOTE: polling_last_run_at is NOT updated on error — integration retries next cron tick
      }
    }
  }

  private isDue(integration: IntegrationRow): boolean {
    if (!integration.polling_last_run_at) return true;
    const intervalMs = integration.polling_interval_min * 60_000;
    return Date.now() >= integration.polling_last_run_at.getTime() + intervalMs;
  }
}
