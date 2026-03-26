import { Test, TestingModule } from '@nestjs/testing';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { PromptGeneratorService } from '@/ai-routing/prompt-generator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubService } from '../github.service';

describe('PRRiskAssessorService', () => {
  let service: PRRiskAssessorService;
  let prisma: jest.Mocked<PrismaService>;
  let aiExecution: jest.Mocked<AIExecutionService>;
  let github: jest.Mocked<GitHubService>;

  const mockExecution = {
    id: 'exec-123',
    ai_provider: 'CURSOR_HEADLESS',
    ticket: {
      id: 'ticket-123',
      clickup_task_id: 'DSF-123',
      title: 'Fix bug',
      description: 'Important bug fix',
      context_documents: [],
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PRRiskAssessorService,
        {
          provide: PrismaService,
          useValue: {
            execution: {
              findUnique: jest.fn().mockResolvedValue(mockExecution),
              update: jest.fn().mockResolvedValue({}),
            },
            workspace: {
              findUnique: jest.fn().mockResolvedValue({ workspace_path: '/tmp/workspace' }),
            },
          },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { incrementCounter: jest.fn() },
        },
        {
          provide: AIExecutionService,
          useValue: {
            getProvider: jest.fn().mockImplementation((provider) => {
              if (provider === 'CURSOR_HEADLESS') {
                const mockProvider = {
                  executePrompt: jest.fn().mockResolvedValue({
                    success: true,
                    response: JSON.stringify({
                      riskLevel: 'MEDIUM',
                      reasoning: 'Standard changes',
                      mergeRecommendation: 'PROCEED',
                    }),
                  }),
                };
                return mockProvider;
              }
              return undefined;
            }),
          },
        },
        {
          provide: PromptGeneratorService,
          useValue: {
            generatePrompt: jest.fn(),
            generateRiskAssessmentPrompt: jest.fn().mockReturnValue('mock prompt'),
          },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: { logDecision: jest.fn() },
        },
        {
          provide: GitHubService,
          useValue: {
            getPullRequestDiff: jest.fn().mockResolvedValue('diff content'),
          },
        },
        // WorkspaceService removed (handled by OpenSandbox TTL)
      ],
    }).compile();

    service = module.get<PRRiskAssessorService>(PRRiskAssessorService);
    prisma = module.get(PrismaService);
    aiExecution = module.get(AIExecutionService);
    github = module.get(GitHubService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assess', () => {
    it('should assess risk successfully', async () => {
      const result = await service.assess('exec-123', 'org/repo', 42);

      expect(result.riskLevel).toBe('MEDIUM');
      expect(github.getPullRequestDiff).toHaveBeenCalledWith('org/repo', 42);
      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: { risk_level: 'MEDIUM' },
      });
    });

    it('should handle AI failure', async () => {
      const mockFailingProvider = {
        executePrompt: jest.fn().mockResolvedValue({
          success: false,
          error: 'AI is sleep',
        }),
      };
      (aiExecution.getProvider as jest.Mock).mockReturnValue(mockFailingProvider);

      await expect(service.assess('exec-123', 'org/repo', 42)).rejects.toThrow(
        'AI provider failed: "AI is sleep"',
      );
    });

    it('should handle missing execution', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.assess('exec-123', 'org/repo', 42)).rejects.toThrow(
        'Execution exec-123 not found',
      );
    });

    it('should retry getPullRequestDiff when GitHub returns Not Found (404 propagation lag)', async () => {
      // First call throws Not Found, second call succeeds
      (github.getPullRequestDiff as jest.Mock)
        .mockRejectedValueOnce(new Error('Not Found - https://docs.github.com/rest'))
        .mockResolvedValueOnce('diff content');

      // Use fake timers so the 1 s delay completes instantly
      jest.useFakeTimers();
      const assessPromise = service.assess('exec-123', 'org/repo', 42);
      // Advance past the 1000 ms back-off
      await jest.runAllTimersAsync();
      const result = await assessPromise;
      jest.useRealTimers();

      expect(result.riskLevel).toBe('MEDIUM');
      // getPullRequestDiff was called twice (once failed, once succeeded)
      expect(github.getPullRequestDiff).toHaveBeenCalledTimes(2);
    });
  });
});
