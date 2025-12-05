import { Injectable } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { GitHubAuthService } from './github-auth.service';
import {
  GitHubNetworkError,
  GitHubRateLimitError,
  GitHubResourceNotFoundError,
  GitHubBaseException,
} from './exceptions/github.exceptions';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';

@Injectable()
export class GitHubClientService {
  constructor(
    private readonly authService: GitHubAuthService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly publisher: RabbitMQPublisherService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async getClient(installationId?: string): Promise<Octokit> {
    return this.authService.getAuthenticatedClient(installationId);
  }

  /**
   * Safe execution wrapper for GitHub operations with error handling and rate limit detection
   */
  async execute<T>(
    operation: (client: Octokit) => Promise<T>,
    installationId?: string,
    context: string = 'unknown_operation',
  ): Promise<T> {
    const client = await this.getClient(installationId);

    try {
      const result = await operation(client);

      // Update rate limit gauge if headers are available (needs explicit implementation or Octokit hook)
      // Since execute wraps the operation call, 'result' is the response data usually.
      // Octokit operations return { data, headers, status }. We should type the generic T likely to be expected response.
      // But typically this wrapper is used like: execute(async c => (await c.repo.get()).data).
      // If we want metrics we might need to access the full response inside the callback or change usage.
      // For now, let's assume usage pattern adjustment or we rely on Octokit hooks in getClient if we were to implement them.
      // Given constraints, I'll bubble up success metric here if possible, but headers are hard to get if operation unwraps data.

      // Let's assume operation usage returns full response if we want headers, OR we just increment operation count.
      this.metrics.incrementGitHubOperation(context, 'success');

      return result;
    } catch (error: unknown) {
      this.metrics.incrementGitHubOperation(context, 'failure');
      this.handleError(error, context);
      throw error; // Make TS happy, handleError throws
    }
  }

  private handleError(error: unknown, context: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any; // Safe assumption for Octokit errors which are generally objects
    // 1. Rate Limit Handling (403 + x-ratelimit-remaining = 0, or 429)
    if (
      err.status === 429 ||
      (err.status === 403 && err.response?.headers?.['x-ratelimit-remaining'] === '0')
    ) {
      const resetTimeHeader = err.response?.headers?.['x-ratelimit-reset'];
      const resetTime = resetTimeHeader
        ? new Date(parseInt(resetTimeHeader) * 1000)
        : new Date(Date.now() + 60000); // Default 1 min

      this.metrics.incrementGitHubRateLimitHit();

      this.logger.warn(`GitHub Rate Limit Exceeded during ${context}`, {
        resetTime,
        limit: err.response?.headers?.['x-ratelimit-limit'],
      });

      // AC#3: Publish to retry queue with delay
      const delay = resetTime ? Math.max(0, resetTime.getTime() - Date.now()) : 60000;
      this.publisher
        .publishToQueue(
          'github-retry-queue',
          {
            context,
            error: err.message,
            resetTime,
          },
          undefined, // correlationId
          delay,
        )
        .catch((err) =>
          this.logger.error(`Failed to publish to retry queue: ${err.message}`, err.stack),
        );

      throw new GitHubRateLimitError(resetTime);
    }

    // 2. Not Found
    if (err.status === 404) {
      this.sentry.captureException(err, {
        category: ErrorCategory.GITHUB,
        tags: { context, service: 'GitHubClientService', type: 'not_found' },
      });
      throw new GitHubResourceNotFoundError(context);
    }

    // 3. Network / Server Errors
    if (err.status >= 500) {
      this.sentry.captureException(err, {
        category: ErrorCategory.GITHUB, // Categorize as GitHub/Network
        tags: { context, service: 'GitHubClientService', type: 'network' },
      });
      throw new GitHubNetworkError(err.message);
    }

    // 4. Propagate existing typed errors
    if (error instanceof GitHubBaseException) {
      throw error;
    }

    // Default catch-all
    this.logger.error(`GitHub API Error in ${context}`, { error: err });

    this.sentry.captureException(err, {
      category: ErrorCategory.GITHUB,
      tags: { context, service: 'GitHubClientService' },
    });

    throw error;
  }
}
