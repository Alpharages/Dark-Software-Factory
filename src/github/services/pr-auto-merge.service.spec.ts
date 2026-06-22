import { Test, TestingModule } from '@nestjs/testing';
import { PRAutoMergeService } from './pr-auto-merge.service';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../github.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { ApprovalGateService } from '@/approval-gate/approval-gate.service';
import { PRRiskLevel } from '@/prisma/client';

describe('PRAutoMergeService', () => {
  let service: PRAutoMergeService;
  let configService: ConfigService;
  let githubService: GitHubService;
  let prismaService: PrismaService;
  let aiDecisionLogger: AIDecisionLoggerService;
  let approvalGate: ApprovalGateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PRAutoMergeService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: GitHubService,
          useValue: {
            getPullRequest: jest.fn(),
            mergePullRequest: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            execution: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: { logDecision: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { incrementCounter: jest.fn() },
        },
        {
          provide: ApprovalGateService,
          useValue: { assertApproved: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PRAutoMergeService>(PRAutoMergeService);
    configService = module.get<ConfigService>(ConfigService);
    githubService = module.get<GitHubService>(GitHubService);
    prismaService = module.get<PrismaService>(PrismaService);
    aiDecisionLogger = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
    approvalGate = module.get<ApprovalGateService>(ApprovalGateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return false if auto-merge is disabled', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(false);
    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);
    expect(result).toBe(false);
    expect(githubService.mergePullRequest).not.toHaveBeenCalled();
  });

  it('should return false if risk level is not LOW', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (prismaService.execution.findUnique as jest.Mock).mockResolvedValue({
      risk_level: PRRiskLevel.MEDIUM,
    });

    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);
    expect(result).toBe(false);
    expect(githubService.mergePullRequest).not.toHaveBeenCalled();
  });

  it('should auto-merge if risk level is LOW and auto-merge is enabled', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (prismaService.execution.findUnique as jest.Mock).mockResolvedValue({
      risk_level: PRRiskLevel.LOW,
      ticket_id: 'ticket-1',
    });
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      mergeable: true,
    });
    (githubService.mergePullRequest as jest.Mock).mockResolvedValue({
      sha: 'merge-sha',
      merged: true,
      message: 'Merged!',
    });

    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);

    expect(result).toBe(true);
    expect(approvalGate.assertApproved).toHaveBeenCalledWith('exec-1');
    expect(githubService.mergePullRequest).toHaveBeenCalledWith(
      'owner',
      'repo',
      1,
      'squash',
      'exec-1',
    );
    expect(aiDecisionLogger.logDecision).toHaveBeenCalled();
  });

  it('should refuse auto-merge without recorded approval', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (prismaService.execution.findUnique as jest.Mock).mockResolvedValue({
      risk_level: PRRiskLevel.LOW,
      ticket_id: 'ticket-1',
    });
    (approvalGate.assertApproved as jest.Mock).mockRejectedValue(new Error('not approved'));

    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);

    expect(result).toBe(false);
    expect(githubService.mergePullRequest).not.toHaveBeenCalled();
  });

  it('should retry once and return false if mergeability stays null', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (prismaService.execution.findUnique as jest.Mock).mockResolvedValue({
      risk_level: PRRiskLevel.LOW,
    });
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      mergeable: null,
    });

    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);

    expect(result).toBe(false);
    expect(githubService.getPullRequest).toHaveBeenCalledTimes(2);
    expect(githubService.mergePullRequest).not.toHaveBeenCalled();
  });

  it('should return false if PR has conflicts', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(true);
    (prismaService.execution.findUnique as jest.Mock).mockResolvedValue({
      risk_level: PRRiskLevel.LOW,
    });
    (githubService.getPullRequest as jest.Mock).mockResolvedValue({
      state: 'open',
      mergeable: false,
    });

    const result = await service.attemptAutoMerge('exec-1', 'owner/repo', 1);

    expect(result).toBe(false);
    expect(githubService.mergePullRequest).not.toHaveBeenCalled();
  });
});
