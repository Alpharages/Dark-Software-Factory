import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { AiCodeReviewService } from './ai-code-review.service';
import { PrismaService } from '@/database/prisma.service';
import { GitHubService } from '@/github/github.service';
import { QaResultsService } from '../qa-results.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { QA_METRICS } from '@/common/metrics';
import { AiCodeReviewRiskLevel } from '../dto/ai-code-review.dto';

describe('AiCodeReviewService', () => {
  it('creates deterministic empty review without ai-routing', async () => {
    const now = new Date();
    const prisma = {
      qaReviewQueue: {
        findUnique: jest.fn().mockResolvedValue({
          execution_id: 'exec-1',
          pr_url: 'https://github.com/org/repo/pull/1',
          execution: {
            ticket: { id: 'ticket-1', title: 'Fix', acceptance_criteria: 'Works' },
            ai_provider: 'CLAUDE_CODE',
            complexity_score: 1,
          },
        }),
      },
      aiCodeReview: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            generated_at: now,
            review_version: 1,
            finding_statuses: [],
          }),
        ),
      },
      aiCodeReviewFinding: { update: jest.fn() },
      gitHubPush: { findFirst: jest.fn() },
    };
    const counter = { inc: jest.fn() };
    const histogram = { observe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiCodeReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(1000) } },
        {
          provide: GitHubService,
          useValue: { getPullRequestDiff: jest.fn().mockResolvedValue('diff') },
        },
        {
          provide: QaResultsService,
          useValue: {
            findByExecutionId: jest
              .fn()
              .mockResolvedValue({ linting_passed: true, tests_passed: true, test_coverage: 90 }),
          },
        },
        { provide: AIDecisionLoggerService, useValue: { logDecision: jest.fn() } },
        {
          provide: (
            makeCounterProvider({
              name: QA_METRICS.AI_REVIEW_GENERATION_TOTAL,
              help: 'mock',
            }) as any
          ).provide,
          useValue: counter,
        },
        {
          provide: (
            makeHistogramProvider({
              name: QA_METRICS.AI_REVIEW_GENERATION_DURATION,
              help: 'mock',
            }) as any
          ).provide,
          useValue: histogram,
        },
        {
          provide: (
            makeCounterProvider({ name: QA_METRICS.AI_REVIEW_FINDINGS_TOTAL, help: 'mock' }) as any
          ).provide,
          useValue: counter,
        },
        {
          provide: (
            makeCounterProvider({
              name: QA_METRICS.AI_REVIEW_FINDING_STATUS_UPDATES,
              help: 'mock',
            }) as any
          ).provide,
          useValue: counter,
        },
      ],
    }).compile();

    const result = await module.get(AiCodeReviewService).generateReview('queue-1', true);

    expect(result.overall_assessment).toBe(AiCodeReviewRiskLevel.LOW_RISK);
    expect(result.ai_model).toBe('openharness');
    expect(result.findings.missed_issues).toEqual([]);
  });
});
