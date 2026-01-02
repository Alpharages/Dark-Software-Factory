/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { GitHubClientService } from './github-client.service';
import { GitHubAuthService } from './github-auth.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { LoggerService } from '../common/logger/logger.service';
import {
  GitHubRateLimitError,
  GitHubResourceNotFoundError,
  GitHubNetworkError,
} from './exceptions/github.exceptions';

describe('GitHubClientService', () => {
  let service: GitHubClientService;
  let authService: GitHubAuthService;
  let metricsService: MetricsService;
  let sentryService: SentryService;
  let publisherService: RabbitMQPublisherService;
  let logger: { warn: jest.Mock; error: jest.Mock; log: jest.Mock; debug: jest.Mock };

  const mockOctokit = {
    request: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubClientService,
        {
          provide: GitHubAuthService,
          useValue: {
            getAuthenticatedClient: jest.fn().mockResolvedValue(mockOctokit),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGitHubOperation: jest.fn(),
            incrementGitHubRateLimitHit: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
        {
          provide: RabbitMQPublisherService,
          useValue: {
            publishToQueue: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubClientService>(GitHubClientService);
    authService = module.get<GitHubAuthService>(GitHubAuthService);
    metricsService = module.get<MetricsService>(MetricsService);
    sentryService = module.get<SentryService>(SentryService);
    publisherService = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    logger = module.get(LoggerService) as unknown;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('execute', () => {
    it('should execute operation successfully and record metric', async () => {
      const operation = jest.fn().mockResolvedValue({ data: 'success' });

      const result = await service.execute(operation, undefined, 'test_op');

      expect(result).toEqual({ data: 'success' });
      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith('test_op', 'success');
    });

    it('should handle 429 Rate Limit error by publishing to retry queue', async () => {
      const resetTimeUnix = Math.floor(Date.now() / 1000) + 60; // 1 min from now
      const error: Record<string, unknown> = {
        status: 429,
        message: 'Too Many Requests',
        response: { headers: { 'x-ratelimit-reset': String(resetTimeUnix) } },
      };
      const operation = jest.fn().mockRejectedValue(error);

      await expect(service.execute(operation, undefined, 'test_op')).rejects.toThrow(
        GitHubRateLimitError,
      );

      expect(metricsService.incrementGitHubRateLimitHit).toHaveBeenCalled();
      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith('test_op', 'failure');
      expect(logger.warn).toHaveBeenCalled();

      // Verify RabbitMQ publishing (publishToQueue has 4 params: queue, payload, correlationId, delayMs)
      expect(publisherService.publishToQueue).toHaveBeenCalledWith(
        'github-retry-queue',
        expect.objectContaining({
          context: 'test_op',
          error: 'Too Many Requests',
        }),
        undefined, // correlationId
        expect.any(Number), // delayMs
      );
    });

    it('should handle 404 error', async () => {
      const error: Record<string, unknown> = { status: 404 };
      const operation = jest.fn().mockRejectedValue(error);

      await expect(service.execute(operation, undefined, 'test_op')).rejects.toThrow(
        GitHubResourceNotFoundError,
      );
      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith('test_op', 'failure');
      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should handle 500 Network error', async () => {
      const error: Record<string, unknown> = { status: 500, message: 'Server Error' };
      const operation = jest.fn().mockRejectedValue(error);

      await expect(service.execute(operation, undefined, 'test_op')).rejects.toThrow(
        GitHubNetworkError,
      );
      expect(sentryService.captureException).toHaveBeenCalled();
    });
  });
});
