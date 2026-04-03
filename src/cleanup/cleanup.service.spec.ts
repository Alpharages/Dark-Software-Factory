import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, Gauge } from 'prom-client';
import { CleanupService } from './cleanup.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { ExecutionStatus, Execution, AIProvider } from '@/prisma/client';

describe('CleanupService', () => {
  let service: CleanupService;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;
  let configService: jest.Mocked<ConfigService>;

  const mockExecution: Execution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CLAUDE_CODE,
    prompt: 'test prompt',
    status: ExecutionStatus.COMPLETED,
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
    qa_failed_branch: null,
    branch_selection_log: null,
    file_modifications: null,
    risk_level: null,
    circular_dep_detected: false,
    selected_model: null,
    task_type: null,
    created_at: new Date(),
    updated_at: new Date(),
    // Story 23.2 fields
    container_id: 'container-abc123',
    debug_mode: false,
    progress: null,
    qa_attempts: null, // WR-6.1
  };

  const mockMetricHistogram = {
    observe: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Histogram<string>>;

  const mockMetricCounter = {
    inc: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Counter<string>>;

  const mockMetricGauge = {
    set: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Gauge<string>>;

  beforeEach(async () => {
    const mockExecutionTracker = {
      getExecution: jest.fn().mockResolvedValue(mockExecution),
      assignContainer: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'ENABLE_AUTO_CLEANUP') return true;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupService,
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'PROM_METRIC_CLEANUP_DURATION_SECONDS', useValue: mockMetricHistogram },
        { provide: 'PROM_METRIC_CLEANUP_CONTAINERS_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_BYTES_RECLAIMED_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_FAILURES_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_ORPHANED_RESOURCES', useValue: mockMetricGauge },
      ],
    }).compile();

    service = module.get<CleanupService>(CleanupService);
    executionTracker = module.get(ExecutionTrackerService);
    configService = module.get(ConfigService);
  });

  describe('cleanupAfterExecution', () => {
    it('should report successful cleanup (no-op)', async () => {
      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.executionId).toBe('exec-123');
      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(executionTracker.assignContainer).toHaveBeenCalledWith('exec-123', '');
    });

    it('should skip cleanup when auto-cleanup is disabled', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(false);

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(false);
      expect(result.workspaceCleaned).toBe(false);
    });

    it('should report success even in debug_mode', async () => {
      executionTracker.getExecution.mockResolvedValue({
        ...mockExecution,
        debug_mode: true,
      });

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(true);
    });

    // DooD Elimination: removeContainer is now a no-op

    it('should handle execution not found gracefully', async () => {
      executionTracker.getExecution.mockResolvedValue(null);

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.executionId).toBe('exec-123');
      expect(result.containerRemoved).toBe(false);
      expect(result.workspaceCleaned).toBe(false);
    });

    it('should report successful no-op cleanup regardless of prior state', async () => {
      // In DooD, the no-op cleanup always reports success unless execution not found
      const result = await service.cleanupAfterExecution('exec-123');
      expect(result.containerRemoved).toBe(true);
    });

    it('should report successful no-op cleanup when forceContainerRemove is true', async () => {
      const result = await service.cleanupAfterExecution('exec-123', {
        forceContainerRemove: true,
      });
      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing container_id gracefully', async () => {
      executionTracker.getExecution.mockResolvedValue({
        ...mockExecution,
        container_id: null,
      });

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(true);
    });
  });

  describe('removeContainer', () => {
    it('should return without throwing (no-op)', async () => {
      await expect(service.removeContainer('container-123')).resolves.toBeUndefined();
    });
  });

  describe('cleanupWorkspaceFolder', () => {
    it('should return 0 (no-op)', async () => {
      const result = await service.cleanupWorkspaceFolder('exec-123');
      expect(result).toBe(0);
    });
  });
});
