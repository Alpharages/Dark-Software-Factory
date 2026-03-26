/**
 * GitHub PR Orchestrator Service Tests
 * Story 4.4: Pull Request Creation & Metadata
 * AC#1, #3, #4, #5, #6: Full PR orchestration flow
 *
 * PR creation now uses Anthropic SDK for title/body generation and
 * GitHubService (Octokit) for the actual API call — no container CLI.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubPROrchestrator } from './github-pr-orchestrator.service';
import { GitHubService } from '../github.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { LoggerService } from '../../common/logger/logger.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PRAutoMergeService } from './pr-auto-merge.service';
import { PRReminderService } from './pr-reminder.service';

describe('GitHubPROrchestrator', () => {
  let service: GitHubPROrchestrator;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditLogService>;
  let metricsService: jest.Mocked<MetricsService>;
  let githubService: jest.Mocked<GitHubService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    ai_provider: 'CLAUDE_CODE',
    complexity_score: 75,
    confidence_score: 92,
    ticket: {
      clickup_task_id: 'DSF-245',
      title: 'Implement user authentication',
      description: 'Add JWT-based authentication',
      project_id: 'project-001',
    },
  };

  const mockGitHubPush = {
    id: 'push-789',
    execution_id: 'exec-123',
    repository: 'https://github.com/org/repo',
    branch_name: 'feature/ticket-DSF-245',
    push_status: 'PUSHED',
    commit_sha: 'abc123',
  };

  const mockPRData = {
    number: 42,
    html_url: 'https://github.com/org/repo/pull/42',
  };

  beforeEach(async () => {
    const mockPrisma = {
      execution: {
        findUnique: jest.fn(),
      },
      gitHubPush: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ github_account_id: null }),
      },
      gitHubAccount: {
        findUnique: jest.fn(),
      },
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const mockSentry = {
      captureException: jest.fn(),
    };

    const mockGitHub = {
      createPullRequest: jest.fn().mockResolvedValue(mockPRData),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubPROrchestrator,
        {
          provide: ConfigService,
          // No Anthropic API key → fallback title/body used in tests
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: GitHubService,
          useValue: mockGitHub,
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: AuditLogService,
          useValue: mockAudit,
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGitHubOperation: jest.fn(),
            recordGitHubOperationDuration: jest.fn(),
            incrementCounter: jest.fn(),
            recordHistogram: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: mockSentry,
        },
        {
          provide: RabbitMQService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
            publishToQueue: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn(),
            getChannel: jest.fn(),
          },
        },
        {
          provide: PRRiskAssessorService,
          useValue: {
            assess: jest.fn().mockResolvedValue({
              riskLevel: 'LOW',
              reasoning: 'Test risk assessment',
              mergeRecommendation: 'proceed',
            }),
          },
        },
        {
          provide: PRAutoMergeService,
          useValue: {
            attemptAutoMerge: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PRReminderService,
          useValue: {
            scheduleInitialReminder: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubPROrchestrator>(GitHubPROrchestrator);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditLogService);
    metricsService = module.get(MetricsService);
    githubService = module.get(GitHubService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPullRequest', () => {
    it('should create PR via GitHub REST API (success path)', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
      expect(result.prNumber).toBe(42);
      expect(githubService.createPullRequest).toHaveBeenCalledWith(
        'org',
        'repo',
        expect.any(String), // title
        expect.any(String), // body
        'feature/ticket-DSF-245',
        'main',
        undefined, // no installationId (github_account_id is null)
      );
    });

    it('should update database with PR URL/number', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);

      await service.createPullRequest('exec-123');

      expect(prismaService.gitHubPush.update).toHaveBeenCalledWith({
        where: { id: 'push-789' },
        data: {
          pr_number: 42,
          pr_url: 'https://github.com/org/repo/pull/42',
          push_status: 'PR_CREATED',
        },
      });
    });

    it('should create audit log entry', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);

      await service.createPullRequest('exec-123');

      expect(auditService.log).toHaveBeenCalledWith({
        action: 'github_pr_create',
        entityType: 'execution',
        entityId: 'exec-123',
        actorType: 'system',
        afterState: expect.objectContaining({
          repository: 'https://github.com/org/repo',
          prUrl: 'https://github.com/org/repo/pull/42',
          prNumber: 42,
        }),
      });
    });

    it('should record metrics on success', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);

      await service.createPullRequest('exec-123');

      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith('pr_create', 'success');
      expect(metricsService.recordGitHubOperationDuration).toHaveBeenCalled();
    });

    it('should use per-project installationId when project has linked GitHub account', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue({
        github_account_id: 'account-uuid-1',
      });
      (prismaService.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        installationId: 'install-id-abc',
      });

      await service.createPullRequest('exec-123');

      expect(githubService.createPullRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'main',
        'install-id-abc',
      );
    });

    it('should parse owner/repo from full GitHub URL', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue({
        ...mockGitHubPush,
        repository: 'https://github.com/myorg/myrepo.git',
      });

      await service.createPullRequest('exec-123');

      expect(githubService.createPullRequest).toHaveBeenCalledWith(
        'myorg',
        'myrepo',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'main',
        undefined,
      );
    });

    it('should return error result when execution not found', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution exec-123 not found');
    });

    it('should return error result when github push record not found', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub push record not found');
    });

    it('should handle GitHub API failure', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (githubService.createPullRequest as jest.Mock).mockRejectedValue(
        new Error('GitHub API error: 422 Unprocessable Entity'),
      );

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub API error');
    });

    it('should handle database update failure', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.gitHubPush.update as jest.Mock).mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
    });
  });
});
