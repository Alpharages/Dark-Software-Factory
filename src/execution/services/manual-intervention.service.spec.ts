import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExecutionStatus, AIProvider } from '@/prisma/client';
import { ManualInterventionService } from './manual-intervention.service';
import { ExecutionRepository } from '../execution.repository';
import { ExecutionTrackerService } from '../execution-tracker.service';
import { ExecutionOverrideRepository } from '../repositories/execution-override.repository';
import { RealtimeService } from '../../realtime/realtime.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { OverrideDecision } from '../dto/override-decision.dto';

// Helper to generate metric tokens
const getMetricToken = (name: string): string => `PROM_METRIC_${name.toUpperCase()}`;

describe('ManualInterventionService', () => {
  let service: ManualInterventionService;
  let executionRepository: jest.Mocked<ExecutionRepository>;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;
  let overrideRepository: jest.Mocked<ExecutionOverrideRepository>;
  let auditLogService: jest.Mocked<AuditLogService>;

  const mockExecution: any = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    status: ExecutionStatus.IN_PROGRESS,
    ai_provider: AIProvider.CLAUDE_CODE,
    container_id: 'container-789',
    prompt: 'test prompt',
    retry_count: 0,
    max_retries: 3,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockPausedExecution: any = {
    ...mockExecution,
    status: ExecutionStatus.PAUSED,
  };

  const mockEmergencyStoppedExecution: any = {
    ...mockExecution,
    status: ExecutionStatus.EMERGENCY_STOPPED,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManualInterventionService,
        {
          provide: ExecutionRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: ExecutionTrackerService,
          useValue: {
            updateStatus: jest.fn(),
          },
        },
        {
          provide: ExecutionOverrideRepository,
          useValue: {
            create: jest.fn(),
            findMostRecentForExecution: jest.fn(),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            emitToRole: jest.fn(),
            emitToProject: jest.fn(),
            emitToUser: jest.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getMetricToken('execution_paused_total'),
          useValue: { inc: jest.fn() },
        },
        {
          provide: getMetricToken('execution_resumed_total'),
          useValue: { inc: jest.fn() },
        },
        {
          provide: getMetricToken('execution_emergency_stopped_total'),
          useValue: { inc: jest.fn() },
        },
        {
          provide: getMetricToken('execution_decision_overridden_total'),
          useValue: { inc: jest.fn() },
        },
        {
          provide: getMetricToken('execution_container_control_failed_total'),
          useValue: { inc: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ManualInterventionService>(ManualInterventionService);
    executionRepository = module.get(ExecutionRepository);
    executionTracker = module.get(ExecutionTrackerService);
    overrideRepository = module.get(ExecutionOverrideRepository);
    auditLogService = module.get(AuditLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pauseExecution', () => {
    it('should pause an IN_PROGRESS execution successfully', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);
      executionTracker.updateStatus.mockResolvedValue(mockPausedExecution);

      const result = await service.pauseExecution('exec-123', 'user-1', 'Investigating issue');

      expect(result.execution.status).toBe(ExecutionStatus.PAUSED);
      expect(result.containerControlSkipped).toBe(true);
      expect(executionTracker.updateStatus).toHaveBeenCalledWith(
        'exec-123',
        ExecutionStatus.PAUSED,
      );
      expect(auditLogService.log).toHaveBeenCalled();
    });

    it('should skip container control if container_id is null', async () => {
      const executionWithoutContainer = { ...mockExecution, container_id: null };
      executionRepository.findById.mockResolvedValue(executionWithoutContainer);
      executionTracker.updateStatus.mockResolvedValue(mockPausedExecution);

      const result = await service.pauseExecution('exec-123', 'user-1', 'Investigating issue');

      expect(result.containerControlSkipped).toBe(true);
    });

    it('should throw BadRequestException if execution not found', async () => {
      executionRepository.findById.mockResolvedValue(null);

      await expect(service.pauseExecution('exec-123', 'user-1', 'reason')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException if execution is in terminal state', async () => {
      executionRepository.findById.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.COMPLETED,
      });

      await expect(service.pauseExecution('exec-123', 'user-1', 'reason')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if execution is already paused', async () => {
      executionRepository.findById.mockResolvedValue(mockPausedExecution);

      await expect(service.pauseExecution('exec-123', 'user-1', 'reason')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('resumeExecution', () => {
    it('should resume a PAUSED execution successfully', async () => {
      executionRepository.findById.mockResolvedValue(mockPausedExecution);
      executionTracker.updateStatus.mockResolvedValue(mockExecution);

      const result = await service.resumeExecution('exec-123', 'user-1', 'Issue resolved');

      expect(result.execution.status).toBe(ExecutionStatus.IN_PROGRESS);
      expect(result.containerControlSkipped).toBe(true);
      expect(executionTracker.updateStatus).toHaveBeenCalledWith(
        'exec-123',
        ExecutionStatus.IN_PROGRESS,
      );
    });

    it('should throw BadRequestException if execution is not in PAUSED state', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);

      await expect(service.resumeExecution('exec-123', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should skip container control if container_id is null', async () => {
      const pausedWithoutContainer = { ...mockPausedExecution, container_id: null };
      executionRepository.findById.mockResolvedValue(pausedWithoutContainer);
      executionTracker.updateStatus.mockResolvedValue(mockExecution);

      const result = await service.resumeExecution('exec-123', 'user-1');

      expect(result.containerControlSkipped).toBe(true);
    });
  });

  describe('emergencyStop', () => {
    it('should emergency stop an execution with kill flag', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);
      executionTracker.updateStatus.mockResolvedValue(mockEmergencyStoppedExecution);

      const result = await service.emergencyStop('exec-123', 'user-1', 'Critical error', true);

      expect(result.execution.status).toBe(ExecutionStatus.EMERGENCY_STOPPED);
      expect(result.containerControlSkipped).toBe(true);
    });

    it('should emergency stop an execution with graceful stop', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);
      executionTracker.updateStatus.mockResolvedValue(mockEmergencyStoppedExecution);

      const result = await service.emergencyStop('exec-123', 'user-1', 'Stop needed', false);

      expect(result.execution.status).toBe(ExecutionStatus.EMERGENCY_STOPPED);
      expect(result.containerControlSkipped).toBe(true);
    });

    it('should skip container control if container_id is null', async () => {
      executionRepository.findById.mockResolvedValue({ ...mockExecution, container_id: null });
      executionTracker.updateStatus.mockResolvedValue(mockEmergencyStoppedExecution);

      const result = await service.emergencyStop('exec-123', 'user-1', 'Stop needed', false);

      expect(result.containerControlSkipped).toBe(true);
      expect(result.containerKilled).toBe(false);
    });

    it('should throw ConflictException if execution is already in terminal state', async () => {
      executionRepository.findById.mockResolvedValue(mockEmergencyStoppedExecution);

      await expect(service.emergencyStop('exec-123', 'user-1', 'reason')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('overrideDecision', () => {
    it('should override a decision successfully', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);
      overrideRepository.findMostRecentForExecution.mockResolvedValue(null);
      overrideRepository.create.mockResolvedValue({
        id: 'override-123',
        executionId: 'exec-123',
        userId: 'user-1',
        originalDecision: 'IN_PROGRESS',
        newDecision: 'APPROVE',
        reason: 'False positive',
      } as any);

      const result = await service.overrideDecision(
        'exec-123',
        'user-1',
        OverrideDecision.APPROVE,
        'False positive',
      );

      expect(result.overrideId).toBe('override-123');
      expect(overrideRepository.create).toHaveBeenCalledWith({
        executionId: 'exec-123',
        userId: 'user-1',
        originalDecision: 'IN_PROGRESS',
        newDecision: 'APPROVE',
        reason: 'False positive',
        overrideData: undefined,
      });
      expect(auditLogService.log).toHaveBeenCalled();
    });

    it('should use most recent override as original decision', async () => {
      executionRepository.findById.mockResolvedValue(mockExecution);
      overrideRepository.findMostRecentForExecution.mockResolvedValue({
        newDecision: 'REJECT',
      } as any);
      overrideRepository.create.mockResolvedValue({
        id: 'override-124',
        executionId: 'exec-123',
        userId: 'user-1',
        originalDecision: 'REJECT',
        newDecision: 'APPROVE',
        reason: 'Changed mind',
      } as any);

      await service.overrideDecision(
        'exec-123',
        'user-1',
        OverrideDecision.APPROVE,
        'Changed mind',
      );

      expect(overrideRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalDecision: 'REJECT',
          newDecision: 'APPROVE',
        }),
      );
    });

    it('should throw BadRequestException if execution not found', async () => {
      executionRepository.findById.mockResolvedValue(null);

      await expect(
        service.overrideDecision('exec-123', 'user-1', OverrideDecision.APPROVE, 'reason'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
