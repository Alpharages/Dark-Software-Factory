import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RabbitMQConsumerBase } from '../../rabbitmq/rabbitmq-consumer.base';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { PrismaService } from '../../database/prisma.service';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { QUEUE_NAMES, EXCHANGE_NAMES, ROUTING_KEYS } from '../../rabbitmq/rabbitmq.config';
import * as amqp from 'amqplib';

interface GitHubWebhookMessage {
  event: string;
  payload: {
    action: string;
    pull_request: {
      number: number;
    };
    repository: {
      full_name: string;
    };
  };
  correlationId: string;
}

/**
 * Consumer for GitHub Webhook events
 *
 * Listens to: github.webhook.received routing key on orchestrator-events exchange
 * Published by: GitHubWebhooksController
 *
 * Handles 'synchronize' (code update) and 'reopened' events to trigger risk re-assessment.
 */
@Injectable()
export class GitHubWebhookConsumer
  extends RabbitMQConsumerBase
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger = new Logger(GitHubWebhookConsumer.name);
  protected readonly queueName = QUEUE_NAMES.GITHUB_WEBHOOK;
  protected readonly prefetchCount = 2; // Allow some parallel processing for risks

  private channel: amqp.Channel | null = null;
  private consumerTag: string | null = null;

  constructor(
    protected readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly riskAssessor: PRRiskAssessorService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      const channel = this.rabbitMQ.getChannel();
      this.channel = channel;

      await channel.prefetch(this.prefetchCount);
      await channel.assertQueue(this.queueName, { durable: true });

      await channel.bindQueue(
        this.queueName,
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        ROUTING_KEYS.GITHUB_WEBHOOK_RECEIVED,
      );

      const result = await channel.consume(
        this.queueName,
        async (msg: amqp.ConsumeMessage | null) => {
          if (msg) {
            await this.handleMessage(msg, channel);
          }
        },
        { noAck: false },
      );

      this.consumerTag = result.consumerTag;
      this.logger.log(`GitHub webhook consumer started - listening on ${this.queueName}`);
    } catch (error) {
      this.logger.error('Failed to initialize GitHub webhook consumer', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      await this.channel.close();
      this.logger.log('GitHub webhook consumer stopped');
    }
  }

  /**
   * Process GitHub webhook message
   */
  protected async processMessage(
    payload: GitHubWebhookMessage,
    correlationId: string,
  ): Promise<void> {
    const { action } = payload.payload;
    const repoFullName = payload.payload.repository.full_name;
    const prNumber = payload.payload.pull_request.number;

    this.logger.log(`[${correlationId}] Processing GitHub PR webhook: ${action}`, {
      repo: repoFullName,
      pr: prNumber,
    });

    // Only assess for synchronize (new commits) and reopened
    if (action !== 'synchronize' && action !== 'reopened') {
      this.logger.debug(`[${correlationId}] Skipping risk assessment for action: ${action}`);
      return;
    }

    try {
      // Find the most recent execution for this PR to get context
      const push = await this.prisma.gitHubPush.findFirst({
        where: {
          repository: repoFullName,
          pr_number: prNumber,
        },
        orderBy: { created_at: 'desc' },
        select: { execution_id: true },
      });

      if (!push?.execution_id) {
        this.logger.warn(
          `[${correlationId}] No execution found for PR ${repoFullName}#${prNumber}, cannot assess risk`,
        );
        return;
      }

      await this.riskAssessor.assess(push.execution_id, repoFullName, prNumber, correlationId);

      this.logger.log(
        `[${correlationId}] Completed risk re-assessment for ${repoFullName}#${prNumber}`,
      );
    } catch (error) {
      this.logger.error(`[${correlationId}] Failed to process PR risk re-assessment`, {
        error: (error as Error).message,
        repo: repoFullName,
        pr: prNumber,
      });
      // Rethrow for RabbitMQ retry
      throw error;
    }
  }
}
