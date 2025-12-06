import { Test, TestingModule } from '@nestjs/testing';
import { GitHubBranchService } from './github-branch.service';
import { GitHubService } from '../github.service';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { RabbitMQPublisherService } from '../../rabbitmq/rabbitmq-publisher.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { GitHubStatus } from '@prisma/client';
import {
  generateBranchName,
  validateBranchName,
  generateUniqueBranchName,
} from '../utils/branch-name.util';

describe('GitHubBranchService', () => {
  let service: GitHubBranchService;
  let githubService: jest.Mocked<GitHubService>;
  let prismaService: jest.Mocked<PrismaService>;
  let sentryService: jest.Mocked<SentryService>;
  let metricsService: jest.Mocked<MetricsService>;
  let publisherService: jest.Mocked<RabbitMQPublisherService>;
  let logger: { info: jest.Mock; error: jest.Mock; warn: jest.Mock; debug: jest.Mock };

  const mockExecution: {
    id: string;
    ticket_id: string;
    ticket: { id: string; clickup_task_id: string; title: string };
  } = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    ticket: {
      id: 'ticket-456',
      clickup_task_id: 'DSF-123',
      title: 'Implement user authentication',
    },
  };

  const mockGitHubPush = {
    id: 'push-789',
    execution_id: 'exec-123',
    repository: 'owner/repo',
    branch_name: 'ai/dsf-123-implement-user-authentication',
    commit_sha: 'base-sha-abc123',
    pr_number: null,
    pr_url: null,
    push_status: GitHubStatus.BRANCH_CREATED,
    error_message: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    // Setup environment for getRepository()
    process.env.DEFAULT_REPOSITORY = 'owner/repo';

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubBranchService,
        {
          provide: GitHubService,
          useValue: {
            getRepository: jest.fn(),
            getBaseCommitSha: jest.fn(),
            createBranch: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            execution: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            gitHubPush: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: SentryService,
          useValue: {
            logError: jest.fn(),
            captureException: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGitHubOperation: jest.fn(),
            incrementGitHubRateLimitHit: jest.fn(),
            recordGitHubOperationDuration: jest.fn(),
          },
        },
        {
          provide: RabbitMQPublisherService,
          useValue: {
            publishToQueue: jest.fn(),
          },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GitHubBranchService>(GitHubBranchService);
    githubService = module.get(GitHubService) as jest.Mocked<GitHubService>;
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
    sentryService = module.get(SentryService) as jest.Mocked<SentryService>;
    metricsService = module.get(MetricsService) as jest.Mocked<MetricsService>;
    publisherService = module.get(
      RabbitMQPublisherService,
    ) as jest.Mocked<RabbitMQPublisherService>;
    logger = module.get(WINSTON_MODULE_PROVIDER);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DEFAULT_REPOSITORY;
  });

  describe('createBranchForExecution', () => {
    beforeEach(() => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      githubService.getRepository.mockResolvedValue({
        owner: 'owner',
        name: 'repo',
        defaultBranch: 'main',
        visibility: 'private',
        htmlUrl: 'https://github.com/owner/repo',
      });
      githubService.getBaseCommitSha.mockResolvedValue('base-sha-abc123');
      githubService.createBranch.mockResolvedValue(undefined);
      (prismaService.gitHubPush.create as jest.Mock).mockResolvedValue(mockGitHubPush);
    });

    it('should create a feature branch successfully', async () => {
      const result = await service.createBranchForExecution('exec-123');

      expect(result).toBeDefined();
      expect(result.branchName).toContain('ai/dsf-123');
      expect(result.pushStatus).toBe(GitHubStatus.BRANCH_CREATED);
      expect(prismaService.execution.findUnique).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        include: { ticket: true },
      });
      expect(githubService.createBranch).toHaveBeenCalled();
      expect(prismaService.gitHubPush.create).toHaveBeenCalled();
      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith(
        'create_branch',
        'success',
      );
    });

    it('should handle retry scenario by reusing existing branch', async () => {
      // Mock branch exists error (422)
      githubService.createBranch.mockRejectedValueOnce({
        status: 422,
        message: 'Reference already exists',
      });

      const result = await service.createBranchForExecution('exec-123', {
        isRetry: true,
      });

      expect(result).toBeDefined();
      expect(result.branchName).toContain('ai/dsf-123');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reusing'),
        expect.any(Object),
      );
    });

    it('should generate unique branch name for new execution when branch exists', async () => {
      // Mock branch exists error (422)
      githubService.createBranch
        .mockRejectedValueOnce({
          status: 422,
          message: 'Reference already exists',
        })
        .mockResolvedValueOnce(undefined); // Second attempt succeeds

      const result = await service.createBranchForExecution('exec-123', {
        isRetry: false,
      });

      expect(result).toBeDefined();
      expect(result.branchName).toContain('-'); // Has hyphens including timestamp
      expect(githubService.createBranch).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('generating unique name'),
        expect.any(Object),
      );
    });

    it('should throw error if execution not found', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.createBranchForExecution('invalid-id')).rejects.toThrow(
        'Execution invalid-id not found',
      );
    });

    it('should record failure metrics on error', async () => {
      githubService.createBranch.mockRejectedValue(new Error('Network error'));

      await expect(service.createBranchForExecution('exec-123')).rejects.toThrow();

      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith(
        'create_branch',
        'failed',
      );
    });
  });

  describe('Branch name generation (AC#1)', () => {
    it('should generate valid branch name with correct format', () => {
      const branchName = generateBranchName({
        ticketId: 'DSF-123',
        title: 'Implement User Authentication',
      });

      expect(branchName).toBe('ai/dsf-123-implement-user-authentication');
      expect(branchName).toMatch(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('should handle special characters in title', () => {
      const branchName = generateBranchName({
        ticketId: 'DSF-456',
        title: 'Fix bug: API returns 500 error!',
      });

      expect(branchName).toBe('ai/dsf-456-fix-bug-api-returns-500-error');
      expect(branchName).toMatch(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('should truncate long branch names to 63 characters', () => {
      const longTitle = 'This is a very very very long title that exceeds the git ref limit';
      const branchName = generateBranchName({
        ticketId: 'DSF-789',
        title: longTitle,
      });

      expect(branchName.length).toBeLessThanOrEqual(63);
      expect(branchName).toMatch(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('should add timestamp suffix when provided', () => {
      const timestamp = 1234567890;
      const branchName = generateBranchName({
        ticketId: 'DSF-111',
        title: 'Test',
        timestamp,
      });

      expect(branchName).toContain(`-${timestamp}`);
      expect(branchName).toBe(`ai/dsf-111-test-${timestamp}`);
    });

    it('should validate branch name correctly', () => {
      const validName = 'ai/dsf-123-feature-branch';
      const validation = validateBranchName(validName);

      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });

    it('should reject branch name with consecutive hyphens', () => {
      const invalidName = 'ai/dsf-123--double-hyphen';
      const validation = validateBranchName(invalidName);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('pattern'); // Regex catches it first
    });

    it('should reject branch name exceeding max length', () => {
      const tooLongName = 'ai/' + 'a'.repeat(65);
      const validation = validateBranchName(tooLongName);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('maximum length');
    });

    it('should reject branch name with invalid pattern', () => {
      const invalidName = 'feature/dsf-123-test'; // Wrong prefix
      const validation = validateBranchName(invalidName);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('pattern');
    });
  });

  describe('Unique branch name generation (AC#3)', () => {
    it('should generate unique branch name with timestamp', () => {
      const branchName = generateUniqueBranchName('DSF-222', 'Feature X');

      expect(branchName).toMatch(/^ai\/dsf-222-feature-x-\d+$/);
      expect(branchName).toMatch(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/);
    });
  });
});
