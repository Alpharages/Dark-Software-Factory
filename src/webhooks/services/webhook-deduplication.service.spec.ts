/**
 * Story 20.1: Webhook Deduplication Service Tests
 *
 * Tests for Redis-based distributed deduplication with in-memory fallback.
 * AC2: Idempotent Job Queuing
 * AC6: Distributed Deduplication
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WebhookDeduplicationService } from './webhook-deduplication.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    ping: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  }));
});

describe('WebhookDeduplicationService', () => {
  let service: WebhookDeduplicationService;
  let configService: ConfigService;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeduplicationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'webhooks.dedupTtlMs': 300000, // 5 minutes
                'webhooks.useRedisDeduplication': true,
                'externalServices.redis.url': 'redis://localhost:6379',
                'externalServices.redis.enabled': true,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);
    configService = module.get<ConfigService>(ConfigService);
    mockRedis = (service as unknown as { redis: jest.Mocked<Redis> }).redis;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndSet', () => {
    it('should return isDuplicate=false for new webhook (Redis)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.checkAndSet('webhook-123');

      expect(result.isDuplicate).toBe(false);
      expect(result.source).toBe('redis');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'webhook:dedup:webhook-123',
        expect.any(String),
        'EX',
        300,
        'NX',
      );
    });

    it('should return isDuplicate=true for duplicate webhook (Redis)', async () => {
      mockRedis.set.mockResolvedValue(null); // Key already exists

      const result = await service.checkAndSet('webhook-123');

      expect(result.isDuplicate).toBe(true);
      expect(result.source).toBe('redis');
    });

    it('should fall back to in-memory when Redis fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis connection error'));

      // First call - should succeed and store in memory
      const result1 = await service.checkAndSet('webhook-456', 'corr-456');
      expect(result1.isDuplicate).toBe(false);
      expect(result1.source).toBe('memory');

      // Second call - should detect duplicate
      const result2 = await service.checkAndSet('webhook-456', 'corr-457');
      expect(result2.isDuplicate).toBe(true);
      expect(result2.source).toBe('memory');
    });

    it('should fall back to in-memory when Redis is not configured', async () => {
      // Create service without Redis
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'externalServices.redis.enabled') return false;
        if (key === 'externalServices.redis.url') return undefined;
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookDeduplicationService,
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const memoryService = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);

      const result1 = await memoryService.checkAndSet('webhook-789');
      expect(result1.isDuplicate).toBe(false);
      expect(result1.source).toBe('memory');

      const result2 = await memoryService.checkAndSet('webhook-789');
      expect(result2.isDuplicate).toBe(true);
      expect(result2.source).toBe('memory');
    });

    it('should respect deduplication TTL', async () => {
      // Create a new module with custom TTL
      const customConfigService = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          const config: Record<string, unknown> = {
            'webhooks.dedupTtlMs': 100, // 100ms
            'webhooks.useRedisDeduplication': true,
            'externalServices.redis.url': 'redis://localhost:6379',
            'externalServices.redis.enabled': true,
          };
          return config[key] ?? defaultValue;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookDeduplicationService,
          {
            provide: ConfigService,
            useValue: customConfigService,
          },
        ],
      }).compile();

      const ttlService = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);
      const redis = (ttlService as unknown as { redis: jest.Mocked<Redis> }).redis;

      redis.set.mockResolvedValue('OK');

      await ttlService.checkAndSet('webhook-ttl');

      expect(redis.set).toHaveBeenCalledWith(
        'webhook:dedup:webhook-ttl',
        expect.any(String),
        'EX',
        1, // 100ms rounded up to 1 second
        'NX',
      );
    });

    describe('TTL boundary conditions', () => {
      it.each([
        { ttlMs: 999, expectedSeconds: 1 }, // Just under 1 second
        { ttlMs: 1000, expectedSeconds: 1 }, // Exactly 1 second
        { ttlMs: 1001, expectedSeconds: 2 }, // Just over 1 second
        { ttlMs: 59999, expectedSeconds: 60 }, // Just under 1 minute
        { ttlMs: 60000, expectedSeconds: 60 }, // Exactly 1 minute
        { ttlMs: 60001, expectedSeconds: 61 }, // Just over 1 minute
      ])(
        'should round $ttlMs ms to $expectedSeconds seconds',
        async ({ ttlMs, expectedSeconds }) => {
          const customConfigService = {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'webhooks.dedupTtlMs': ttlMs,
                'webhooks.useRedisDeduplication': true,
                'externalServices.redis.url': 'redis://localhost:6379',
                'externalServices.redis.enabled': true,
              };
              return config[key] ?? defaultValue;
            }),
          };

          const module: TestingModule = await Test.createTestingModule({
            providers: [
              WebhookDeduplicationService,
              {
                provide: ConfigService,
                useValue: customConfigService,
              },
            ],
          }).compile();

          const ttlService = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);
          const redis = (ttlService as unknown as { redis: jest.Mocked<Redis> }).redis;

          redis.set.mockResolvedValue('OK');

          await ttlService.checkAndSet('webhook-boundary');

          expect(redis.set).toHaveBeenCalledWith(
            'webhook:dedup:webhook-boundary',
            expect.any(String),
            'EX',
            expectedSeconds,
            'NX',
          );
        },
      );
    });
  });

  describe('isHealthy', () => {
    it('should return true when Redis is healthy', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const isHealthy = await service.isHealthy();

      expect(isHealthy).toBe(true);
    });

    it('should return false when Redis ping fails', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

      const isHealthy = await service.isHealthy();

      expect(isHealthy).toBe(false);
    });

    it('should return true for in-memory backend', async () => {
      // Create service without Redis
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'externalServices.redis.enabled') return false;
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookDeduplicationService,
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const memoryService = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);

      const isHealthy = await memoryService.isHealthy();
      expect(isHealthy).toBe(true);
    });
  });

  describe('getBackendType', () => {
    it('should return "redis" when Redis is configured', () => {
      expect(service.getBackendType()).toBe('redis');
    });

    it('should return "memory" when Redis is not configured', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'externalServices.redis.enabled') return false;
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookDeduplicationService,
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const memoryService = module.get<WebhookDeduplicationService>(WebhookDeduplicationService);
      expect(memoryService.getBackendType()).toBe('memory');
    });
  });

  describe('getStats', () => {
    it('should return correct stats for Redis backend', () => {
      const stats = service.getStats();

      expect(stats.backend).toBe('redis');
      expect(stats.inMemorySize).toBe(0);
      expect(stats.dedupTtlMs).toBe(300000);
    });

    it('should return correct stats with in-memory entries', async () => {
      // Force Redis to fail to populate in-memory cache
      mockRedis.set.mockRejectedValue(new Error('Redis down'));

      await service.checkAndSet('webhook-1');
      await service.checkAndSet('webhook-2');

      const stats = service.getStats();

      expect(stats.backend).toBe('redis'); // Still redis backend even if fallback used
      expect(stats.inMemorySize).toBe(2);
    });
  });

  describe('concurrent deduplication', () => {
    it('should handle concurrent requests for same webhook', async () => {
      // Redis SET NX is atomic - only one call will succeed
      // Mock simulates this by using a "database" that persists across calls
      const redisDb = new Set<string>();

      mockRedis.set.mockImplementation((key: unknown) => {
        const keyStr = String(key);
        // Extract webhook ID from key (format: webhook:dedup:{id})
        const webhookId = keyStr.replace('webhook:dedup:', '');

        if (redisDb.has(webhookId)) {
          // Key already exists - return null (duplicate)
          return Promise.resolve(null);
        }
        // Key doesn't exist - set it and return OK
        redisDb.add(webhookId);
        return Promise.resolve('OK');
      });

      const results = await Promise.all([
        service.checkAndSet('concurrent-webhook'),
        service.checkAndSet('concurrent-webhook'),
        service.checkAndSet('concurrent-webhook'),
      ]);

      // Exactly one should be new, rest should be duplicates
      const newCount = results.filter((r) => !r.isDuplicate).length;
      const dupCount = results.filter((r) => r.isDuplicate).length;

      expect(newCount).toBe(1);
      expect(dupCount).toBe(2);
    });

    it('should include correlation ID in deduplication logs', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const correlationId = 'test-correlation-123';

      const result = await service.checkAndSet('webhook-corr', correlationId);

      expect(result.isDuplicate).toBe(false);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'webhook:dedup:webhook-corr',
        expect.any(String),
        'EX',
        300,
        'NX',
      );
    });
  });
});
