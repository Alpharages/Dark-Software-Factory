import { Test, TestingModule } from '@nestjs/testing';
import { QaNotificationService } from './qa-notification.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

// Mock execution object
const mockExecution = {
  id: 'exec-123',
  ticketId: 'ticket-456',
  ticket: {
    projectId: 'proj-789',
    project: {
      pm_id: 'pm-user-1',
    },
  },
};

describe('QaNotificationService', () => {
  let service: QaNotificationService;
  let realtimeService: RealtimeService;
  let notificationsCounter: Counter<string>;

  beforeEach(async () => {
    // Mock RealtimeService
    const mockRealtimeService = {
      emitToUser: jest.fn(),
      emitToProject: jest.fn(),
      emitToRole: jest.fn(),
    };

    // Mock Metrics
    const mockCounter = {
      inc: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaNotificationService,
        {
          provide: RealtimeService,
          useValue: mockRealtimeService,
        },
        {
          provide: getToken('qa_notifications_emitted_total'),
          useValue: mockCounter,
        },
        {
          provide: getToken('qa_notification_emission_errors_total'),
          useValue: mockCounter,
        },
      ],
    }).compile();

    service = module.get<QaNotificationService>(QaNotificationService);
    realtimeService = module.get<RealtimeService>(RealtimeService);
    notificationsCounter = module.get(getToken('qa_notifications_emitted_total'));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('emitGateFailed', () => {
    it('should emit to PM, Project, and Lead QA for LOW severity', async () => {
      await service.emitGateFailed(mockExecution, 'LINTING', { errorCount: 1 }, 'LOW');

      // Verify routing
      expect(realtimeService.emitToUser).toHaveBeenCalledWith(
        'pm-user-1',
        'qa.gate_failed',
        expect.any(Object),
      );
      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-789',
        'qa.gate_failed',
        expect.any(Object),
      );
      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'LEAD_QA',
        'qa.gate_failed',
        expect.any(Object),
      );

      // Should NOT notify MANAGER for LOW severity
      expect(realtimeService.emitToRole).not.toHaveBeenCalledWith(
        'MANAGER',
        expect.any(String),
        expect.any(Object),
      );

      // Metrics
      expect(notificationsCounter.inc).toHaveBeenCalledWith({
        gate_type: 'LINTING',
        severity: 'LOW',
      });
    });

    it('should emit to MANAGER for CRITICAL severity', async () => {
      await service.emitGateFailed(mockExecution, 'TEST', { failed: 10 }, 'CRITICAL');

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'MANAGER',
        'qa.gate_failed',
        expect.any(Object),
      );
    });

    it('should emit to ADMIN for SECURITY failure', async () => {
      await service.emitGateFailed(mockExecution, 'SECURITY', { critical: 1 }, 'CRITICAL');

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'ADMIN',
        'qa.gate_failed',
        expect.any(Object),
      );
    });
  });

  describe('emitAllGatesFailed', () => {
    it('should aggregate severity and emit', async () => {
      await service.emitAllGatesFailed(mockExecution, [], {
        totalFailures: 2,
        criticalCount: 1, // Impiles CRITICAL
        highCount: 0,
        mediumCount: 0,
        lowCount: 1,
      });

      // Should be routed as CRITICAL due to criticalCount > 0
      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'MANAGER',
        'qa.all_gates_failed',
        expect.any(Object),
      );
      expect(notificationsCounter.inc).toHaveBeenCalledWith({
        gate_type: 'AGGREGATED',
        severity: 'CRITICAL',
      });
    });

    it('should notify ADMIN if security failures exist in aggregated failure', async () => {
      await service.emitAllGatesFailed(
        mockExecution,
        [
          {
            gateType: 'SECURITY',
            failureDetails: {}, // details irrelevant for routing check
            severity: 'HIGH',
          },
        ],
        {
          totalFailures: 1,
          criticalCount: 0,
          highCount: 1,
          mediumCount: 0,
          lowCount: 0,
        },
      );

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'ADMIN',
        'qa.all_gates_failed',
        expect.objectContaining({ hasSecurityFailures: true }),
      );
    });
  });

  describe('emitGateBlocked', () => {
    it('should emit to LEAD_QA and set severity to HIGH', async () => {
      await service.emitGateBlocked(mockExecution, ['LINTING'], true, ['LEAD_QA']);

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'LEAD_QA',
        'qa.gate_blocked',
        expect.any(Object),
      );
      expect(notificationsCounter.inc).toHaveBeenCalledWith({
        gate_type: 'BLOCKED',
        severity: 'HIGH',
      });
    });
  });

  describe('graceful degradation', () => {
    it('should not crash if RealtimeService is missing', async () => {
      // Re-create module without RealtimeService
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          QaNotificationService,
          {
            provide: getToken('qa_notifications_emitted_total'),
            useValue: { inc: jest.fn() },
          },
          {
            provide: getToken('qa_notification_emission_errors_total'),
            useValue: { inc: jest.fn() },
          },
        ],
      }).compile();

      const degradedService = module.get<QaNotificationService>(QaNotificationService);

      await expect(
        degradedService.emitGateFailed(mockExecution, 'LINTING', {}, 'LOW'),
      ).resolves.not.toThrow();
    });
  });
});
