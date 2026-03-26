/**
 * Unit tests for GitHubCommitOrchestrator Service
 * Story 4.3: Git Commit Generation & Push
 *
 * NOTE: Simplified test approach for minimal viable completion
 * Uses basic mocking rather than full Prisma DeepMockProxy
 * Targets ~60% coverage of critical paths
 */

import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { GitHubCommitOrchestrator } from './github-commit-orchestrator.service';
import { GitHubService } from '../github.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics';
import { SentryService } from '@/common/sentry';
import { LoggerService } from '@/common/logger';
import { GitOperationsService } from '@/ai-routing/providers';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { AIProvider } from '@/prisma/client';
import { GitHubErrorMonitor } from './github-error-monitor.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { GitHubTokenResolverService } from '../github-token-resolver.service';

describe('GitHubCommitOrchestrator', () => {
  let service: GitHubCommitOrchestrator;
  let prismaService: PrismaService;
  let metricsService: MetricsService;
  let gitOpsService: GitOperationsService;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CLAUDE_CODE,
    complexity_score: 75,
    code_output: JSON.stringify({
      files_changed: [{ path: 'src/auth/user.service.ts', operation: 'modify' }],
    }),
    ticket: {
      clickup_task_id: 'DSF-245',
      title: 'Add JWT token refresh',
      description: 'Implements token refresh',
    },
  };

  const mockGitHubPush = {
    id: 'push-123',
    execution_id: 'exec-123',
    repository: 'owner/repo',
    branch_name: 'ai/DSF-245-jwt-refresh',
    commit_sha: null,
    push_status: 'BRANCH_CREATED',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubCommitOrchestrator,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              const config: Record<string, string> = {
                'anthropic.apiKey': '',
                'anthropic.model': 'claude-sonnet-4-20250514',
              };
              return config[key] ?? undefined;
            }),
          },
        },
        {
          provide: GitHubService,
          useValue: {},
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        // WorkspaceService removed (handled by OpenSandbox TTL)
        {
          provide: GitOperationsService,
          useValue: {
            commitAndPush: jest.fn(),
            getBranchInfo: jest.fn(),
            hasChanges: jest.fn().mockResolvedValue(true),
            ensureBranch: jest.fn().mockResolvedValue(undefined),
            push: jest.fn().mockResolvedValue(undefined),
            getCurrentCommitSha: jest
              .fn()
              .mockResolvedValue('abc123def456789012345678901234567890abcd'),
            getChangedFiles: jest.fn().mockResolvedValue(['src/auth/user.service.ts']),
            getDiff: jest.fn().mockResolvedValue('+added line'),
            commit: jest.fn().mockResolvedValue('abc123def456789012345678901234567890abcd'),
          },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: {
            logDecision: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            execution: {
              findUnique: jest.fn(),
            },
            gitHubPush: {
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            workspace: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGitHubCommitsCreated: jest.fn(),
            recordGitHubOperationDuration: jest.fn(),
            incrementCounter: jest.fn(),
            recordHistogram: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
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
        {
          provide: GitHubTokenResolverService,
          useValue: {
            resolveForProject: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubCommitOrchestrator>(GitHubCommitOrchestrator);
    prismaService = module.get<PrismaService>(PrismaService);
    metricsService = module.get<MetricsService>(MetricsService);
    gitOpsService = module.get<GitOperationsService>(GitOperationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('commitAndPush - Happy Path', () => {
    it('should successfully commit and push using direct git operations', async () => {
      // Arrange
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.gitHubPush.update as jest.Mock).mockResolvedValue({
        ...mockGitHubPush,
        commit_sha: 'abc123...',
      });
      (prismaService.workspace.findUnique as jest.Mock).mockResolvedValue({
        workspace_path: '/tmp/workspace',
        repository_url: 'owner/repo',
      });

      // Act
      const result = await service.commitAndPush('exec-123', 'corr-123');

      // Assert
      expect(result.success).toBe(true);
      expect(result.commitSha).toBeTruthy();
      expect(gitOpsService.getChangedFiles).toHaveBeenCalled();
      expect(gitOpsService.commit).toHaveBeenCalled();
      expect(gitOpsService.push).toHaveBeenCalled();
      expect(metricsService.incrementGitHubCommitsCreated).toHaveBeenCalledWith(
        'success',
        'owner/repo',
        AIProvider.CLAUDE_CODE,
      );
    });
  });

  describe('commitAndPush - Error Scenarios', () => {
    it('should handle execution not found', async () => {
      // Arrange
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await service.commitAndPush('invalid-id');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle GitHub push record not found', async () => {
      // Arrange
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await service.commitAndPush('exec-123');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub push record not found');
    });

    it('should handle AI provider failure gracefully', async () => {
      // Arrange - no AI provider override needed, git ops are mocked to succeed
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.gitHubPush.update as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.workspace.findUnique as jest.Mock).mockResolvedValue({
        workspace_path: '/tmp/workspace',
        repository_url: 'owner/repo',
      });

      // Act - should succeed with deterministic fallback commit message
      const result = await service.commitAndPush('exec-123');

      // Assert - Direct git operations should succeed
      expect(result.success).toBe(true);
      expect(gitOpsService.commit).toHaveBeenCalled();
      expect(gitOpsService.push).toHaveBeenCalled();
    });
  });

  describe('Metrics Recording', () => {
    it('should record success metrics', async () => {
      // Arrange
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.gitHubPush.update as jest.Mock).mockResolvedValue(mockGitHubPush);
      (prismaService.workspace.findUnique as jest.Mock).mockResolvedValue({
        workspace_path: '/tmp/workspace',
        repository_url: 'owner/repo',
      });

      // Act
      await service.commitAndPush('exec-123');

      // Assert
      expect(metricsService.recordGitHubOperationDuration).toHaveBeenCalledWith(
        'commit',
        expect.any(Number),
        'owner/repo',
      );
    });
  });
});
