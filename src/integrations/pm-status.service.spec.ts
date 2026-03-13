import { Test, TestingModule } from '@nestjs/testing';
import { ProjectIntegration, IntegrationProvider } from '@prisma/client';
import { PMStatusService } from './pm-status.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '../common/sentry/sentry.service';
import { NormalizedStatus, NormalizedStatusType } from './providers/dto/normalized-status.dto';
import { Logger } from '@nestjs/common';

describe('PMStatusService', () => {
  let service: PMStatusService;
  let factory: PMProviderFactory;
  let sentry: SentryService;

  const mockStatuses: NormalizedStatus[] = [
    { id: '1', name: 'To Do', color: 'gray', type: NormalizedStatusType.TODO },
    { id: '2', name: 'In Progress', color: 'blue', type: NormalizedStatusType.IN_PROGRESS },
    { id: '3', name: 'Complete', color: 'green', type: NormalizedStatusType.DONE },
  ];

  const mockIntegration: ProjectIntegration = {
    id: 'int-123',
    project_id: 'proj-123',
    provider: IntegrationProvider.CLICKUP,
    workspace_id: 'ws-123',
    workspace_name: 'Test WS',
    access_token: 'token-123',
    refresh_token: 'refresh-123',
    token_expiry: null,
    bot_user_id: 'bot-123',
    bot_username: 'bot',
    webhook_id: null,
    webhook_secret: null,
    polling_enabled: false,
    polling_interval_min: 60,
    polling_last_run_at: null,
    webhook_enabled: false,
    provider_config: {},
    ai_trigger_status: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const containerId = 'list-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMStatusService,
        {
          provide: PMProviderFactory,
          useValue: {
            getProvider: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PMStatusService>(PMStatusService);
    factory = module.get<PMProviderFactory>(PMProviderFactory);
    sentry = module.get<SentryService>(SentryService);

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getStatuses', () => {
    it('should fetch statuses from provider and cache them', async () => {
      const mockProvider = { getStatuses: jest.fn().mockResolvedValue(mockStatuses) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      const result = await service.getStatuses(mockIntegration, containerId);

      expect(result).toEqual(mockStatuses);
      expect(factory.getProvider).toHaveBeenCalledWith(mockIntegration);
      expect(mockProvider.getStatuses).toHaveBeenCalledWith(containerId);

      // Second call should hit cache
      const result2 = await service.getStatuses(mockIntegration, containerId);
      expect(result2).toEqual(mockStatuses);
      expect(factory.getProvider).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL expiry', async () => {
      const mockProvider = { getStatuses: jest.fn().mockResolvedValue(mockStatuses) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      const realDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(1000);
      await service.getStatuses(mockIntegration, containerId);

      // Move time forward past TTL (5 mins = 300,000ms)
      Date.now = jest.fn().mockReturnValue(1000 + 300_001);

      await service.getStatuses(mockIntegration, containerId);
      expect(factory.getProvider).toHaveBeenCalledTimes(2);

      Date.now = realDateNow;
    });

    it('should fall back to stale cache on API error and notify Sentry', async () => {
      const mockProvider = { getStatuses: jest.fn().mockResolvedValue(mockStatuses) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      await service.getStatuses(mockIntegration, containerId);

      // Expire cache and force error
      const realDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(Date.now() + 600_000);
      mockProvider.getStatuses.mockRejectedValue(new Error('API Error'));

      const result = await service.getStatuses(mockIntegration, containerId);

      expect(result).toEqual(mockStatuses);
      expect(sentry.captureException).toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `PM tool API unavailable for ${mockIntegration.provider}:${containerId} — returning stale statuses`,
        ),
      );

      Date.now = realDateNow;
    });

    it('should re-throw error if no cache exists', async () => {
      const mockProvider = { getStatuses: jest.fn().mockRejectedValue(new Error('API Error')) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      await expect(service.getStatuses(mockIntegration, containerId)).rejects.toThrow('API Error');
    });
  });

  describe('resolveStatusId', () => {
    it('should resolve status name case-insensitively', async () => {
      const mockProvider = { getStatuses: jest.fn().mockResolvedValue(mockStatuses) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      const id = await service.resolveStatusId(mockIntegration, containerId, 'in progress');
      expect(id).toBe('2');
    });

    it('should return raw status name as fallback if no match found', async () => {
      const mockProvider = { getStatuses: jest.fn().mockResolvedValue(mockStatuses) };
      (factory.getProvider as jest.Mock).mockResolvedValue(mockProvider);

      const id = await service.resolveStatusId(mockIntegration, containerId, 'Unknown Status');
      expect(id).toBe('Unknown Status');
    });
  });
});
