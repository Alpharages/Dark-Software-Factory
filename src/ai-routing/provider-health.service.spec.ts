import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { ProviderHealthService } from './provider-health.service';
import { PrismaService } from '../database/prisma.service';

describe('ProviderHealthService', () => {
  let service: ProviderHealthService;

  let mockPrisma: any;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        'ai.providers.claudeCode.enabled': true,
        'ai.providers.claudeCode.maxConcurrent': 5,
        'ai.providers.claudeCode.timeout': 180000,
        'ai.providers.gemini.enabled': true,
        'ai.providers.gemini.maxConcurrent': 3,
        'ai.providers.gemini.timeout': 300000,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockMetrics = {
    set: jest.fn(),
    inc: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma = {
      execution: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderHealthService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'PROM_METRIC_AI_PROVIDER_HEALTH', useValue: mockMetrics },
        { provide: 'PROM_METRIC_AI_PROVIDER_ACTIVE_EXECUTIONS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_AI_PROVIDER_AVAILABILITY_TOTAL', useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<ProviderHealthService>(ProviderHealthService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up the interval timer to prevent open handles
    if (service) {
      service.onModuleDestroy();
    }
  });

  describe('providerConfigKey', () => {
    it('should convert SCREAMING_SNAKE_CASE to camelCase', () => {
      expect((service as any).providerConfigKey(AIProvider.CLAUDE_CODE)).toBe('claudeCode');
      expect((service as any).providerConfigKey(AIProvider.GEMINI)).toBe('gemini');
    });
  });

  describe('isProviderEnabled', () => {
    it('should query config service using camelCase key', () => {
      mockConfigService.get.mockClear();
      (service as any).isProviderEnabled(AIProvider.CLAUDE_CODE);
      expect(mockConfigService.get).toHaveBeenCalledWith('ai.providers.claudeCode.enabled', false);

      mockConfigService.get.mockClear();
      (service as any).isProviderEnabled(AIProvider.GEMINI);
      expect(mockConfigService.get).toHaveBeenCalledWith('ai.providers.gemini.enabled', false);
    });
  });

  describe('getMaxConcurrent', () => {
    it('should query config service using camelCase key for maxConcurrent', () => {
      mockConfigService.get.mockClear();
      (service as any).getMaxConcurrent(AIProvider.CLAUDE_CODE);
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'ai.providers.claudeCode.maxConcurrent',
        3,
      );

      mockConfigService.get.mockClear();
      (service as any).getMaxConcurrent(AIProvider.GEMINI);
      expect(mockConfigService.get).toHaveBeenCalledWith('ai.providers.gemini.maxConcurrent', 3);
    });
  });

  describe('getProviderHealth', () => {
    it('should return healthy status when provider is enabled and under capacity', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);

      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(1); // 1 active execution

      const health = await service.getProviderHealth(AIProvider.CLAUDE_CODE);

      expect(health.isHealthy).toBe(true);
      expect(health.activeExecutions).toBe(1);
      expect(health.maxConcurrent).toBe(3);
      expect(health.currentLoad).toBeLessThan(100);
    });

    it('should return unhealthy when at max capacity', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);

      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(3); // At max concurrent

      const health = await service.getProviderHealth(AIProvider.CLAUDE_CODE);

      expect(health.isHealthy).toBe(false);
      expect(health.currentLoad).toBe(100);
    });

    it('should return unhealthy when provider disabled', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(false);

      const health = await service.getProviderHealth(AIProvider.CLAUDE_CODE);

      expect(health.isHealthy).toBe(false);
      expect(health.errorMessage).toContain('disabled');
    });
  });

  describe('getAvailableProvider', () => {
    it('should return preferred provider when available', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);

      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(1);

      const result = await service.getAvailableProvider(AIProvider.CLAUDE_CODE);

      expect(result).not.toBeNull();
      expect(result?.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should fallback to secondary when primary unavailable', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);

      jest.spyOn(service as any, 'getMaxConcurrent').mockImplementation((provider) => {
        return String(provider) === 'CLAUDE_CODE' ? 3 : 5;
      });

      // Claude full (3), Gemini available (2)

      mockPrisma.execution.count.mockImplementation((args: any) => {
        return Promise.resolve(args.where.ai_provider === AIProvider.CLAUDE_CODE ? 3 : 2);
      });

      const result = await service.getAvailableProvider(AIProvider.CLAUDE_CODE);

      expect(result?.provider).toBe(AIProvider.GEMINI);
    });

    it('should return null when no provider available', async () => {
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);

      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(10); // All over capacity

      const result = await service.getAvailableProvider();

      expect(result).toBeNull();
    });

    it('should check all providers dynamically based on enum values', async () => {
      const healthSpy = jest.spyOn(service, 'getProviderHealth').mockResolvedValue({
        isHealthy: false,
        provider: AIProvider.CLAUDE_CODE,
        activeExecutions: 0,
        maxConcurrent: 3,
        currentLoad: 0,
        lastChecked: new Date(),
      });

      await service.getAvailableProvider();

      const checkedProviders = healthSpy.mock.calls.map((args) => args[0]);
      expect(checkedProviders).toEqual(expect.arrayContaining(Object.values(AIProvider)));
    });
  });

  describe('getUnavailableDuration', () => {
    it('should return null for healthy provider', () => {
      const duration = service.getUnavailableDuration(AIProvider.CLAUDE_CODE);
      expect(duration).toBeNull();
    });
  });
});
