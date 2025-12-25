import { Test, TestingModule } from '@nestjs/testing';
import { PRReminderService } from './pr-reminder.service';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../github.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';

describe('PRReminderService', () => {
  let service: PRReminderService;
  let configService: ConfigService;
  let githubService: GitHubService;
  let publisher: RabbitMQPublisherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PRReminderService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: GitHubService,
          useValue: {
            getPullRequest: jest.fn(),
            addPRComment: jest.fn(),
          },
        },
        {
          provide: RabbitMQPublisherService,
          useValue: { publishToQueue: jest.fn() },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: { logDecision: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { incrementCounter: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PRReminderService>(PRReminderService);
    configService = module.get<ConfigService>(ConfigService);
    githubService = module.get<GitHubService>(GitHubService);
    publisher = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should schedule initial reminder with TTL after checking PR status', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      merged: false,
    });

    await service.scheduleInitialReminder('exec-1', 'owner/repo', 1);

    expect(githubService.getPullRequest).toHaveBeenCalled();
    expect(publisher.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.GITHUB_PR_REMINDER_WAIT,
      expect.objectContaining({ attempt: 1 }),
      'exec-1',
      undefined,
      2 * 60 * 60 * 1000,
    );
  });

  it('should not schedule reminder if PR already merged', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      merged: true,
    });

    await service.scheduleInitialReminder('exec-1', 'owner/repo', 1);

    expect(publisher.publishToQueue).not.toHaveBeenCalled();
  });

  it('should process reminder and schedule next one via WAIT queue', async () => {
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      merged: false,
      head: { ref: 'feature/branch' },
    });

    await service.processReminder({
      executionId: 'exec-1',
      repository: 'owner/repo',
      prNumber: 1,
      attempt: 1,
    });

    expect(githubService.addPRComment).toHaveBeenCalled();
    expect(publisher.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.GITHUB_PR_REMINDER_WAIT,
      expect.objectContaining({ attempt: 2 }),
      'exec-1',
      undefined,
      2 * 60 * 60 * 1000,
    );
  });
});
