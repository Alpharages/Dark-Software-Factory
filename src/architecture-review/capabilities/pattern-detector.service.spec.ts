import { Test, TestingModule } from '@nestjs/testing';
import { PatternDetectorService } from './pattern-detector.service';
import { PrismaService } from '../../database/prisma.service';
import { AiCapabilityService } from './ai-capability.service';
import { ArchitectureReviewNotificationService } from '../architecture-review-notification.service';
import { TaskType, ExecutionStatus } from '@/prisma/client';

describe('PatternDetectorService', () => {
  let service: PatternDetectorService;
  let _prisma: PrismaService;
  let _capabilityService: AiCapabilityService;
  let _notificationService: ArchitectureReviewNotificationService;

  const mockPrismaService = {
    execution: {
      findMany: jest.fn(),
    },
    aiTaskPattern: {
      upsert: jest.fn(),
    },
  };

  const mockCapabilityService = {
    updateLimitations: jest.fn(),
  };

  const mockNotificationService = {
    notifyHighPriorityReview: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternDetectorService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AiCapabilityService, useValue: mockCapabilityService },
        {
          provide: ArchitectureReviewNotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<PatternDetectorService>(PatternDetectorService);
    _prisma = module.get<PrismaService>(PrismaService);
    _capabilityService = module.get<AiCapabilityService>(AiCapabilityService);
    _notificationService = module.get<ArchitectureReviewNotificationService>(
      ArchitectureReviewNotificationService,
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeTaskType', () => {
    it('should return null if no executions exist', async () => {
      mockPrismaService.execution.findMany.mockResolvedValueOnce([]);

      const pattern = await service.analyzeTaskType(TaskType.CODE_GENERATION);

      expect(pattern).toBeNull();
    });

    it('should return null if failure rate is below warning threshold', async () => {
      // 2 failures out of 10 = 20% (below 40% threshold)
      mockPrismaService.execution.findMany.mockResolvedValueOnce([
        { id: '1', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '2', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '3', status: ExecutionStatus.FAILED, error_message: 'Error 1' },
        { id: '4', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '5', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '6', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '7', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '8', status: ExecutionStatus.FAILED, error_message: 'Error 2' },
        { id: '9', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '10', status: ExecutionStatus.COMPLETED, error_message: null },
      ]);

      const pattern = await service.analyzeTaskType(TaskType.TEST_GENERATION);

      expect(pattern).toBeNull();
    });

    it('should detect pattern with failure rate above warning threshold', async () => {
      // 5 failures out of 10 = 50% (above 40% threshold)
      mockPrismaService.execution.findMany.mockResolvedValueOnce([
        {
          id: '1',
          status: ExecutionStatus.FAILED,
          error_message: 'timeout error occurred',
        },
        {
          id: '2',
          status: ExecutionStatus.FAILED,
          error_message: 'timeout error occurred',
        },
        {
          id: '3',
          status: ExecutionStatus.FAILED,
          error_message: 'timeout error occurred',
        },
        { id: '4', status: ExecutionStatus.COMPLETED, error_message: null },
        {
          id: '5',
          status: ExecutionStatus.FAILED,
          error_message: 'timeout error occurred',
        },
        { id: '6', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '7', status: ExecutionStatus.COMPLETED, error_message: null },
        {
          id: '8',
          status: ExecutionStatus.FAILED,
          error_message: 'timeout error occurred',
        },
        { id: '9', status: ExecutionStatus.COMPLETED, error_message: null },
        { id: '10', status: ExecutionStatus.COMPLETED, error_message: null },
      ]);

      const pattern = await service.analyzeTaskType(TaskType.REFACTORING);

      expect(pattern).toEqual({
        taskType: TaskType.REFACTORING,
        failureRate: 50,
        executionsSampled: 10,
        patternSignature: expect.stringContaining('error'),
        exampleIds: ['1', '2', '3', '5', '8'],
      });
    });

    it('should handle errors gracefully', async () => {
      mockPrismaService.execution.findMany.mockRejectedValueOnce(new Error('DB error'));

      const pattern = await service.analyzeTaskType(TaskType.BUG_FIX);

      expect(pattern).toBeNull();
    });
  });

  describe('triggerAnalysis', () => {
    it('should analyze all task types', async () => {
      // Mock some task types with patterns, others without
      mockPrismaService.execution.findMany.mockImplementation(({ where }) => {
        if (where.task_type === TaskType.CODE_GENERATION) {
          // No pattern (20% failure)
          return Promise.resolve([
            { id: '1', status: ExecutionStatus.COMPLETED, error_message: null },
            { id: '2', status: ExecutionStatus.FAILED, error_message: 'Error' },
            { id: '3', status: ExecutionStatus.COMPLETED, error_message: null },
            { id: '4', status: ExecutionStatus.COMPLETED, error_message: null },
            { id: '5', status: ExecutionStatus.COMPLETED, error_message: null },
          ]);
        } else if (where.task_type === TaskType.TEST_GENERATION) {
          // Pattern detected (60% failure)
          return Promise.resolve([
            {
              id: '6',
              status: ExecutionStatus.FAILED,
              error_message: 'Mock error',
            },
            {
              id: '7',
              status: ExecutionStatus.FAILED,
              error_message: 'Mock error',
            },
            { id: '8', status: ExecutionStatus.COMPLETED, error_message: null },
            {
              id: '9',
              status: ExecutionStatus.FAILED,
              error_message: 'Mock error',
            },
            { id: '10', status: ExecutionStatus.COMPLETED, error_message: null },
          ]);
        } else {
          return Promise.resolve([]);
        }
      });

      const patterns = await service.triggerAnalysis();

      expect(patterns.length).toBe(1);
      expect(patterns[0].taskType).toBe(TaskType.TEST_GENERATION);
      expect(patterns[0].failureRate).toBe(60);
    });
  });

  describe('analyzeExecutionPatterns (cron job)', () => {
    it('should analyze all task types and handle detected patterns', async () => {
      // Mock execution data for pattern detection
      mockPrismaService.execution.findMany.mockImplementation(({ where }) => {
        if (where.task_type === TaskType.CODE_GENERATION) {
          // High failure rate (80%) - should trigger critical action
          return Promise.resolve(
            Array(10)
              .fill(null)
              .map((_, i) => ({
                id: `exec-${i}`,
                status: i < 8 ? ExecutionStatus.FAILED : ExecutionStatus.COMPLETED,
                error_message: i < 8 ? 'Critical failure' : null,
              })),
          );
        }
        return Promise.resolve([]);
      });

      mockPrismaService.aiTaskPattern.upsert.mockResolvedValueOnce({});
      mockCapabilityService.updateLimitations.mockResolvedValueOnce(undefined);
      mockNotificationService.notifyHighPriorityReview.mockResolvedValueOnce(undefined);

      await service.analyzeExecutionPatterns();

      // Verify pattern was saved
      expect(mockPrismaService.aiTaskPattern.upsert).toHaveBeenCalled();

      // Verify critical action (disable task)
      expect(mockCapabilityService.updateLimitations).toHaveBeenCalledWith(
        TaskType.CODE_GENERATION,
        expect.stringContaining('Critical failure rate'),
        expect.stringContaining('Manual intervention required'),
        true, // isDisabled
      );

      // Verify TL notification
      expect(mockNotificationService.notifyHighPriorityReview).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('CRITICAL'),
          priority: 1,
        }),
      );
    });

    it('should not crash if analysis fails for a task type', async () => {
      mockPrismaService.execution.findMany.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.analyzeExecutionPatterns()).resolves.not.toThrow();
    });
  });
});
