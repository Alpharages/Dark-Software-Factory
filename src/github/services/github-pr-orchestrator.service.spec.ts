/**
 * GitHub PR Orchestrator Service Tests
 * Story 4.4: Pull Request Creation & Metadata
 * AC#1, #3, #4, #5, #6: Full PR orchestration flow
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { GitHubPROrchestrator } from './github-pr-orchestrator.service';
import { OrchestratorService } from '../../ai-routing/orchestrator.service';
import { GitHubService } from '../github.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { GitHubErrorMonitor } from './github-error-monitor.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';

describe('GitHubPROrchestrator', () => {
  let service: GitHubPROrchestrator;
  let orchestratorService: jest.Mocked<OrchestratorService>;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditLogService>;
  let metricsService: jest.Mocked<MetricsService>;
  let _sentryService: jest.Mocked<SentryService>;
  let errorMonitor: jest.Mocked<GitHubErrorMonitor>;
  let _logger: jest.Mocked<Logger>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    ai_provider: 'CURSOR_HEADLESS',
    complexity_score: 75,
    confidence_score: 92,
    ticket: {
      clickup_task_id: 'DSF-245',
      title: 'Implement user authentication',
      description: 'Add JWT-based authentication',
    },
  };

  const mockGitHubPush = {
    id: 'push-789',
    execution_id: 'exec-123',
    repository: 'org/repo',
    branch_name: 'ai/DSF-245-auth',
    push_status: 'PUSHED',
  };

  const mockQAResults = {
    linting_passed: true,
    tests_passed: true,
    test_coverage: 85,
    code_review_passed: true,
    qa_summary_details: 'All checks passed',
  };

  beforeEach(async () => {
    const mockOrchestrator = {
      execute: jest.fn(),
    };

    const mockPrisma = {
      execution: {
        findUnique: jest.fn(),
      },
      gitHubPush: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      qAResult: {
        findFirst: jest.fn(),
      },
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const mockSentry = {
      captureException: jest.fn(),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubPROrchestrator,
        {
          provide: OrchestratorService,
          useValue: mockOrchestrator,
        },
        {
          provide: GitHubService,
          useValue: {},
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
          provide: WINSTON_MODULE_PROVIDER,
          useValue: mockLogger,
        },
        {
          provide: GitHubErrorMonitor,
          useValue: {
            recordError: jest.fn(),
            classifyError: jest.fn().mockReturnValue({
              severity: 'medium',
              retryable: true,
              category: 'github_api',
            }),
            sanitizeError: jest.fn().mockImplementation((msg: string) => msg),
            checkForRollback: jest.fn().mockResolvedValue(false),
            handleGitHubError: jest.fn(),
          },
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
      ],
    }).compile();

    service = module.get<GitHubPROrchestrator>(GitHubPROrchestrator);
    orchestratorService = module.get(OrchestratorService);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditLogService);
    metricsService = module.get(MetricsService);
    _sentryService = module.get(SentryService);
    errorMonitor = module.get(GitHubErrorMonitor);
    _logger = module.get(WINSTON_MODULE_PROVIDER);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPullRequest', () => {
    it('should create PR via AI delegation (success path)', async () => {
      // Setup mocks
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: JSON.stringify({
          prUrl: 'https://github.com/org/repo/pull/42',
          prNumber: 42,
        }),
      });

      // Execute
      const result = await service.createPullRequest('exec-123');

      // Assert
      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
      expect(result.prNumber).toBe(42);
    });

    it('should parse JSON AI response', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: '{"prUrl":"https://github.com/org/repo/pull/123","prNumber":123}',
      });

      const result = await service.createPullRequest('exec-123');

      expect(result.prNumber).toBe(123);
    });

    it('should parse unstructured AI response (regex fallback)', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: 'PR created: https://github.com/org/repo/pull/999',
      });

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(true);
      expect(result.prNumber).toBe(999);
    });

    it('should update database with PR URL/number', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: '{"prUrl":"https://github.com/org/repo/pull/42","prNumber":42}',
      });

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
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: '{"prUrl":"https://github.com/org/repo/pull/42","prNumber":42}',
      });

      await service.createPullRequest('exec-123');

      expect(auditService.log).toHaveBeenCalledWith({
        action: 'github_pr_create',
        entityType: 'execution',
        entityId: 'exec-123',
        actorType: 'system',
        afterState: expect.objectContaining({
          repository: 'org/repo',
          prUrl: 'https://github.com/org/repo/pull/42',
          prNumber: 42,
        }),
      });
    });

    it('should record metrics (success)', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: '{"prUrl":"https://github.com/org/repo/pull/42","prNumber":42}',
      });

      await service.createPullRequest('exec-123');

      expect(metricsService.incrementGitHubOperation).toHaveBeenCalledWith('pr_create', 'success');
      expect(metricsService.recordGitHubOperationDuration).toHaveBeenCalled();
    });

    it('should handle AI timeout error', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockRejectedValue(
        new Error('AI execution timeout'),
      );

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('AI execution timeout');
      expect(errorMonitor.handleGitHubError).toHaveBeenCalled();
    });

    it('should handle parsing failure', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: 'Invalid output with no PR URL',
      });

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to extract PR URL');
    });

    it('should handle database update failure', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.qAResult.findFirst as jest.Mock).mockResolvedValue(mockQAResults);

      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: true,
        codeDiff: '{"prUrl":"https://github.com/org/repo/pull/42","prNumber":42}',
      });

      (prismaService.gitHubPush.update as jest.Mock).mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await service.createPullRequest('exec-123');

      expect(result.success).toBe(false);
      expect(errorMonitor.handleGitHubError).toHaveBeenCalled();
    });

    it('should forward errors to error monitor', async () => {
      (prismaService.execution.findUnique as jest.Mock).mockRejectedValue(
        new Error('Execution not found'),
      );

      await service.createPullRequest('exec-123');

      expect(errorMonitor.handleGitHubError).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-123',
          operation: 'pr_creation',
        }),
      );
    });
  });
});
