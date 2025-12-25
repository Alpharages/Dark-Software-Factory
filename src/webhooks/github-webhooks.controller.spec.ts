import { Test, TestingModule } from '@nestjs/testing';
import { GitHubWebhooksController } from './github-webhooks.controller';
import { PrismaService } from '@/database/prisma.service';
import { FileLockManagerService } from '@/file-locks/file-lock-manager.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '@/rabbitmq/rabbitmq.config';
import { GitHubWebhookSignatureGuard } from './guards';

describe('GitHubWebhooksController', () => {
  let controller: GitHubWebhooksController;
  let rabbitMQ: jest.Mocked<RabbitMQService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitHubWebhooksController],
      providers: [
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: FileLockManagerService,
          useValue: {},
        },
        {
          provide: RabbitMQService,
          useValue: {
            publishToExchange: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(GitHubWebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GitHubWebhooksController>(GitHubWebhooksController);
    rabbitMQ = module.get(RabbitMQService);
  });

  it('should publish to RabbitMQ on synchronize action', async () => {
    const payload = {
      action: 'synchronize',
      pull_request: { number: 42 },
      repository: { full_name: 'org/repo' },
    };

    await controller.handleGitHubWebhook('pull_request', payload, 'corr-123');

    expect(rabbitMQ.publishToExchange).toHaveBeenCalledWith(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.GITHUB_WEBHOOK_RECEIVED,
      expect.objectContaining({
        event: 'pull_request',
        payload: payload,
      }),
      { correlationId: 'corr-123' },
    );
  });

  it('should publish to RabbitMQ on reopened action', async () => {
    const payload = {
      action: 'reopened',
      pull_request: { number: 42 },
      repository: { full_name: 'org/repo' },
    };

    await controller.handleGitHubWebhook('pull_request', payload, 'corr-123');

    expect(rabbitMQ.publishToExchange).toHaveBeenCalledWith(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.GITHUB_WEBHOOK_RECEIVED,
      expect.objectContaining({
        event: 'pull_request',
        payload: payload,
      }),
      { correlationId: 'corr-123' },
    );
  });

  it('should NOT publish to RabbitMQ on other actions', async () => {
    const payload = {
      action: 'labeled',
      pull_request: { number: 42 },
      repository: { full_name: 'org/repo' },
    };

    await controller.handleGitHubWebhook('pull_request', payload, 'corr-123');

    expect(rabbitMQ.publishToExchange).not.toHaveBeenCalled();
  });
});
