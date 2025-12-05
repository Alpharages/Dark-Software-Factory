import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { GitHubService } from '../github.service';
import { GitHubPushDto } from '../dto/github-push.dto';
import { BranchOptions, BranchCreationResult } from '../interfaces/branch-options.interface';
import {
  generateBranchName,
  validateBranchName,
  generateUniqueBranchName,
} from '../utils/branch-name.util';
import {
  GitHubPermissionError,
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubResourceNotFoundError,
  GitHubNetworkError,
} from '../exceptions/github.exceptions';
import { GitHubStatus, ExecutionStatus } from '@prisma/client';
import { RabbitMQPublisherService } from '../../rabbitmq/rabbitmq-publisher.service';

/**
 * GitHub Branch Service
 *
 * Handles feature branch creation for AI-generated code
 * Implements AC#1-6 from Story 4.2
 */
@Injectable()
export class GitHubBranchService {
  constructor(
    private readonly githubService: GitHubService,
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly publisher: RabbitMQPublisherService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * Creates a feature branch for an execution
   *
   * AC#1: Branch naming convention
   * AC#2: Branch creation from base
   * AC#3: Branch existence validation
   * AC#4: Database record persistence
   * AC#5: Error handling & resilience
   * AC#6: Observability & metrics
   */
  async createBranchForExecution(
    executionId: string,
    options: BranchOptions = { isRetry: false },
  ): Promise<GitHubPushDto> {
    const startTime = Date.now();
    const { correlationId, isRetry, installationId } = options;

    try {
      // Load execution with ticket relation to get ticket_id
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { ticket: true },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const ticketId = execution.ticket.clickup_task_id;
      const repository = this.getRepository(); // From env or config

      this.logger.info('Creating feature branch', {
        executionId,
        ticketId,
        repository,
        isRetry,
        correlationId,
      });

      // AC#1: Generate branch name
      const branchName = generateBranchName({
        ticketId,
        title: execution.ticket.title,
      });

      // Validate branch name
      const validation = validateBranchName(branchName);
      if (!validation.valid) {
        throw new Error(`Invalid branch name: ${validation.error}`);
      }

      // AC#2: Get repository details and base SHA
      const [owner, repo] = repository.split('/');
      const repoDetails = await this.githubService.getRepository(owner, repo, installationId);
      const baseBranch = repoDetails.defaultBranch;

      // Get base commit SHA
      const baseSha = await this.getBaseCommitSha(owner, repo, baseBranch, installationId);

      // AC#3: Create branch with existence handling
      const result = await this.createBranchWithRetryLogic(
        owner,
        repo,
        branchName,
        baseSha,
        ticketId,
        execution.ticket.title,
        isRetry,
        installationId,
      );

      // AC#4: Persist to database
      const githubPush = await this.prisma.gitHubPush.create({
        data: {
          execution_id: executionId,
          repository,
          branch_name: result.branchName,
          commit_sha: result.commitSha,
          push_status: GitHubStatus.BRANCH_CREATED,
        },
      });

      // AC#6: Record metrics
      const duration = Date.now() - startTime;

      this.metrics.incrementGitHubOperation('create_branch', 'success');

      this.logger.info('Feature branch created successfully', {
        executionId,
        ticketId,
        branchName: result.branchName,
        wasReused: result.wasReused,
        correlationId,
        duration,
      });

      return this.mapToDto(githubPush);
    } catch (error) {
      const duration = Date.now() - startTime;

      // AC#5: Error handling
      await this.handleBranchCreationError(error as Error, executionId, options, duration);

      // Record failure
      this.metrics.incrementGitHubOperation('create_branch', 'failed');

      throw error;
    }
  }

  /**
   * AC#3: Creates branch with handling for existence conflicts
   */
  private async createBranchWithRetryLogic(
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
    ticketId: string,
    title: string,
    isRetry: boolean,
    installationId?: string,
  ): Promise<BranchCreationResult> {
    try {
      await this.githubService.createBranch(owner, repo, branchName, baseSha, installationId);

      return {
        branchName,
        commitSha: baseSha,
        wasReused: false,
      };
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };

      // Handle 422: Branch already exists
      if (err.status === 422) {
        if (isRetry) {
          // Retry: Reuse existing branch (idempotent)
          this.logger.info('Reusing existing branch for retry', {
            branchName,
            repository: `${owner}/${repo}`,
          });

          return {
            branchName,
            commitSha: baseSha,
            wasReused: true,
          };
        } else {
          // New execution: Generate unique name with timestamp
          const uniqueBranchName = generateUniqueBranchName(ticketId, title);
          this.logger.info('Branch exists, generating unique name', {
            originalBranch: branchName,
            uniqueBranch: uniqueBranchName,
            repository: `${owner}/${repo}`,
          });

          await this.githubService.createBranch(
            owner,
            repo,
            uniqueBranchName,
            baseSha,
            installationId,
          );

          return {
            branchName: uniqueBranchName,
            commitSha: baseSha,
            wasReused: false,
          };
        }
      }

      throw error;
    }
  }

