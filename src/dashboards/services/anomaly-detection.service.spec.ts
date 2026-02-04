import { Test, TestingModule } from '@nestjs/testing';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { PrismaService } from '@/database/prisma.service';
import { QualityDashboardService } from './quality-dashboard.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { DashboardGateway } from '../gateways/dashboard.gateway';
import { AIConversationProcessorService } from '@/conversations/ai-conversation-processor.service';
import { EventBusService } from '@/common/event-bus.service';
import {
  AnomalyStatus,
  AnomalyType,
  AnomalyMetric,
  AnomalyResolutionDto,
} from '../dto/anomaly-detection.dto';

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService;
  let prisma: PrismaService;
  let eventBus: EventBusService;

  const mockPrismaService = {
    qualityAnomaly: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    project: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    execution: {
      findMany: jest.fn(),
    },
    deployment: {
      findMany: jest.fn(),
    },
    qualityAnomalyConfig: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    qAResult: {
      findMany: jest.fn(),
    },
    bugEscape: {
      findMany: jest.fn(),
    },
  };

  const mockQualityDashboardService = {
    getMetrics: jest.fn(),
  };

  const mockAIDecisionLogger = {
    logDecision: jest.fn(),
  };

  const mockDashboardGateway = {
    broadcastQualityUpdate: jest.fn(),
  };

  const mockAIProcessor = {
    generateSummary: jest.fn(),
  };

  const mockEventBus = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QualityDashboardService, useValue: mockQualityDashboardService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: DashboardGateway, useValue: mockDashboardGateway },
        { provide: AIConversationProcessorService, useValue: mockAIProcessor },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get<AnomalyDetectionService>(AnomalyDetectionService);
    prisma = module.get<PrismaService>(PrismaService);
    eventBus = module.get<EventBusService>(EventBusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectAnomalies', () => {
    it('should return anomalies list', async () => {
      mockPrismaService.qualityAnomaly.findMany.mockResolvedValue([
        {
          id: '1',
          project_id: 'proj-1',
          type: 'sudden_drop',
          metric: 'test_pass_rate',
          severity: 'critical',
          status: 'open',
          detected_at: new Date(),
          current_value: 65,
        },
      ]);
      mockPrismaService.project.findMany.mockResolvedValue([
        { id: 'proj-1', name: 'Project Alpha' },
      ]);

      const result = await service.detectAnomalies({});

      expect(result).toHaveLength(1);
      expect(result[0].project_name).toBe('Project Alpha');
      expect(prisma.qualityAnomaly.findMany).toHaveBeenCalled();
    });
  });

  describe('analyzeProject', () => {
    it('should detect and save anomalies (AC#2, AC#3)', async () => {
      const projectId = 'proj-1';
      mockQualityDashboardService.getMetrics.mockResolvedValue({
        items: [
          {
            metrics: {
              qa_pass_rate_percent: 65, // Below 70 threshold
              avg_coverage_percent: 70,
              bug_escapes: 0,
              bug_escape_rate_percent: 0,
            },
          },
        ],
      });

      // Mock historical data
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.bugEscape.findMany.mockResolvedValue([]);
      mockPrismaService.qualityAnomalyConfig.findFirst.mockResolvedValue(null);
      mockPrismaService.execution.findMany.mockResolvedValue([]);
      mockPrismaService.deployment.findMany.mockResolvedValue([]);
      mockPrismaService.qualityAnomaly.create.mockResolvedValue({
        id: 'anomaly-1',
        metric: 'test_pass_rate',
        severity: 'critical',
        type: 'sudden_drop',
        current_value: 65,
      });

      await service.analyzeProject(projectId);

      expect(prisma.qualityAnomaly.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AnomalyType.SUDDEN_DROP,
            metric: AnomalyMetric.TEST_PASS_RATE,
          }),
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith('quality.anomaly.detected', expect.any(Object));
    });
  });

  describe('resolveAnomaly', () => {
    it('should update anomaly status (AC#4)', async () => {
      const anomalyId = '1';
      mockPrismaService.qualityAnomaly.findUnique.mockResolvedValue({
        id: anomalyId,
        project_id: 'p1',
      });
      mockPrismaService.qualityAnomaly.update.mockResolvedValue({
        id: anomalyId,
        project_id: 'p1',
        status: 'resolved',
        resolved_at: new Date(),
      });

      const dto: AnomalyResolutionDto = {
        status: AnomalyStatus.RESOLVED,
        notes: 'Fixed in PR #123',
      };
      const userId = 'user-1';

      const result = await service.resolveAnomaly(anomalyId, dto, userId);

      expect(result.status).toBe(AnomalyStatus.RESOLVED);
      expect(prisma.qualityAnomaly.update).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should return default config if none exists', async () => {
      mockPrismaService.qualityAnomalyConfig.findFirst.mockResolvedValue(null);

      const result = await service.getAnomalyConfig('p1');

      expect(result.thresholds).toBeDefined();
      expect(result.notifications_enabled).toBe(true);
    });

    it('should upsert config when updated', async () => {
      mockPrismaService.qualityAnomalyConfig.upsert.mockResolvedValue({
        project_id: 'p1',
        thresholds: {},
        notifications_enabled: true,
        slack_channels: [],
        email_recipients: [],
      });

      const result = await service.updateAnomalyConfig(
        {
          project_id: 'p1',
          thresholds: {} as Record<string, unknown>,
          notifications_enabled: true,
        },
        'user-1',
      );

      expect(result.project_id).toBe('p1');
      expect(prisma.qualityAnomalyConfig.upsert).toHaveBeenCalled();
    });
  });
});
