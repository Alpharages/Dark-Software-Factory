import { Test, TestingModule } from '@nestjs/testing';
import { EscalationService } from './escalation.service';
import { PrismaService } from '../database/prisma.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { AdrStatus, RiskLevel } from '@/prisma/client';

describe('EscalationService', () => {
  let service: EscalationService;
  let _prismaService: PrismaService;
  let _notificationService: ArchitectureReviewNotificationService;

  const mockPrismaService = {
    adr: {
      findMany: jest.fn(),
    },
  };

  const mockNotificationService = {
    notifyEscalation: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ArchitectureReviewNotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<EscalationService>(EscalationService);
    _prismaService = module.get<PrismaService>(PrismaService);
    _notificationService = module.get<ArchitectureReviewNotificationService>(
      ArchitectureReviewNotificationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkHighRiskAdrs', () => {
    it('should find stuck High Risk ADRs and escalate them', async () => {
      // Setup: 2 ADRs, one stuck (> 4h), one new (< 4h)
      // But query will filter by created_at.
      // We expect the service to query for logic:
      // status = PROPOSED, risk_level = HIGH, created_at < 4 hours ago.

      const stuckAdr = {
        id: 'stuck-1',
        title: 'Stuck ADR',
        status: AdrStatus.PROPOSED,
        risk_level: RiskLevel.HIGH,
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
      };

      const _newAdr = {
        id: 'new-1',
        title: 'New High Risk ADR',
        status: AdrStatus.PROPOSED,
        risk_level: RiskLevel.HIGH,
        created_at: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      };

      // Mock findMany to return ONLY stuck ADRs (simulating the query filtering)
      // Or verifying that findMany is CALLED with correct date filter?
      // A better test for logic INSIDE the service is:
      // Service calls prisma with Date filter.
      // Service iterates results and calls notify.

      mockPrismaService.adr.findMany.mockResolvedValue([stuckAdr]);

      await service.checkHighRiskAdrs();

      // Verify Query
      expect(mockPrismaService.adr.findMany).toHaveBeenCalledWith({
        where: {
          status: AdrStatus.PROPOSED,
          risk_level: RiskLevel.HIGH,
          created_at: {
            lte: expect.any(Date), // 4 hours ago
          },
        },
      });

      // Verify Notification
      expect(_notificationService.notifyEscalation).toHaveBeenCalledWith(stuckAdr);
      expect(_notificationService.notifyEscalation).toHaveBeenCalledTimes(1);
    });

    it('should escalate multiple stuck ADRs', async () => {
      const stuckAdr1 = { id: '1', title: 'ADR 1' };
      const stuckAdr2 = { id: '2', title: 'ADR 2' };

      mockPrismaService.adr.findMany.mockResolvedValue([stuckAdr1, stuckAdr2]);

      await service.checkHighRiskAdrs();

      expect(_notificationService.notifyEscalation).toHaveBeenCalledTimes(2);
    });
  });
});
