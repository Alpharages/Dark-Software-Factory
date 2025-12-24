import { Test, TestingModule } from '@nestjs/testing';
import { BranchStrategistService } from './branch-strategist.service';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { BranchSelectionStrategy } from './branch-strategist.service';

describe('BranchStrategistService', () => {
  let service: BranchStrategistService;

  const mockPrisma = {
    gitHubPush: {
      findFirst: jest.fn(),
    },
    execution: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    ticket: {
      findUnique: jest.fn(),
    },
  };

  const mockMetrics = {
    incrementCounter: jest.fn(),
  };

  const mockLogger = {
    logDecision: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchStrategistService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: AIDecisionLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<BranchStrategistService>(BranchStrategistService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectBaseBranch', () => {
    const ticketId = 'ticket-123';
    const defaultBranch = 'main';

    beforeEach(() => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: ticketId,
        project: { default_branch: defaultBranch },
      });
    });

    it('should select main branch when there are no dependencies (AC#1)', async () => {
      const result = await service.selectBaseBranch(ticketId, []);

      expect(result.selectedBranch).toBe('main');
      expect(result.strategy).toBe(BranchSelectionStrategy.MAIN);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('branch_selection_total', {
        strategy: 'main',
      });
      expect(mockLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId,
          outputData: expect.objectContaining({ strategy: 'main' }),
        }),
      );
    });

    it('should select dependency feature branch when there is a single dependency (AC#2)', async () => {
      const depId = 'dep-1';
      const execId = 'exec-dep-1';
      const branchName = 'feature/dep-1';

      mockPrisma.execution.findMany.mockResolvedValue([{ id: execId }]);
      mockPrisma.gitHubPush.findFirst.mockResolvedValue({ branch_name: branchName });

      const result = await service.selectBaseBranch(ticketId, [depId]);

      expect(result.selectedBranch).toBe(branchName);
      expect(result.strategy).toBe(BranchSelectionStrategy.FOLLOW);
      expect(mockPrisma.execution.findMany).toHaveBeenCalledWith({
        where: { ticket_id: depId },
        select: { id: true },
      });
      expect(mockPrisma.gitHubPush.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            execution_id: { in: [execId] },
          }),
        }),
      );
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('branch_selection_total', {
        strategy: 'follow',
      });
      expect(mockLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId,
          outputData: expect.objectContaining({ strategy: 'follow', selectedBranch: branchName }),
        }),
      );
    });

    it('should fall back to project default branch if single dependency has no branch (AC#2 fallback)', async () => {
      const depId = 'dep-1';

      mockPrisma.gitHubPush.findFirst.mockResolvedValue(null);
      mockPrisma.execution.findFirst.mockResolvedValue({ id: 'exec-123' });

      const result = await service.selectBaseBranch(ticketId, [depId]);

      expect(result.selectedBranch).toBe(defaultBranch);
      expect(result.strategy).toBe(BranchSelectionStrategy.MAIN);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('branch_selection_total', {
        strategy: BranchSelectionStrategy.MAIN,
      });
    });

    it('should use custom default branch from project', async () => {
      const customBranch = 'develop';
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: ticketId,
        project: { default_branch: customBranch },
      });

      const result = await service.selectBaseBranch(ticketId, []);

      expect(result.selectedBranch).toBe(customBranch);
      expect(mockLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: expect.stringContaining(customBranch),
        }),
      );
    });

    it('should select main branch with merge strategy when there are multiple dependencies (AC#3)', async () => {
      const depIds = ['dep-1', 'dep-2'];

      const result = await service.selectBaseBranch(ticketId, depIds);

      expect(result.selectedBranch).toBe('main');
      expect(result.strategy).toBe(BranchSelectionStrategy.MERGE_MAIN);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('branch_selection_total', {
        strategy: 'merge-main',
      });
      expect(mockLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId,
          outputData: expect.objectContaining({ strategy: 'merge-main' }),
          inputData: expect.objectContaining({ dependencyCount: 2 }),
        }),
      );
    });

    it('should NOT update execution record directly (prevents race condition)', async () => {
      const execId = 'exec-123';
      mockPrisma.execution.findFirst.mockResolvedValue({ id: execId });

      await service.selectBaseBranch(ticketId, []);

      expect(mockPrisma.execution.update).not.toHaveBeenCalled();
    });
  });
});