  /**
   * AC#2: Gets the base commit SHA from default branch
   */
  private async getBaseCommitSha(
    owner: string,
    repo: string,
    branch: string,
    installationId?: string,
  ): Promise<string> {
    return this.githubService.getBaseCommitSha(owner, repo, branch, installationId);
  }

  /**
   * AC#5: Comprehensive error handling
   */
  private async handleBranchCreationError(
    error: Error,
    executionId: string,
    options: BranchOptions,
    _duration: number,
  ): Promise<void> {
    const { correlationId } = options;

    // Categorize errors and handle accordingly
    if (error instanceof GitHubAuthError) {
      // Non-retryable: Auth failure
      this.logger.error('GitHub authentication failed', {
        executionId,
        error: error.message,
        correlationId,
      });

      this.sentry.captureException(error, {
        extra: {
          executionId,
          operation: 'branch_create',
          correlationId,
        },
      });

      // Update execution status
      await this.updateExecutionStatus(executionId, 'FAILED');
    } else if (error instanceof GitHubRateLimitError) {
      // Retryable: Rate limit exceeded
      const delayMs = error.resetTime ? error.resetTime.getTime() - Date.now() : 60000; // Default 1 minute

      this.logger.warn('GitHub rate limit exceeded', {
        executionId,
        resetTime: error.resetTime,
        delayMs,
        correlationId,
      });

      this.metrics.incrementGitHubRateLimitHit();

      // AC#5: Publish to retry queue with delay from X-RateLimit-Reset header
      await this.publisher.publishToQueue(
        'github-retry-queue',
        {
          executionId,
          operation: 'branch_create',
          retryCount: 0,
        },
        correlationId,
        delayMs,
      );
    } else if (error instanceof GitHubPermissionError) {
      // Non-retryable: Permission denied
      this.logger.error('GitHub permission denied', {
        executionId,
        operation: error.operation,
        correlationId,
      });

      this.sentry.captureException(error, {
        extra: {
          executionId,
          operation: 'branch_create',
          correlationId,
        },
      });

      await this.updateExecutionStatus(executionId, 'FAILED');
    } else if (error instanceof GitHubResourceNotFoundError) {
      // Non-retryable: Repository not found
      this.logger.error('GitHub repository not found', {
        executionId,
        error: error.message,
        correlationId,
      });

      this.sentry.captureException(error, {
        extra: {
          executionId,
          operation: 'branch_create',
          correlationId,
        },
      });

      await this.updateExecutionStatus(executionId, 'FAILED');
    } else if (error instanceof GitHubNetworkError) {
      // Retryable: Network error with exponential backoff (2s)
      this.logger.warn('GitHub network error, retrying in 2 seconds', {
        executionId,
        error: error.message,
        correlationId,
      });

      // AC#5: Publish to retry queue with 2-second delay (first retry)
      await this.publisher.publishToQueue(
        'github-retry-queue',
        {
          executionId,
          operation: 'branch_create',
          retryCount: 0,
        },
        correlationId,
        2000, // 2 seconds for first retry
      );
    } else {
      // Unknown error
      this.logger.error('Unexpected error during branch creation', {
        executionId,
        error: error.message,
        stack: error.stack,
        correlationId,
      });

      this.sentry.captureException(error, {
        extra: {
          executionId,
          operation: 'branch_create',
          correlationId,
        },
      });
    }
  }

  /**
   * Updates execution status on fatal errors
   */
  private async updateExecutionStatus(executionId: string, status: string): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: status as ExecutionStatus },
    });
  }

  /**
   * AC#6: Determines account type from repository owner
   */
  private getAccountType(repository: string): string {
    // Simple heuristic: organizations typically have uppercase or special chars
    // Real implementation would query GitHub API or use cached data
    const owner = repository.split('/')[0];
    return owner.includes('-') || /[A-Z]/.test(owner) ? 'organization' : 'user';
  }

  /**
   * Gets repository from environment/config
   * TODO: Make configurable per project
   */
  private getRepository(): string {
    // Placeholder - should come from execution context or config
    return process.env.DEFAULT_REPOSITORY || 'owner/repo';
  }

  /**
   * Maps Prisma model to DTO
   */
  private mapToDto(githubPush: {
    id: string;
    execution_id: string;
    repository: string;
    branch_name: string;
    commit_sha: string | null;
    pr_number: number | null;
    pr_url: string | null;
    push_status: GitHubStatus;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
  }): GitHubPushDto {
    const dto = new GitHubPushDto();
    dto.id = githubPush.id;
    dto.executionId = githubPush.execution_id;
    dto.repository = githubPush.repository;
    dto.branchName = githubPush.branch_name;
    dto.commitSha = githubPush.commit_sha;
    dto.prNumber = githubPush.pr_number;
    dto.prUrl = githubPush.pr_url;
    dto.pushStatus = githubPush.push_status;
    dto.errorMessage = githubPush.error_message;
    dto.createdAt = githubPush.created_at;
    dto.updatedAt = githubPush.updated_at;
    return dto;
  }
}
