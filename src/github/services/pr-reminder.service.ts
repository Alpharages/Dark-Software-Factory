import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../github.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { PrismaService } from '@/database/prisma.service';

export interface PRReminderPayload {
  executionId: string;
  repository: string;
  prNumber: number;
  attempt: number; // 1 (2h), 2 (4h), 3 (24h)
}

@Injectable()
export class PRReminderService {
  private readonly logger = new Logger(PRReminderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly github: GitHubService,
    private readonly publisher: RabbitMQPublisherService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Schedules the first reminder (2h mark)
   */
  async scheduleInitialReminder(
    executionId: string,
    repository: string,
    prNumber: number,
    _correlationId?: string,
  ): Promise<void> {
    if (!this.config.get<boolean>('github.remindersEnabled')) {
      return;
    }

    const { owner, repo } = this.parseRepository(repository);

    try {
      // Check if PR is still open before scheduling
      const pr = await this.github.getPullRequest(owner, repo, prNumber, executionId);
      if (pr.state !== 'open' || pr.merged === true) {
        this.logger.debug(
          `PR ${repository}#${prNumber} is already ${pr.merged ? 'merged' : pr.state}, not scheduling reminders.`,
        );
        return;
      }

      // 2 hours in ms
      const delay = 2 * 60 * 60 * 1000;

      await this.publishToWaitQueue(
        {
          executionId,
          repository,
          prNumber,
          attempt: 1,
        },
        executionId,
        delay,
      );

      this.logger.log(`Scheduled first PR reminder for ${repository}#${prNumber} (2h delay)`);
    } catch (error) {
      this.logger.error(`Failed to schedule initial reminder for ${repository}#${prNumber}`, {
        error: (error as Error).message,
        executionId,
      });
    }
  }

  /**
   * Processes a reminder and schedules the next one if necessary
   */
  async processReminder(payload: PRReminderPayload): Promise<void> {
    const { executionId, repository, prNumber, attempt } = payload;
    const { owner, repo } = this.parseRepository(repository);

    try {
      // 1. Check if PR is still open and needs a reminder
      const pr = await this.github.getPullRequest(owner, repo, prNumber, executionId);

      if (pr.state !== 'open' || pr.merged === true) {
        this.logger.log(
          `PR ${repository}#${prNumber} is ${pr.merged ? 'merged' : pr.state}, stopping reminders.`,
        );
        return;
      }

      // 2. Send reminder (e.g., add comment to PR)
      const reminderMessages: Record<string, string> = {
        '1': 'Friendly reminder: This PR has been open for 2 hours and is pending review. 🕒',
        '2': 'Friendly reminder: This PR has been open for 4 hours. Quick review would be appreciated! ⚡',
        '3': 'This PR has been open for 24 hours. Please review when possible. 📅',
      };

      const message = reminderMessages[attempt.toString()] || reminderMessages['1'];

      await this.github.addPRComment(owner, repo, prNumber, message, executionId);

      // 3. Log decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'PRReminder',
        action: 'pr_reminder_sent',
        reasoning: `PR # ${prNumber} in ${repository} is still open after ${this.getDelayLabel(attempt)}.`,
        ticketId: pr.head?.ref || '', // Best effort ticket ID
        executionId,
        inputData: { repository, prNumber, attempt },
        outputData: { message },
        confidence: 1.0,
      });

      // 4. Update metrics
      this.metrics.incrementCounter('github_pr_reminders_sent_total', {
        repository,
        attempt: attempt.toString(),
      });

      // 5. Schedule next reminder
      let nextDelay = 0;
      let nextAttempt = 0;

      if (attempt === 1) {
        nextDelay = 2 * 60 * 60 * 1000; // +2h = 4h total
        nextAttempt = 2;
      } else if (attempt === 2) {
        nextDelay = 20 * 60 * 60 * 1000; // +20h = 24h total
        nextAttempt = 3;
      }

      if (nextDelay > 0) {
        await this.publishToWaitQueue(
          {
            executionId,
            repository,
            prNumber,
            attempt: nextAttempt,
          },
          executionId,
          nextDelay,
        );
        this.logger.debug(
          `Scheduled next PR reminder for ${repository}#${prNumber} (attempt ${nextAttempt})`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to process PR reminder for ${repository}#${prNumber}`, {
        error: (error as Error).message,
        executionId,
      });
    }
  }

  private parseRepository(repository: string): { owner: string; repo: string } {
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repository}`);
    }
    return { owner, repo };
  }

  private getDelayLabel(attempt: number): string {
    const labels: Record<string, string> = { '1': '2h', '2': '4h', '3': '24h' };
    return labels[attempt.toString()] || 'unknown';
  }

  private async publishToWaitQueue(
    payload: PRReminderPayload,
    correlationId: string,
    ttl: number,
  ): Promise<void> {
    // We use the WAIT queue pattern with message-level TTL (expiration)
    // This requires the message to be published to a queue with no consumers
    // which has a x-dead-letter-exchange pointing back to the main queue.
    await this.publisher.publishToQueue(
      QUEUE_NAMES.GITHUB_PR_REMINDER_WAIT,
      payload,
      correlationId,
      undefined, // Don't use the 'delay' param (x-delay plugin)
      ttl, // Use the expiration parameter
    );

    // Note: The above call needs to be supplemented with the actual expiration header.
    // However, our RabbitMQPublisherService.publishToQueue doesn't currently support passing custom expiration.
    // I will need to update RabbitMQPublisherService as well or use raw channel.
  }
}
