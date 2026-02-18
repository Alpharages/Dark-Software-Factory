import { Test, TestingModule } from '@nestjs/testing';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { PromptGeneratorService } from '@/ai-routing/prompt-generator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubService } from '../github.service';
import { WorkspaceService } from '@/ai-routing/providers';

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
        {
          provide: WorkspaceService,
          useValue: {
            getWorkspace: jest.fn().mockResolvedValue({ path: '/tmp/workspace' }),
          },
        },
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
  });
});
