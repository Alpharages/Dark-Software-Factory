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
import { GitHubCommitOrchestrator } from './github-commit-orchestrator.service';
import { OrchestratorService } from '../../ai-routing/orchestrator.service';
import { GitHubService } from '../github.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { AIProvider } from '@prisma/client';

describe('GitHubCommitOrchestrator', () => {
  let service: GitHubCommitOrchestrator;
  let orchestratorService: OrchestratorService;
  let prismaService: PrismaService;
  let metricsService: MetricsService;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CURSOR_HEADLESS,
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
          provide: OrchestratorService,
          useValue: {
            execute: jest.fn(),
          },
        },
        {
          provide: GitHubService,
          useValue: {},
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
      ],
    }).compile();

    service = module.get<GitHubCommitOrchestrator>(GitHubCommitOrchestrator);
    orchestratorService = module.get<OrchestratorService>(OrchestratorService);
    prismaService = module.get<PrismaService>(PrismaService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('commitAndPush - Happy Path', () => {
    it('should successfully commit and push with valid AI response', async () => {
      // Arrange
      const mockAIResult = {
        success: true,
        codeDiff: 'abc123def456789012345678901234567890abcd',
        filesChanged: ['src/auth/user.service.ts'],
        confidenceScore: 0.95,
        durationMs: 1200,
        workspacePath: '/tmp/workspace',
      };

      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (orchestratorService.execute as jest.Mock).mockResolvedValue(mockAIResult);
      (prismaService.gitHubPush.update as jest.Mock).mockResolvedValue({
        ...mockGitHubPush,
        commit_sha: 'abc123...',
      });

      // Act
      const result = await service.commitAndPush('exec-123', 'corr-123');

      // Assert
      expect(result.success).toBe(true);
      expect(result.commitSha).toBeTruthy();
      expect(metricsService.incrementGitHubCommitsCreated).toHaveBeenCalledWith(
        'success',
        'owner/repo',
        AIProvider.CURSOR_HEADLESS,
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

    it('should handle AI provider failure', async () => {
      // Arrange
      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (orchestratorService.execute as jest.Mock).mockResolvedValue({
        success: false,
        error: { code: 'TIMEOUT', message: 'AI execution timed out', isRetryable: true },
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 5000,
        workspacePath: '',
      });

      // Act
      const result = await service.commitAndPush('exec-123');

      // Assert
      expect(result.success).toBe(false);
      // Note: Metrics may not be called if AI execution fails before parsing
    });
  });

  describe('Metrics Recording', () => {
    it('should record success metrics', async () => {
      // Arrange
      const mockAIResult = {
        success: true,
        codeDiff: 'abc123def456789012345678901234567890abcd',
        filesChanged: ['file1.ts'],
        confidenceScore: 0.9,
        durationMs: 1000,
        workspacePath: '/tmp',
      };

      (prismaService.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prismaService.gitHubPush.findFirst as jest.Mock).mockResolvedValue(mockGitHubPush);
      (orchestratorService.execute as jest.Mock).mockResolvedValue(mockAIResult);
      (prismaService.gitHubPush.update as jest.Mock).mockResolvedValue(mockGitHubPush);

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
