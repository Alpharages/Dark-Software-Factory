import { Test, TestingModule } from '@nestjs/testing';
import { AiCodeReviewService } from './ai-code-review.service';
import { PrismaService } from '@/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { OrchestratorService } from '@/ai-routing/orchestrator.service';
import { GitHubService } from '@/github/github.service';
import { QaResultsService } from '../qa-results.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { QA_METRICS } from '@/common/metrics';
import { NotFoundException } from '@nestjs/common';
import { FindingStatus } from '../dto/update-finding-status.dto';

describe('AiCodeReviewService', () => {
  let service: AiCodeReviewService;
  let prisma: any;
  let orchestrator: any;

  const mockPrisma = {
    qaReviewQueue: {
      findUnique: jest.fn(),
    },
    aiCodeReview: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    aiCodeReviewFinding: {
      update: jest.fn(),
    },
    gitHubPush: {
      findFirst: jest.fn(),
    },
  };

  const mockOrchestrator = {
    executeTask: jest.fn(),
  };

  const mockGithub = {
    getPullRequestDiff: jest.fn(),
  };

  const mockQaResults = {
    findByExecutionId: jest.fn(),
  };

  const mockDecisionLogger = {
    logDecision: jest.fn().mockResolvedValue({}),
  };

  const mockCounter = {
    inc: jest.fn(),
  };
  const mockHistogram = {
    observe: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiCodeReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AI_REVIEW_MAX_DIFF_LINES') return 1000;
              if (key === 'AI_CACHE_TTL_SECONDS') return 3600;
              return null;
            }),
          },
        },
        { provide: OrchestratorService, useValue: mockOrchestrator },
        { provide: GitHubService, useValue: mockGithub },
        { provide: QaResultsService, useValue: mockQaResults },
        { provide: AIDecisionLoggerService, useValue: mockDecisionLogger },
        {
          provide: (
            makeCounterProvider({
              name: QA_METRICS.AI_REVIEW_GENERATION_TOTAL,
              help: 'mock',
            }) as any
          ).provide,
          useValue: mockCounter,
        },
        {
          provide: (
            makeHistogramProvider({
              name: QA_METRICS.AI_REVIEW_GENERATION_DURATION,
              help: 'mock',
            }) as any
          ).provide,
          useValue: mockHistogram,
        },
        {
          provide: (
            makeCounterProvider({ name: QA_METRICS.AI_REVIEW_FINDINGS_TOTAL, help: 'mock' }) as any
          ).provide,
          useValue: mockCounter,
        },
        {
          provide: (
            makeCounterProvider({
              name: QA_METRICS.AI_REVIEW_FINDING_STATUS_UPDATES,
              help: 'mock',
            }) as any
          ).provide,
          useValue: mockCounter,
        },
      ],
    }).compile();

    service = module.get<AiCodeReviewService>(AiCodeReviewService);
    prisma = module.get(PrismaService);
    orchestrator = module.get(OrchestratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateReview', () => {
    const queueItemId = 'queue-123';
    const executionId = 'exec-123';

    const mockQueueItem = {
      id: queueItemId,
      execution_id: executionId,
      ticket_id: 'ticket-1',
      pr_url: 'https://github.com/org/repo/pull/1',
      execution: {
        ticket: {
          id: 'ticket-1',
          title: 'Fix Bug',
          acceptance_criteria: 'Must fix bug',
        },
        ai_provider: 'claude_code',
        complexity_score: 5,
      },
    };

    it('should return cached review if available and not forced', async () => {
      prisma.qaReviewQueue.findUnique.mockResolvedValue(mockQueueItem);

      const cachedReview = {
        id: 'review-1',
        overall_assessment: 'LOW_RISK',
        findings: {
          missed_issues: [],
          code_smells: [],
          complex_logic: [],
          testing_gaps: [],
          security_notes: [],
        },
        generated_at: new Date(),
        finding_statuses: [],
      };
      prisma.aiCodeReview.findFirst.mockResolvedValue(cachedReview);

      const result = await service.generateReview(queueItemId, false);

      expect(prisma.aiCodeReview.findFirst).toHaveBeenCalled();
      expect(orchestrator.executeTask).not.toHaveBeenCalled();
      expect(result.overall_assessment).toBe('LOW_RISK');
    });

    it('should generate new review if cache missing', async () => {
      prisma.qaReviewQueue.findUnique.mockResolvedValue(mockQueueItem);
      prisma.aiCodeReview.findFirst.mockResolvedValue(null);

      mockQaResults.findByExecutionId.mockResolvedValue({
        linting_passed: true,
        tests_passed: true,
        test_coverage: 80,
      });

      mockGithub.getPullRequestDiff.mockResolvedValue('diff content');

      mockOrchestrator.executeTask.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          missed_issues: [],
          code_smells: [],
          complex_logic: [],
          testing_gaps: [],
          security_notes: [],
        }),
        metadata: { cost: 10, model: 'claude', provider: 'claude' },
      });

      prisma.aiCodeReview.create.mockResolvedValue({
        id: 'new-review',
        overall_assessment: 'LOW_RISK',
        findings: {
          missed_issues: [],
          code_smells: [],
          complex_logic: [],
          testing_gaps: [],
          security_notes: [],
        },
        generated_at: new Date(),
        finding_statuses: [],
        cost_usd: 0.1,
      });

      const result = await service.generateReview(queueItemId, false);

      expect(orchestrator.executeTask).toHaveBeenCalled();
      expect(prisma.aiCodeReview.create).toHaveBeenCalled();
      expect(result.cost_usd).toBe(0.1);
      expect(result.review_time_estimate).toBeDefined();
      expect(result.review_time_estimate).toMatch(/\d+ minutes|60\+ minutes/);
    });

    it('should throw NotFoundException if queue item missing', async () => {
      prisma.qaReviewQueue.findUnique.mockResolvedValue(null);
      await expect(service.generateReview('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateFindingStatus', () => {
    it('should update finding status and record decision', async () => {
      const findingId = 'finding-1';
      const userId = 'user-1';
      const dto = { status: FindingStatus.FIXED, review_notes: 'Fixed this' };

      prisma.aiCodeReviewFinding.update.mockResolvedValue({
        id: findingId,
        status: FindingStatus.FIXED,
        review_notes: 'Fixed this',
        reviewed_by: userId,
        reviewed_at: new Date(),
      });

      await service.updateFindingStatus(findingId, dto, userId);

      expect(prisma.aiCodeReviewFinding.update).toHaveBeenCalledWith({
        where: { id: findingId },
        data: expect.objectContaining({
          status: FindingStatus.FIXED,
          review_notes: 'Fixed this',
          reviewed_by: userId,
        }),
      });
    });
  });
});
