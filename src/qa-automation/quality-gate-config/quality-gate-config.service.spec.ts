import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { QualityGateConfigService } from './quality-gate-config.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';

describe('QualityGateConfigService', () => {
  let service: QualityGateConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
  };

  const mockTransactionClient = {
    qualityGateConfig: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    qualityGateConfigHistory: {
      create: jest.fn(),
    },
  };

  const mockPrismaService = {
    ...mockTransactionClient,
    $transaction: jest.fn((cb) => cb(mockTransactionClient)),
  };

  const mockAIDecisionLogger = {
    logDecision: jest.fn(),
    getDecisionTimeline: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityGateConfigService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AIDecisionLoggerService,
          useValue: mockAIDecisionLogger,
        },
      ],
    }).compile();

    service = module.get<QualityGateConfigService>(QualityGateConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEffectiveConfig', () => {
    it('should return project config if it exists', async () => {
      const projectConfig = {
        id: 'config-1',
        projectId: 'proj-1',
        minTestPassRate: 95,
        minCoverage: 85,
        targetCoverage: 95,
        maxLintingErrors: 0,
        maxLintingWarnings: 5,
        blockOnCriticalSecurity: true,
        blockOnHighSecurity: true,
        maxComplexity: 15,
        enabledCategories: ['TESTING', 'COVERAGE'],
        allowOverride: true,
        overrideRequiresApproval: false,
      };

      mockPrismaService.qualityGateConfig.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.qualityGateConfig.findUnique.mockResolvedValueOnce(projectConfig);

      const result = await service.getEffectiveConfig('proj-1');

      expect(result.projectId).toBe('proj-1');
      expect(result.thresholds.minTestPassRate).toBe(95);
      expect(result.enabledCategories).toEqual(['TESTING', 'COVERAGE']);
    });
  });
});
