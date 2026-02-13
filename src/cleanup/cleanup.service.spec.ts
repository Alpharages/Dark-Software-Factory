import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, Gauge } from 'prom-client';
import { CleanupService } from './cleanup.service';
import { DockerService } from '@/docker/docker.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { WorkspaceService } from '@/ai-routing/providers/workspace.service';
import { ExecutionStatus, Execution, AIProvider } from '@/prisma/client';

describe('CleanupService', () => {
  let service: CleanupService;
  let dockerService: jest.Mocked<DockerService>;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let configService: jest.Mocked<ConfigService>;

  const mockExecution: Execution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CURSOR_HEADLESS,
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
    const mockDockerService = {
      removeContainer: jest.fn().mockResolvedValue(undefined),
      killContainer: jest.fn().mockResolvedValue(undefined),
    };

    const mockExecutionTracker = {
      getExecution: jest.fn().mockResolvedValue(mockExecution),
      assignContainer: jest.fn().mockResolvedValue(undefined),
    };

    const mockWorkspaceService = {
      getWorkspace: jest.fn().mockResolvedValue({
        id: 'ws-123',
        execution_id: 'exec-123',
        path: '/tmp/workspace/exec-123',
        status: 'READY',
        created_at: new Date(),
        updated_at: new Date(),
      }),
      cleanupWorkspace: jest.fn().mockResolvedValue(undefined),
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
        { provide: DockerService, useValue: mockDockerService },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'PROM_METRIC_CLEANUP_DURATION_SECONDS', useValue: mockMetricHistogram },
        { provide: 'PROM_METRIC_CLEANUP_CONTAINERS_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_BYTES_RECLAIMED_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_FAILURES_TOTAL', useValue: mockMetricCounter },
        { provide: 'PROM_METRIC_CLEANUP_ORPHANED_RESOURCES', useValue: mockMetricGauge },
      ],
    }).compile();

    service = module.get<CleanupService>(CleanupService);
    dockerService = module.get(DockerService);
    executionTracker = module.get(ExecutionTrackerService);
    workspaceService = module.get(WorkspaceService);
    configService = module.get(ConfigService);
  });

  describe('cleanupAfterExecution', () => {
    it('should cleanup container and workspace successfully', async () => {
      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.executionId).toBe('exec-123');
      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(dockerService.removeContainer).toHaveBeenCalledWith('container-abc123', false);
      expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith('exec-123', true);
    });

    it('should skip cleanup when auto-cleanup is disabled', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(false);

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(false);
      expect(result.workspaceCleaned).toBe(false);
      expect(dockerService.removeContainer).not.toHaveBeenCalled();
    });

    it('should preserve workspace when debug_mode is true', async () => {
      executionTracker.getExecution.mockResolvedValue({
        ...mockExecution,
        debug_mode: true,
      });

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(true);
      expect(result.workspaceCleaned).toBe(false); // Preserved
      expect(workspaceService.cleanupWorkspace).not.toHaveBeenCalled();
    });

    it('should force kill container when force option is true', async () => {
      await service.cleanupAfterExecution('exec-123', { forceContainerRemove: true });

      expect(dockerService.killContainer).toHaveBeenCalledWith('container-abc123', 'SIGKILL');
      expect(dockerService.removeContainer).toHaveBeenCalledWith('container-abc123', true);
    });

    it('should handle execution not found gracefully', async () => {
      executionTracker.getExecution.mockResolvedValue(null);

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.executionId).toBe('exec-123');
      expect(result.containerRemoved).toBe(false);
      expect(result.workspaceCleaned).toBe(false);
    });

    it('should handle container removal failure gracefully', async () => {
      dockerService.removeContainer.mockRejectedValue(new Error('Container not found'));

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('container');
      // Workspace should still be cleaned
      expect(result.workspaceCleaned).toBe(true);
    });

    it('should handle missing container_id gracefully', async () => {
      executionTracker.getExecution.mockResolvedValue({
        ...mockExecution,
        container_id: null,
      });

      const result = await service.cleanupAfterExecution('exec-123');

      expect(result.containerRemoved).toBe(false);
      expect(result.workspaceCleaned).toBe(true);
      expect(dockerService.removeContainer).not.toHaveBeenCalled();
    });
  });

  describe('removeContainer', () => {
    it('should remove container successfully', async () => {
      await service.removeContainer('container-123', false);

      expect(dockerService.removeContainer).toHaveBeenCalledWith('container-123', false);
    });

    it('should kill and remove when force is true', async () => {
      await service.removeContainer('container-123', true);

      expect(dockerService.killContainer).toHaveBeenCalledWith('container-123', 'SIGKILL');
      expect(dockerService.removeContainer).toHaveBeenCalledWith('container-123', true);
    });

    it('should handle container not found gracefully (idempotent)', async () => {
      const error = new Error('No such container: container-123');
      dockerService.removeContainer.mockRejectedValue(error);

      await expect(service.removeContainer('container-123')).resolves.not.toThrow();
    });
  });

  describe('cleanupWorkspaceFolder', () => {
    it('should return 0 bytes when preserve is true', async () => {
      const bytes = await service.cleanupWorkspaceFolder('exec-123', true);

      expect(bytes).toBe(0);
      expect(workspaceService.cleanupWorkspace).not.toHaveBeenCalled();
    });

    it('should cleanup workspace when preserve is false', async () => {
      await service.cleanupWorkspaceFolder('exec-123', false);

      expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith('exec-123', true);
    });

    it('should return 0 when workspace not found', async () => {
      workspaceService.getWorkspace.mockResolvedValue(undefined);

      const bytes = await service.cleanupWorkspaceFolder('exec-123', false);

      expect(bytes).toBe(0);
      expect(workspaceService.cleanupWorkspace).not.toHaveBeenCalled();
    });
  });
});
