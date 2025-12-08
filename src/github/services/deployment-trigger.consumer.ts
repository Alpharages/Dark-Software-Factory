import { Injectable, Logger } from '@nestjs/common';
import { RabbitMQConsumerBase } from '../../rabbitmq/rabbitmq-consumer.base';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { DeploymentOrchestrator } from './deployment-orchestrator.service';
import { TriggerDeploymentDto } from '../dto/trigger-deployment.dto';

interface GitHubPRCreatedMessage {
  executionId: string;
  githubPushId: string;
  repository: string;
  branchName: string;
  commitSha: string;
  prUrl: string;
  prNumber: number;
  ticketId?: string;
  environment?: 'dev' | 'staging' | 'production';
}

/**
 * Consumer for GitHub PR Created events to trigger CI/CD deployments
 *
 * Story 4.5 AC#1: Consumes messages from github-pr-created-queue
 * Published by Story 4.4 (GitHubPROrchestrator) after PR creation
 */
@Injectable()
export class DeploymentTriggerConsumer extends RabbitMQConsumerBase {
  protected readonly logger = new Logger(DeploymentTriggerConsumer.name);
  protected readonly queueName = 'github-pr-created-queue';
  protected readonly prefetchCount = 1; // Process one deployment at a time

  constructor(
    protected readonly rabbitMQ: RabbitMQService,
    private readonly deploymentOrchestrator: DeploymentOrchestrator,
  ) {
    super();
  }

  /**
   * Process PR created message and trigger deployment
   * AC#1: Validate PR metadata → invoke DeploymentOrchestrator
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async processMessage(payload: any, correlationId: string): Promise<void> {
    const message = payload as GitHubPRCreatedMessage;
    this.logger.log(`[${correlationId}] Processing PR created event for deployment trigger`, {
      executionId: message.executionId,
      githubPushId: message.githubPushId,
      prNumber: message.prNumber,
    });

    try {
      // Validate PR metadata (AC#1)
      if (!message.prNumber || !message.prUrl) {
        this.logger.warn(`[${correlationId}] Skipping deployment - PR metadata missing`, {
          githubPushId: message.githubPushId,
          prNumber: message.prNumber,
          prUrl: message.prUrl,
        });
        return; // Skip deployment without failing
      }

      // Prepare deployment trigger DTO
      const triggerDto: TriggerDeploymentDto = {
        githubPushId: message.githubPushId,
        repository: message.repository,
        branchName: message.branchName,
        commitSha: message.commitSha,
        environment: message.environment || 'dev', // Default to dev
        prNumber: message.prNumber,
        prUrl: message.prUrl,
        ticketId: message.ticketId,
        executionId: message.executionId,
      };

      // Trigger deployment (AC#1)
      const deploymentId = await this.deploymentOrchestrator.triggerDeployment(triggerDto);

      if (deploymentId) {
        this.logger.log(`[${correlationId}] Deployment triggered successfully`, {
          deploymentId,
          executionId: message.executionId,
          prNumber: message.prNumber,
        });
      } else {
        this.logger.log(`[${correlationId}] Deployment skipped (no workflow configured)`, {
          executionId: message.executionId,
        });
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `[${correlationId}] Failed to trigger deployment`,
        err.stack || err.message,
        {
          executionId: message.executionId,
          githubPushId: message.githubPushId,
        },
      );

      // Rethrow to trigger RabbitMQ retry/DLQ logic
      throw error;
    }
  }
}
