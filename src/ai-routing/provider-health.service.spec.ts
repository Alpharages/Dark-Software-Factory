import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { ProviderHealthService } from './provider-health.service';
import { PrismaService } from '../database/prisma.service';

describe('ProviderHealthService', () => {
  let service: ProviderHealthService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      console.log(`[MOCK CONFIG] Requesting key: ${key}`);
      const config: Record<string, unknown> = {
        'ai.providers.cursorHeadless.enabled': true,
        'ai.providers.cursorHeadless.maxConcurrent': 3,
        'ai.providers.cursorHeadless.timeout': 300000,
        'ai.providers.claudeCode.enabled': true,
        'ai.providers.claudeCode.maxConcurrent': 5,
        'ai.providers.claudeCode.timeout': 180000,
      };
      const val = config[key] ?? defaultValue;
      console.log(`[MOCK CONFIG] Returning: ${val}`);
      return val;
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

    console.log('[TEST SETUP] AIProvider:', AIProvider);
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

  describe('getProviderHealth', () => {
    it('should return healthy status when provider is enabled and under capacity', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(1); // 1 active execution

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(true);
      expect(health.activeExecutions).toBe(1);
      expect(health.maxConcurrent).toBe(3);
      expect(health.currentLoad).toBeLessThan(100);
    });

    it('should return unhealthy when at max capacity', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(3); // At max concurrent

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(false);
      expect(health.currentLoad).toBe(100);
    });

    it('should return unhealthy when provider disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(false);

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(false);
      expect(health.errorMessage).toContain('disabled');
    });
  });

  describe('getAvailableProvider', () => {
    it('should return preferred provider when available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(1);

      const result = await service.getAvailableProvider(AIProvider.CURSOR_HEADLESS);

      expect(result).not.toBeNull();
      expect(result?.provider).toBe(AIProvider.CURSOR_HEADLESS);
    });

    it('should fallback to secondary when primary unavailable', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'getMaxConcurrent').mockImplementation((provider) => {
        return String(provider) == 'CURSOR_HEADLESS' ? 3 : 5;
      });

      // Cursor full (3), Claude available (2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma.execution.count.mockImplementation((args: any) => {
        return Promise.resolve(args.where.ai_provider === AIProvider.CURSOR_HEADLESS ? 3 : 2);
      });

      const result = await service.getAvailableProvider(AIProvider.CURSOR_HEADLESS);

      expect(result?.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should return null when no provider available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'isProviderEnabled').mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'getMaxConcurrent').mockReturnValue(3);
      mockPrisma.execution.count.mockResolvedValue(10); // All over capacity

      const result = await service.getAvailableProvider();

      expect(result).toBeNull();
    });
  });

  describe('getUnavailableDuration', () => {
    it('should return null for healthy provider', () => {
      const duration = service.getUnavailableDuration(AIProvider.CURSOR_HEADLESS);
      expect(duration).toBeNull();
    });
  });
});
