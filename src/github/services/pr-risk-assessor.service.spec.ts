import { Test, TestingModule } from '@nestjs/testing';
import { PRRiskLevel } from '@/prisma/client';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubService } from '../github.service';

describe('PRRiskAssessorService', () => {
  it('defaults PR risk to manual review without ai-routing', async () => {
    const prisma = {
      execution: {
        findUnique: jest.fn().mockResolvedValue({ id: 'exec-1', ticket: { id: 'ticket-1' } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const github = { getPullRequestDiff: jest.fn().mockResolvedValue('diff') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PRRiskAssessorService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MetricsService, useValue: { incrementCounter: jest.fn() } },
        { provide: AIDecisionLoggerService, useValue: { logDecision: jest.fn() } },
        { provide: GitHubService, useValue: github },
      ],
    }).compile();

    const result = await module.get(PRRiskAssessorService).assess('exec-1', 'org/repo', 42);

    expect(result.riskLevel).toBe(PRRiskLevel.MEDIUM);
    expect(result.mergeRecommendation).toContain('Manual review');
    expect(prisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { risk_level: PRRiskLevel.MEDIUM },
    });
  });
});
