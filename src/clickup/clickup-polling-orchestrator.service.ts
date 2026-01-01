/**
 * ClickUp Polling Orchestrator Service
 *
 * Polls ClickUp API for task changes when webhooks are not available
 * Similar pattern to DeploymentOrchestrator for GitHub Actions polling
 *
 * Features:
 * - Polls specific lists/spaces for task updates
 * - Exponential backoff (60s → 120s → 180s, max 300s)
 * - Rate limit handling and detection
 * - Incremental polling using date_updated filters
 * - Memory-efficient polling state management
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ClickUpService } from './clickup.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';

interface PollingState {
  spaceId: string;
  listId?: string;
  lastPollTimestamp: number;
  attempts: number;
  nextInterval: number;
  timeoutHandle: NodeJS.Timeout;
  isActive: boolean;
}

interface ClickUpTaskUpdate {
  id: string;
  name: string;
  status: {
    status: string;
    color: string;
  };
  date_updated: string;
  assignees?: Array<{ id: number; username: string }>;
  custom_fields?: Array<{ id: string; name: string; value: unknown }>;
}

@Injectable()
export class ClickUpPollingOrchestrator implements OnModuleInit, OnModuleDestroy {
  // Removed MONITORED_LISTS property as we fetch from DB now
  private readonly POLL_INTERVAL_MS: number;
  private readonly MAX_POLL_INTERVAL_MS: number;
  private readonly ENABLED: boolean;
  private pollingStates = new Map<string, PollingState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickup: ClickUpService,
    private readonly rabbitmq: RabbitMQService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {
    // Only enable polling if webhooks are not enabled
    // ConfigService returns string, so we need to check for 'true' string
    const useWebhooks = this.config.get<string>('CLICKUP_USE_WEBHOOKS', 'false');
    this.ENABLED = useWebhooks !== 'true';

    this.POLL_INTERVAL_MS = this.config.get<number>('CLICKUP_POLL_INTERVAL_MS', 60000); // 60s default
    this.MAX_POLL_INTERVAL_MS = this.config.get<number>('CLICKUP_MAX_POLL_INTERVAL_MS', 300000); // 5min max

    this.logger.log('ClickUp Polling Orchestrator initialized', {
      enabled: this.ENABLED,
      useWebhooks,
      pollInterval: this.POLL_INTERVAL_MS,
    });
  }

  async onModuleInit() {
    if (!this.ENABLED) {
      this.logger.log('ClickUp polling disabled (webhooks enabled)', 'ClickUpPollingOrchestrator');
      return;
    }

    // NEW: Fetch monitored projects from DB instead of env var
    // Supports multi-provider extensibility (filtering by provider: CLICKUP)
    try {
      const monitoredProjects = await this.prisma.project.findMany({
        where: {
          provider: 'CLICKUP',
          monitor_tasks: true,
          status: 'active', // Only poll active projects
        },
        select: {
          clickup_list_id: true,
        },
      });

      this.logger.log(`Found ${monitoredProjects.length} monitored ClickUp projects in DB`, {
        ids: monitoredProjects.map((p) => p.clickup_list_id),
      });

      // Start polling for monitored lists
      for (const project of monitoredProjects) {
        if (project.clickup_list_id) {
          await this.startPolling(project.clickup_list_id);
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to fetch monitored projects from DB',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  onModuleDestroy() {
    // Clean up all active polling intervals
    this.pollingStates.forEach((state) => {
      if (state.timeoutHandle) {
        clearTimeout(state.timeoutHandle);
      }
    });
    this.pollingStates.clear();
    this.logger.log('Cleaned up all ClickUp polling states', 'ClickUpPollingOrchestrator');
  }

  /**
   * REFRESH POLLING: Called when project settings change
   * Public method to allow ProjectsController to trigger an update
   */
  async refreshMonitoredLists(): Promise<void> {
    if (!this.ENABLED) return;

    this.logger.log('Refreshing monitored lists from DB...');
    try {
      const monitoredProjects = await this.prisma.project.findMany({
        where: {
          provider: 'CLICKUP',
          monitor_tasks: true,
          status: 'active',
        },
        select: {
          clickup_list_id: true,
        },
      });

      const monitoredListIds = new Set(monitoredProjects.map((p) => p.clickup_list_id));

      // 1. Start polling for new lists
      for (const id of monitoredListIds) {
        if (id && !this.isPolling(id)) {
          await this.startPolling(id);
        }
      }

      // 2. Stop polling for lists that are no longer monitored
      this.pollingStates.forEach((state, key) => {
        // key format is usually listId or spaceId:listId
        // simplistic check: if key contains listId not in monitored, stop
        // better: store listId clearly in state
        if (state.listId && !monitoredListIds.has(state.listId)) {
          this.stopPolling(state.listId, state.spaceId);
        }
      });
    } catch (error) {
      this.logger.error('Failed to refresh monitored lists', String(error));
    }
  }

  private isPolling(listId: string): boolean {
    // Iterate to find if any key contains this listId (simplistic)
    // Keys are spaceId:listId or just listId
    // Better: check state.listId
    for (const state of this.pollingStates.values()) {
      if (state.listId === listId && state.isActive) return true;
    }
    return false;
  }

  /**
   * Start polling a specific list for task updates
   */
  async startPolling(listId: string, spaceId?: string): Promise<void> {
    if (!this.ENABLED) {
      this.logger.warn('Cannot start polling - webhooks are enabled', { listId });
      return;
    }

    const pollingKey = spaceId ? `${spaceId}:${listId}` : listId;

    if (this.pollingStates.has(pollingKey)) {
      this.logger.debug('Polling already active for list', { listId, spaceId });
      return;
    }

    this.logger.log('Starting ClickUp polling', {
      listId,
      spaceId,
      interval: this.POLL_INTERVAL_MS,
    });

    const initialInterval = this.POLL_INTERVAL_MS;
    // Start from 24 hours ago to capture recent tasks on first poll
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    const poll = async (attempts: number, interval: number, lastPollTime: number) => {
      const state = this.pollingStates.get(pollingKey);
      if (!state?.isActive) {
        this.logger.debug('Polling stopped for list', { listId });
        return;
      }

      try {
        const pollStart = Date.now();

        // Poll for task updates since last poll
        const tasks = await this.pollTaskUpdates(listId, lastPollTime, spaceId);

        const pollDuration = (Date.now() - pollStart) / 1000;

        // Record polling metrics
        this.metrics.recordHistogram('clickup_poll_duration_seconds', pollDuration, {
          list_id: listId,
          space_id: spaceId || 'unknown',
        });

        this.metrics.incrementCounter('clickup_poll_total', {
          list_id: listId,
          status: 'success',
        });

        // Process discovered task updates
        if (tasks.length > 0) {
          this.logger.log(`Discovered ${tasks.length} task updates`, { listId, spaceId });
          await this.processTaskUpdates(tasks);

          // Increment counter for each task discovered
          for (let i = 0; i < tasks.length; i++) {
            this.metrics.incrementCounter('clickup_tasks_discovered_total', {
              list_id: listId,
            });
          }
        }

        // Update polling state for next iteration
        const newLastPollTime = Date.now();
        const nextInterval = this.calculateBackoff(interval, attempts, tasks.length);
        const timeoutHandle = setTimeout(
          () => poll(0, nextInterval, newLastPollTime),
          nextInterval,
        );

        this.pollingStates.set(pollingKey, {
          spaceId: spaceId || '',
          listId,
          lastPollTimestamp: newLastPollTime,
          attempts: 0, // Reset on success
          nextInterval,
          timeoutHandle,
          isActive: true,
        });
      } catch (error) {
        const err = error as Error;
        this.logger.error('ClickUp polling error', err.stack || err.message, {
          listId,
          spaceId,
          attempts,
        });

        this.metrics.incrementCounter('clickup_poll_total', {
          list_id: listId,
          status: 'error',
        });

        this.sentry.captureException(err, {
          tags: { operation: 'clickup_polling' },
          extra: { listId, spaceId, attempts },
        });

        // Check if error is rate limit (429)
        if (err.message.includes('rate limit')) {
          this.logger.warn('ClickUp rate limit hit, backing off', { listId, spaceId });
          // Use max backoff for rate limits
          const nextInterval = this.MAX_POLL_INTERVAL_MS;
          const timeoutHandle = setTimeout(
            () => poll(attempts + 1, nextInterval, lastPollTime),
            nextInterval,
          );

          this.pollingStates.set(pollingKey, {
            spaceId: spaceId || '',
            listId,
            lastPollTimestamp: lastPollTime,
            attempts: attempts + 1,
            nextInterval,
            timeoutHandle,
            isActive: true,
          });
          return;
        }

        // Retry with exponential backoff for transient errors
        if (attempts < 3) {
          const nextInterval = this.calculateBackoff(interval, attempts + 1, 0);
          const timeoutHandle = setTimeout(
            () => poll(attempts + 1, nextInterval, lastPollTime),
            nextInterval,
          );

          this.pollingStates.set(pollingKey, {
            spaceId: spaceId || '',
            listId,
            lastPollTimestamp: lastPollTime,
            attempts: attempts + 1,
            nextInterval,
            timeoutHandle,
            isActive: true,
          });
        } else {
          this.logger.error('Polling failed after max retries, stopping', '', { listId, spaceId });
          this.pollingStates.delete(pollingKey);
        }
      }
    };

    // Start initial poll - begin from 24 hours ago to catch existing tasks
    const timeoutHandle = setTimeout(
      () => poll(0, initialInterval, twentyFourHoursAgo),
      initialInterval,
    );

    this.pollingStates.set(pollingKey, {
      spaceId: spaceId || '',
      listId,
      lastPollTimestamp: twentyFourHoursAgo,
      attempts: 0,
      nextInterval: initialInterval,
      timeoutHandle,
      isActive: true,
    });
  }

  /**
   * Stop polling a specific list
   */
  stopPolling(listId: string, spaceId?: string): void {
    const pollingKey = spaceId ? `${spaceId}:${listId}` : listId;
    const state = this.pollingStates.get(pollingKey);

    if (state) {
      state.isActive = false;
      if (state.timeoutHandle) {
        clearTimeout(state.timeoutHandle);
      }
      this.pollingStates.delete(pollingKey);
      this.logger.log('Stopped ClickUp polling', { listId, spaceId });
    }
  }

  /**
   * Poll ClickUp API for task updates since last poll
   */
  private async pollTaskUpdates(
    listId: string,
    lastPollTimestamp: number,
    spaceId?: string,
  ): Promise<ClickUpTaskUpdate[]> {
    try {
      // Fetch tasks updated since last poll using ClickUpService
      const response = await this.clickup.getTasks({
        list_id: listId,
        space_id: spaceId,
        date_updated_gt: lastPollTimestamp,
        order_by: 'updated',
      });

      const tasks: ClickUpTaskUpdate[] = response.tasks;

      this.logger.debug('Polled ClickUp tasks', {
        listId,
        spaceId,
        lastPoll: new Date(lastPollTimestamp),
        tasksFound: tasks.length,
      });

      return tasks;
    } catch (error) {
      const err = error as Error;

      // Check for rate limit error
      if (err.message.includes('rate limit') || err.message.includes('429')) {
        throw new Error('ClickUp rate limit exceeded');
      }

      throw error;
    }
  }

  /**
   * Process discovered task updates by publishing to RabbitMQ
   */
  private async processTaskUpdates(tasks: ClickUpTaskUpdate[]): Promise<void> {
    for (const task of tasks) {
      try {
        const messageId = `polling-${task.id}-${Date.now()}`;

        // Publish to clickup-task-updated-queue for processing
        // Wrap message with messageId, correlationId, payload per RabbitMQConsumerBase contract
        await this.rabbitmq.publishToQueue(
          'clickup-task-updated-queue',
          {
            messageId,
            correlationId: messageId,
            payload: {
              task_id: task.id,
              name: task.name,
              status: task.status.status,
              date_updated: task.date_updated,
              assignees: task.assignees,
              custom_fields: task.custom_fields,
              source: 'polling',
              polledAt: new Date().toISOString(),
            },
          },
          {
            persistent: true,
            correlationId: messageId,
            headers: {
              'x-source': 'polling',
              'x-task-id': task.id,
            },
          },
        );

        this.logger.debug('Published task update to queue', { taskId: task.id, messageId });
      } catch (error) {
        const err = error as Error;
        this.logger.error('Failed to publish task update', err.message, { taskId: task.id });
        this.sentry.captureException(err, {
          tags: { operation: 'publish_task_update' },
          extra: { taskId: task.id },
        });
      }
    }
  }

  /**
   * Calculate next polling interval with exponential backoff
   * Adapts based on activity: faster when changes detected, slower when idle
   */
  private calculateBackoff(currentInterval: number, attempts: number, tasksFound: number): number {
    // If tasks were found, poll more frequently
    if (tasksFound > 0) {
      return Math.max(this.POLL_INTERVAL_MS, currentInterval / 2); // Speed up
    }

    // If errors occurred, back off exponentially
    if (attempts > 0) {
      const backoff = currentInterval * Math.pow(2, attempts);
      return Math.min(backoff, this.MAX_POLL_INTERVAL_MS);
    }

    // Normal progression: gradually slow down if no activity
    const nextInterval = Math.min(currentInterval * 1.5, this.MAX_POLL_INTERVAL_MS);
    return Math.floor(nextInterval);
  }

  /**
   * Get current polling status for monitoring
   */
  getPollingStatus(): Array<{
    listId: string;
    spaceId: string;
    isActive: boolean;
    nextPollIn: number;
  }> {
    const status: Array<{
      listId: string;
      spaceId: string;
      isActive: boolean;
      nextPollIn: number;
    }> = [];

    this.pollingStates.forEach((state, key) => {
      status.push({
        listId: state.listId || key,
        spaceId: state.spaceId,
        isActive: state.isActive,
        nextPollIn: state.nextInterval,
      });
    });

    return status;
  }
}
