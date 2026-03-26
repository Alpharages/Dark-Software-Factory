import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RabbitMQConsumerBase } from '../../rabbitmq/rabbitmq-consumer.base';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { PrismaService } from '../../database/prisma.service';
import { GitHubCommitOrchestrator } from './github-commit-orchestrator.service';
import { GitHubPROrchestrator } from './github-pr-orchestrator.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '../../rabbitmq/rabbitmq.config';
import * as amqp from 'amqplib';
import { ExecutionTrackerService } from '../../execution/execution-tracker.service';

interface GitHubPushTriggerMessage {
  executionId: string;
  ticketId: string;
  correlationId?: string;
  timestamp: number;
}

/**
 * Consumer for GitHub Push Trigger events from QA completion
 *
 * Listens to: github.push.trigger routing key on orchestrator-events exchange
 * Published by: QaOrchestratorService after QA passes
 *
 * Workflow:
 * 1. Receive QA completion event
 * 2. Create GitHubPush database record
 * 3. Call GitHubCommitOrchestrator to commit and push code
 * 4. If commit succeeds, call GitHubPROrchestrator to create PR
 * 5. PR orchestrator will then trigger deployment via its own event
 */
@Injectable()
export class GitHubPushTriggerConsumer
  extends RabbitMQConsumerBase
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger = new Logger(GitHubPushTriggerConsumer.name);
  protected readonly queueName = 'github-push-trigger-queue';
  protected readonly prefetchCount = 1; // Process one push at a time

  private channel: amqp.Channel | null = null;
  private consumerTag: string | null = null;

  constructor(
    protected readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly commitOrchestrator: GitHubCommitOrchestrator,
    private readonly prOrchestrator: GitHubPROrchestrator,
    private readonly executionTracker: ExecutionTrackerService,
  ) {
    super();
  }

  /**
   * Initialize consumer on module startup
   */
  async onModuleInit(): Promise<void> {
    try {
      const channel = this.rabbitMQ.getChannel();
      this.channel = channel;

      // Set prefetch for concurrency control
      await channel.prefetch(this.prefetchCount);

      // Ensure queue exists
      await channel.assertQueue(this.queueName, {
        durable: true,
      });

      // Bind queue to orchestrator-events exchange with github.push.trigger routing key
      await channel.bindQueue(
        this.queueName,
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        ROUTING_KEYS.GITHUB_PUSH_TRIGGER,
      );

      // Start consuming
      const result = await channel.consume(
        this.queueName,
        async (msg: amqp.ConsumeMessage | null) => {
          if (msg) {
            await this.handleMessage(msg, channel);
          }
        },
        { noAck: false }, // Manual acknowledgment
      );

      this.consumerTag = result.consumerTag;
      this.logger.log(`GitHub push trigger consumer started - listening on ${this.queueName}`);
    } catch (_error) {
      this.logger.error('Failed to initialize GitHub push trigger consumer', _error);
      throw _error;
    }
  }

  /**
   * Cleanup on module shutdown
   */
  async onModuleDestroy(): Promise<void> {
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      await this.channel.close();
      this.logger.log('GitHub push trigger consumer stopped');
    }
  }

  /**
   * Process GitHub push trigger message
   * Orchestrates commit → push → PR creation workflow
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async processMessage(payload: any, correlationId: string): Promise<void> {
    const message = payload as GitHubPushTriggerMessage;
    this.logger.log(`[${correlationId}] Processing GitHub push trigger`, {
      executionId: message.executionId,
      ticketId: message.ticketId,
    });

    try {
      // Step 0: Create GitHubPush record (required by GitHubCommitOrchestrator)
      const execution = await this.prisma.execution.findUnique({
        where: { id: message.executionId },
        include: {
          ticket: {
            include: { project: true },
          },
        },
      });

      if (!execution || !execution.ticket) {
        this.logger.error(`[${correlationId}] Execution or ticket not found`, {
          executionId: message.executionId,
        });
        return;
      }

      // Get the actual repository URL from the Project (not project_id which is a UUID)
      const repositoryUrl = execution.ticket.project?.github_repository_url || '';
      if (!repositoryUrl) {
        this.logger.error(`[${correlationId}] No github_repository_url found for project`, {
          executionId: message.executionId,
          projectId: execution.ticket.project_id,
        });
        return;
      }

      // Get the actual branch name from the workspace record (created during workspace setup)
      // The workspace creates the branch as `feature/ticket-{ticketId}` — we must use
      // the SAME branch name here, or the push will fail with "src refspec does not match any"
      const workspace = await this.prisma.workspace.findUnique({
        where: { execution_id: message.executionId },
      });
      const branchName = workspace?.branch_name || `feature/ticket-${message.ticketId}`;

      this.logger.log(`[${correlationId}] Resolved push parameters`, {
        executionId: message.executionId,
        repositoryUrl,
        branchName,
        branchSource: workspace?.branch_name ? 'workspace_record' : 'fallback',
      });

      const githubPush = await this.prisma.gitHubPush.create({
        data: {
          execution_id: message.executionId,
          repository: repositoryUrl,
          branch_name: branchName,
          push_status: 'PENDING',
        },
      });

      this.logger.log(`[${correlationId}] Created GitHub push record`, {
        githubPushId: githubPush.id,
        repository: githubPush.repository,
        branchName: githubPush.branch_name,
      });

      // Step 1: Commit and push code changes
      this.logger.log(`[${correlationId}] Starting git commit and push`, {
        executionId: message.executionId,
      });
      await this.executionTracker.emitProgress(
        message.executionId,
        message.ticketId,
        null,
        'Pushing to GitHub',
        92,
      );

      const commitResult = await this.commitOrchestrator.commitAndPush(
        message.executionId,
        correlationId,
      );

      if (!commitResult.success) {
        this.logger.error(
          `[${correlationId}] Git commit failed - aborting workflow`,
          commitResult.error,
          {
            executionId: message.executionId,
            ticketId: message.ticketId,
          },
        );
        // Don't throw - let the message be acknowledged
        // The error is already tracked by GitHubCommitOrchestrator
        return;
      }

      this.logger.log(`[${correlationId}] Git commit successful`, {
        executionId: message.executionId,
        commitSha: commitResult.commitSha,
        filesChanged: commitResult.filesChanged,
      });

      // Step 2: Create pull request
      this.logger.log(`[${correlationId}] Creating pull request`, {
        executionId: message.executionId,
      });
      await this.executionTracker.emitProgress(
        message.executionId,
        message.ticketId,
        null,
        'Creating PR',
        96,
      );

      const prResult = await this.prOrchestrator.createPullRequest(
        message.executionId,
        correlationId,
      );

      if (!prResult.success) {
        this.logger.error(`[${correlationId}] PR creation failed`, prResult.error, {
          executionId: message.executionId,
          ticketId: message.ticketId,
          commitSha: commitResult.commitSha,
        });
        // Don't throw - commit succeeded, PR failure is tracked
        return;
      }

      this.logger.log(`[${correlationId}] GitHub push workflow completed successfully`, {
        executionId: message.executionId,
        ticketId: message.ticketId,
        commitSha: commitResult.commitSha,
        prUrl: prResult.prUrl,
        prNumber: prResult.prNumber,
      });

      // Note: GitHubPROrchestrator already publishes deployment trigger event
      // No additional event publishing needed here

      // CLEANUP: DooD Elimination — Workspace cleanup is handled by OpenSandbox TTL
      this.logger.debug(
        `[${correlationId}] Skip workspace cleanup for ${message.executionId}, handled by OpenSandbox TTL`,
      );
    } catch (_error) {
      const err = _error as Error;
      this.logger.error(
        `[${correlationId}] GitHub push workflow failed`,
        err.stack || err.message,
        {
          executionId: message.executionId,
          ticketId: message.ticketId,
        },
      );

      // Rethrow to trigger RabbitMQ retry/DLQ logic
      throw _error;
    }
  }
}
