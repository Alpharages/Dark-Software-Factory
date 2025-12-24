import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { CostOptimizerService } from './cost-optimizer.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { Prisma } from '@/prisma/client';
const Decimal = Prisma.Decimal;

describe('CostOptimizerService', () => {
  let service: CostOptimizerService;
  let cacheManager: jest.Mocked<Cache>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostOptimizerService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: jest.fn(),
            incrementGauge: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                AI_COST_OPTIMIZATION_ENABLED: true,
                AI_CACHE_TTL_SECONDS: 3600,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CostOptimizerService>(CostOptimizerService);
    cacheManager = module.get(CACHE_MANAGER);
    metricsService = module.get(MetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectOptimalModel', () => {
    it('should select gpt-3.5-turbo for simple tasks (complexity 0-5)', () => {
      expect(service.selectOptimalModel(0)).toBe('gpt-3.5-turbo');
      expect(service.selectOptimalModel(3)).toBe('gpt-3.5-turbo');
      expect(service.selectOptimalModel(5)).toBe('gpt-3.5-turbo');
    });

    it('should select claude-3-5-sonnet for medium tasks (complexity 6-12)', () => {
      expect(service.selectOptimalModel(6)).toBe('claude-3-5-sonnet-20240620');
      expect(service.selectOptimalModel(9)).toBe('claude-3-5-sonnet-20240620');
      expect(service.selectOptimalModel(12)).toBe('claude-3-5-sonnet-20240620');
    });

    it('should select gpt-4o for complex tasks (complexity 13-20)', () => {
      expect(service.selectOptimalModel(13)).toBe('gpt-4o');
      expect(service.selectOptimalModel(16)).toBe('gpt-4o');
      expect(service.selectOptimalModel(20)).toBe('gpt-4o');
    });

    it('should bypass optimization if force_premium_model flag is set', () => {
      const result = service.selectOptimalModel(3, { force_premium_model: true });
      expect(result).toBe('gpt-4o'); // Premium model
    });

    it('should return gpt-3.5-turbo if optimization is enabled and no bypass flag', () => {
      const result = service.selectOptimalModel(2, { force_premium_model: false });
      expect(result).toBe('gpt-3.5-turbo');
    });
  });

  describe('getCachedResponse', () => {
    it('should return cached response if exists', async () => {
      const mockCached = {
        response: { code: '// code' },
        costUsd: new Decimal(0.01),
        cachedAt: new Date(),
        hits: 0,
      };
      cacheManager.get.mockResolvedValue(mockCached);

      const result = await service.getCachedResponse('test prompt');

      expect(result).toBeDefined();
      expect(result?.hits).toBe(1); // Should increment hits
      expect(cacheManager.set).toHaveBeenCalled(); // Should update cache
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('ai_cache_hits_total', {
        operation_type: 'prompt_cache',
      });
    });

    it('should return null if cache miss', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.getCachedResponse('test prompt');

      expect(result).toBeNull();
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('ai_cache_misses_total', {
        operation_type: 'prompt_cache',
      });
    });

    it('should skip cache if prompt contains bypass keywords', async () => {
      const result = await service.getCachedResponse('Generate code for ticketid abc123');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('ai_cache_misses_total', {
        operation_type: 'cache_bypassed',
      });
    });

    it('should skip cache for prompts with executionId', async () => {
      const result = await service.getCachedResponse('Process executionid abc456');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });

    it('should skip cache for prompts with timestamp', async () => {
      const result = await service.getCachedResponse('timestamp: 2024-01-01');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });

    it('should skip cache for prompts with ticket_id (underscore variant)', async () => {
      const result = await service.getCachedResponse('Process ticket_id: abc-123');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });

    it('should skip cache for prompts with ticket-id (dash variant)', async () => {
      const result = await service.getCachedResponse('Handle ticket-id xyz789');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });

    it('should skip cache for prompts with TICKET_ID (uppercase)', async () => {
      const result = await service.getCachedResponse('TICKET_ID: TST-001');

      expect(result).toBeNull();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });
  });

  describe('cacheResponse', () => {
    it('should cache response with TTL', async () => {
      const response = { code: '// code' };
      const costUsd = new Decimal(0.05);

      await service.cacheResponse('test prompt', response, costUsd);

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String), // SHA-256 hash
        expect.objectContaining({
          response,
          costUsd,
          hits: 0,
        }),
        3600 * 1000, // TTL in ms
      );
    });

    it('should not cache if prompt contains bypass keywords', async () => {
      await service.cacheResponse('Generate code for ticketid xyz', {}, new Decimal(0.01));

      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('trackCostSavings', () => {
    it('should calculate and track positive savings', () => {
      const savings = service.trackCostSavings(
        'gpt-4o',
        'gpt-3.5-turbo',
        1000,
        2000,
        'project-123',
      );

      expect(savings).toBeGreaterThan(0);
      expect(metricsService.incrementGauge).toHaveBeenCalledWith(
        'ai_cost_savings_total',
        expect.any(Number),
        {
          original_model: 'gpt-4o',
          selected_model: 'gpt-3.5-turbo',
          project_id: 'project-123',
        },
      );
    });

    it('should not record negative savings', () => {
      const savings = service.trackCostSavings(
        'gpt-3.5-turbo',
        'gpt-4o',
        1000,
        2000,
        'project-123',
      );

      expect(savings).toBeLessThan(0);
      expect(metricsService.incrementGauge).not.toHaveBeenCalled();
    });

    it('should calculate correct savings amount', () => {
      // gpt-4o: $5 input, $15 output per 1M tokens
      // gpt-3.5-turbo: $0.15 input, $0.60 output per 1M tokens
      // For 1M input + 1M output:
      // gpt-4o: $5 + $15 = $20
      // gpt-3.5-turbo: $0.15 + $0.60 = $0.75
      // Savings: $19.25

      const savings = service.trackCostSavings(
        'gpt-4o',
        'gpt-3.5-turbo',
        1000000,
        1000000,
        'project-123',
      );

      expect(savings).toBeCloseTo(19.25, 2);
    });
  });
});
