import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionStatus } from '@/prisma/client';
import { ManualInterventionController } from './manual-intervention.controller';
import { ManualInterventionService } from '../services/manual-intervention.service';
import { OverrideDecision } from '../dto/override-decision.dto';

describe('ManualInterventionController', () => {
  let controller: ManualInterventionController;
  let service: jest.Mocked<ManualInterventionService>;

  const mockUser = { userId: 'user-123' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockRequest: any = { user: mockUser };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManualInterventionController],
      providers: [
        {
          provide: ManualInterventionService,
          useValue: {
            pauseExecution: jest.fn(),
            resumeExecution: jest.fn(),
            emergencyStop: jest.fn(),
            overrideDecision: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ManualInterventionController>(ManualInterventionController);
    service = module.get(ManualInterventionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pauseExecution', () => {
    it('should pause execution successfully', async () => {
      service.pauseExecution.mockResolvedValue({
        execution: {
          id: 'exec-123',
          status: ExecutionStatus.PAUSED,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        containerControlSkipped: false,
      });

      const result = await controller.pauseExecution(
        'exec-123',
        { reason: 'Investigating' },
        mockRequest,
      );

      expect(result.executionId).toBe('exec-123');
      expect(result.status).toBe(ExecutionStatus.PAUSED);
      expect(result.reason).toBe('Investigating');
      expect(result.performedBy).toBe('user-123');
      expect(service.pauseExecution).toHaveBeenCalledWith('exec-123', 'user-123', 'Investigating');
    });
  });

  describe('resumeExecution', () => {
    it('should resume execution successfully', async () => {
      service.resumeExecution.mockResolvedValue({
        execution: {
          id: 'exec-123',
          status: ExecutionStatus.IN_PROGRESS,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        containerControlSkipped: false,
      });

      const result = await controller.resumeExecution(
        'exec-123',
        { resumeNotes: 'Issue resolved' },
        mockRequest,
      );

      expect(result.executionId).toBe('exec-123');
      expect(result.status).toBe(ExecutionStatus.IN_PROGRESS);
      expect(result.resumeNotes).toBe('Issue resolved');
      expect(service.resumeExecution).toHaveBeenCalledWith(
        'exec-123',
        'user-123',
        'Issue resolved',
      );
    });

    it('should resume execution without notes', async () => {
      service.resumeExecution.mockResolvedValue({
        execution: {
          id: 'exec-123',
          status: ExecutionStatus.IN_PROGRESS,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        containerControlSkipped: false,
      });

      const result = await controller.resumeExecution('exec-123', {}, mockRequest);

      expect(result.executionId).toBe('exec-123');
      expect(service.resumeExecution).toHaveBeenCalledWith('exec-123', 'user-123', undefined);
    });
  });

  describe('emergencyStop', () => {
    it('should emergency stop with kill container', async () => {
      service.emergencyStop.mockResolvedValue({
        execution: {
          id: 'exec-123',
          status: ExecutionStatus.EMERGENCY_STOPPED,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        containerKilled: true,
        containerControlSkipped: false,
      });

      const result = await controller.emergencyStop(
        'exec-123',
        { reason: 'Critical error', killContainer: true },
        mockRequest,
      );

      expect(result.executionId).toBe('exec-123');
      expect(result.status).toBe(ExecutionStatus.EMERGENCY_STOPPED);
      expect(result.reason).toBe('Critical error');
      expect(service.emergencyStop).toHaveBeenCalledWith(
        'exec-123',
        'user-123',
        'Critical error',
        true,
      );
    });

    it('should emergency stop with graceful stop (default)', async () => {
      service.emergencyStop.mockResolvedValue({
        execution: {
          id: 'exec-123',
          status: ExecutionStatus.EMERGENCY_STOPPED,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        containerKilled: false,
        containerControlSkipped: false,
      });

      await controller.emergencyStop('exec-123', { reason: 'Stop needed' }, mockRequest);

      expect(service.emergencyStop).toHaveBeenCalledWith(
        'exec-123',
        'user-123',
        'Stop needed',
        undefined,
      );
    });
  });

  describe('overrideDecision', () => {
    it('should override decision to APPROVE', async () => {
      service.overrideDecision.mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execution: { id: 'exec-123' } as any,
        overrideId: 'override-456',
      });

      const result = await controller.overrideDecision(
        'exec-123',
        {
          decision: OverrideDecision.APPROVE,
          reason: 'False positive',
          overrideData: { reviewedFiles: ['test.ts'] },
        },
        mockRequest,
      );

      expect(result.executionId).toBe('exec-123');
      expect(result.decisionOverridden).toBe(true);
      expect(result.newDecision).toBe(OverrideDecision.APPROVE);
      expect(result.overriddenBy).toBe('user-123');
      expect(service.overrideDecision).toHaveBeenCalledWith(
        'exec-123',
        'user-123',
        OverrideDecision.APPROVE,
        'False positive',
        { reviewedFiles: ['test.ts'] },
      );
    });

    it('should override decision to REJECT', async () => {
      service.overrideDecision.mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execution: { id: 'exec-123' } as any,
        overrideId: 'override-457',
      });

      const result = await controller.overrideDecision(
        'exec-123',
        {
          decision: OverrideDecision.REJECT,
          reason: 'Security concern',
        },
        mockRequest,
      );

      expect(result.newDecision).toBe(OverrideDecision.REJECT);
      expect(result.reason).toBe('Security concern');
    });
  });
});
