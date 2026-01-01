import { Test, TestingModule } from '@nestjs/testing';
import { AiCapabilityService } from './ai-capability.service';
import { PrismaService } from '../../database/prisma.service';
import { TaskType } from '@/prisma/client';

describe('AiCapabilityService', () => {
  let service: AiCapabilityService;
  let _prisma: PrismaService;

  const mockPrismaService = {
    aiCapability: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiCapabilityService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<AiCapabilityService>(AiCapabilityService);
    _prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('trackExecutionResult', () => {
    it('should increment success_count when execution succeeds', async () => {
      await service.trackExecutionResult(TaskType.CODE_GENERATION, true);

      expect(mockPrismaService.aiCapability.upsert).toHaveBeenCalledWith({
        where: { task_type: TaskType.CODE_GENERATION },
        create: {
          task_type: TaskType.CODE_GENERATION,
          success_count: 1,
          failure_count: 0,
        },
        update: {
          success_count: { increment: 1 },
          failure_count: undefined,
          updated_at: expect.any(Date),
        },
      });
    });

    it('should increment failure_count when execution fails', async () => {
      await service.trackExecutionResult(TaskType.TEST_GENERATION, false, 'Mock error details');

      expect(mockPrismaService.aiCapability.upsert).toHaveBeenCalledWith({
        where: { task_type: TaskType.TEST_GENERATION },
        create: {
          task_type: TaskType.TEST_GENERATION,
          success_count: 0,
          failure_count: 1,
        },
        update: {
          success_count: undefined,
          failure_count: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should not throw if tracking fails', async () => {
      mockPrismaService.aiCapability.upsert.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.trackExecutionResult(TaskType.REFACTORING, true)).resolves.not.toThrow();
    });
  });

  describe('getCapabilityMetrics', () => {
    it('should return metrics for all task types', async () => {
      mockPrismaService.aiCapability.findMany.mockResolvedValueOnce([
        {
          task_type: TaskType.CODE_GENERATION,
          success_count: 8,
          failure_count: 2,
          known_issues: null,
          workaround: null,
          is_disabled: false,
        },
        {
          task_type: TaskType.TEST_GENERATION,
          success_count: 3,
          failure_count: 7,
          known_issues: 'Struggles with complex mocking',
          workaround: 'Manual test creation recommended',
          is_disabled: false,
        },
      ]);

      const metrics = await service.getCapabilityMetrics();

      expect(metrics).toEqual([
        {
          taskType: TaskType.CODE_GENERATION,
          successCount: 8,
          failureCount: 2,
          totalExecutions: 10,
          successRate: 80,
          isDisabled: false,
        },
        {
          taskType: TaskType.TEST_GENERATION,
          successCount: 3,
          failureCount: 7,
          totalExecutions: 10,
          successRate: 30,
          knownIssues: 'Struggles with complex mocking',
          workaround: 'Manual test creation recommended',
          isDisabled: false,
        },
      ]);
    });

    it('should return metrics for specific task type', async () => {
      mockPrismaService.aiCapability.findMany.mockResolvedValueOnce([
        {
          task_type: TaskType.BUG_FIX,
          success_count: 5,
          failure_count: 5,
          known_issues: null,
          workaround: null,
          is_disabled: false,
        },
      ]);

      const metrics = await service.getCapabilityMetrics(TaskType.BUG_FIX);

      expect(mockPrismaService.aiCapability.findMany).toHaveBeenCalledWith({
        where: { task_type: TaskType.BUG_FIX },
        orderBy: { task_type: 'asc' },
      });
      expect(metrics[0].taskType).toBe(TaskType.BUG_FIX);
      expect(metrics[0].successRate).toBe(50);
    });

    it('should handle zero executions', async () => {
      mockPrismaService.aiCapability.findMany.mockResolvedValueOnce([
        {
          task_type: TaskType.DOCUMENTATION,
          success_count: 0,
          failure_count: 0,
          known_issues: null,
          workaround: null,
          is_disabled: false,
        },
      ]);

      const metrics = await service.getCapabilityMetrics(TaskType.DOCUMENTATION);

      expect(metrics[0].successRate).toBe(0);
      expect(metrics[0].totalExecutions).toBe(0);
    });
  });

  describe('getLimitations', () => {
    it('should return limitations for a task type', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce({
        known_issues: 'Complex async operations fail',
        workaround: 'Use manual review for async code',
        is_disabled: false,
      });

      const limitations = await service.getLimitations(TaskType.CODE_GENERATION);

      expect(limitations).toEqual({
        knownIssues: 'Complex async operations fail',
        workaround: 'Use manual review for async code',
      });
    });

    it('should return null if task is disabled', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce({
        known_issues: 'Always fails',
        workaround: 'Do not use AI',
        is_disabled: true,
      });

      const limitations = await service.getLimitations(TaskType.REFACTORING);

      expect(limitations).toBeNull();
    });

    it('should return null if no record exists', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce(null);

      const limitations = await service.getLimitations(TaskType.ARCHITECTURE_REVIEW);

      expect(limitations).toBeNull();
    });

    it('should return null on error', async () => {
      mockPrismaService.aiCapability.findUnique.mockRejectedValueOnce(new Error('DB error'));

      const limitations = await service.getLimitations(TaskType.BUG_FIX);

      expect(limitations).toBeNull();
    });
  });

  describe('updateLimitations', () => {
    it('should update known issues and workarounds', async () => {
      await service.updateLimitations(
        TaskType.TEST_GENERATION,
        'Known issue description',
        'Workaround steps',
        false,
      );

      expect(mockPrismaService.aiCapability.upsert).toHaveBeenCalledWith({
        where: { task_type: TaskType.TEST_GENERATION },
        create: {
          task_type: TaskType.TEST_GENERATION,
          known_issues: 'Known issue description',
          workaround: 'Workaround steps',
          is_disabled: false,
        },
        update: {
          known_issues: 'Known issue description',
          workaround: 'Workaround steps',
          is_disabled: false,
          updated_at: expect.any(Date),
        },
      });
    });

    it('should allow disabling a task type', async () => {
      await service.updateLimitations(TaskType.REFACTORING, 'Always fails', 'Do not use AI', true);

      expect(mockPrismaService.aiCapability.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            is_disabled: true,
          }),
        }),
      );
    });
  });

  describe('isTaskDisabled', () => {
    it('should return true if task is disabled', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce({
        is_disabled: true,
      });

      const isDisabled = await service.isTaskDisabled(TaskType.BUG_FIX);

      expect(isDisabled).toBe(true);
    });

    it('should return false if task is not disabled', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce({
        is_disabled: false,
      });

      const isDisabled = await service.isTaskDisabled(TaskType.CODE_GENERATION);

      expect(isDisabled).toBe(false);
    });

    it('should return false if no record exists (fail open)', async () => {
      mockPrismaService.aiCapability.findUnique.mockResolvedValueOnce(null);

      const isDisabled = await service.isTaskDisabled(TaskType.DOCUMENTATION);

      expect(isDisabled).toBe(false);
    });

    it('should return false on error (fail open)', async () => {
      mockPrismaService.aiCapability.findUnique.mockRejectedValueOnce(new Error('DB error'));

      const isDisabled = await service.isTaskDisabled(TaskType.ARCHITECTURE_REVIEW);

      expect(isDisabled).toBe(false);
    });
  });
});
