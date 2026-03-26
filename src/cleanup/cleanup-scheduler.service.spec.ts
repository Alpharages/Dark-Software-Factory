import { Test, TestingModule } from '@nestjs/testing';
import { Gauge } from 'prom-client';
import { CleanupSchedulerService } from './cleanup-scheduler.service';
import { CleanupService } from './cleanup.service';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionStatus, Execution, AIProvider } from '@/prisma/client';

describe('CleanupSchedulerService', () => {
  let service: CleanupSchedulerService;
  let cleanupService: jest.Mocked<CleanupService>;

  let _prisma: jest.Mocked<PrismaService>;

  const mockMetricGauge = {
    set: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Gauge<string>>;

  const mockOrphanedExecutions: Execution[] = [
    {
      id: 'exec-1',
      ticket_id: 'ticket-1',
      ai_provider: AIProvider.CLAUDE_CODE,
      prompt: 'test',
      status: ExecutionStatus.COMPLETED,
      container_id: 'container-1',
      debug_mode: false,
      confidence_score: null,
      started_at: new Date(),
      completed_at: new Date(),
      failed_at: null,
      error_message: null,
      code_output: null,
      files_changed: null,
      retry_count: 0,
      max_retries: 3,
      complexity_score: null,
      complexity_breakdown: null,
      routing_reason: null,
      fallback_used: false,
      original_provider: null,
      error_context: null,
      scheduled_retry_at: null,
      base_branch: null,
      branch_selection_log: null,
      file_modifications: null,
      risk_level: null,
      circular_dep_detected: false,
      selected_model: null,
      task_type: null,
      progress: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'exec-2',
      ticket_id: 'ticket-2',
      ai_provider: AIProvider.CLAUDE_CODE,
      prompt: 'test',
      status: ExecutionStatus.TIMEOUT,
      container_id: 'container-2',
      debug_mode: false,
      confidence_score: null,
      started_at: new Date(),
      completed_at: null,
      failed_at: new Date(),
      error_message: 'timeout',
      code_output: null,
      files_changed: null,
      retry_count: 1,
      max_retries: 3,
      complexity_score: null,
      complexity_breakdown: null,
      routing_reason: null,
      fallback_used: false,
      original_provider: null,
      error_context: null,
      scheduled_retry_at: null,
      base_branch: null,
      branch_selection_log: null,
      file_modifications: null,
      risk_level: null,
      circular_dep_detected: false,
      selected_model: null,
      task_type: null,
      progress: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  let findManyMock: jest.Mock;

  beforeEach(async () => {
    findManyMock = jest.fn().mockResolvedValue(mockOrphanedExecutions);

    const mockCleanupService = {
      cleanupAfterExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        containerRemoved: true,
        workspaceCleaned: true,
        bytesReclaimed: 1000,
        durationMs: 100,
        errors: [],
      }),
    };

    const mockPrisma = {
      execution: {
        findMany: findManyMock,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupSchedulerService,
        { provide: CleanupService, useValue: mockCleanupService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'PROM_METRIC_CLEANUP_ORPHANED_RESOURCES', useValue: mockMetricGauge },
      ],
    }).compile();

    service = module.get<CleanupSchedulerService>(CleanupSchedulerService);
    cleanupService = module.get(CleanupService);
    _prisma = module.get(PrismaService);
  });

  describe('cleanupOrphanedResources', () => {
    it('should find and cleanup orphaned executions', async () => {
      await service.cleanupOrphanedResources();

      expect(findManyMock).toHaveBeenCalledWith({
        where: {
          AND: [
            { container_id: { not: null } },
            { container_id: { not: '' } },
            {
              status: {
                in: [
                  ExecutionStatus.COMPLETED,
                  ExecutionStatus.FAILED,
                  ExecutionStatus.TIMEOUT,
                  ExecutionStatus.CANCELLED,
                ],
              },
            },
          ],
        },
        take: 10,
      });
      expect(cleanupService.cleanupAfterExecution).toHaveBeenCalledTimes(2);
    });

    it('should use force=true for timed out executions', async () => {
      await service.cleanupOrphanedResources();

      // Second execution is TIMEOUT, should have force=true
      expect(cleanupService.cleanupAfterExecution).toHaveBeenNthCalledWith(2, 'exec-2', {
        forceContainerRemove: true,
      });
    });

    it('should handle empty orphaned list gracefully', async () => {
      findManyMock.mockResolvedValue([]);

      await service.cleanupOrphanedResources();

      expect(cleanupService.cleanupAfterExecution).not.toHaveBeenCalled();
    });

    it('should continue processing if one cleanup fails', async () => {
      cleanupService.cleanupAfterExecution
        .mockRejectedValueOnce(new Error('Cleanup failed'))
        .mockResolvedValueOnce({
          executionId: 'exec-2',
          containerRemoved: true,
          workspaceCleaned: true,
          bytesReclaimed: 1000,
          durationMs: 100,
          errors: [],
        });

      await service.cleanupOrphanedResources();

      // Should still attempt second cleanup
      expect(cleanupService.cleanupAfterExecution).toHaveBeenCalledTimes(2);
    });

    it('should handle database query failure gracefully', async () => {
      findManyMock.mockRejectedValue(new Error('Database error'));

      await expect(service.cleanupOrphanedResources()).resolves.not.toThrow();
      expect(cleanupService.cleanupAfterExecution).not.toHaveBeenCalled();
    });
  });
});
