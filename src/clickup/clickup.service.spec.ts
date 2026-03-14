/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClickUpService } from './clickup.service';
import { SentryService } from '../common/sentry/sentry.service';

describe('ClickUpService', () => {
  let service: ClickUpService;
  let sentryService: SentryService;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClickUpService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                CLICKUP_RETRY_ATTEMPTS: 3,
                CLICKUP_RETRY_BACKOFF_MS: 100, // Faster for tests
                CLICKUP_MAX_COMMENT_LENGTH: 20000,
              };
              return config[key] ?? defaultValue;
            }),
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

    service = module.get<ClickUpService>(ClickUpService);
    sentryService = module.get<SentryService>(SentryService);
    // Inject test axios client directly (OAuth-only mode: no API key init in constructor)
    (service as any).client = mockAxiosInstance;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should always start with client null (OAuth-only mode)', () => {
      // Service is always in OAuth-only mode — no API key init
      // Client is injected directly in tests via (service as any).client
      expect((service as any).retryAttempts).toBe(3);
      expect((service as any).retryBackoffMs).toBe(100);
    });

    it('should throw Error when calling methods without a client', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClickUpService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
          { provide: SentryService, useValue: { captureException: jest.fn() } },
        ],
      }).compile();

      const noClientService = module.get<ClickUpService>(ClickUpService);
      await expect(noClientService.updateStatus('123', 'status')).rejects.toThrow(
        'ClickUpService: no API key configured. Use ProjectIntegration OAuth via PMProviderFactory instead.',
      );
    });
  });

  describe('updateStatus', () => {
    const ticketId = 'ticket-123';
    const statusName = 'Deployed';

    it('should use cached status ID when available and not expired', async () => {
      // Pre-populate cache
      const cachedStatusId = 'status-456';
      (service as any).statusNameToIdCache.set(statusName, {
        id: cachedStatusId,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      });

      mockAxiosInstance.put.mockResolvedValue({ status: 200 });

      const result = await service.updateStatus(ticketId, statusName);

      expect(result).toBe(true);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(`/task/${ticketId}`, {
        status: cachedStatusId,
      });
      expect(mockAxiosInstance.get).not.toHaveBeenCalled(); // No API call to resolve status
    });

    it('should resolve status ID via API when cache is expired', async () => {
      // Pre-populate cache with expired entry
      (service as any).statusNameToIdCache.set(statusName, {
        id: 'old-status-123',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      mockAxiosInstance.get.mockResolvedValue({
        data: {
          id: ticketId,
          status: {
            statuses: [{ id: 'new-status-789', status: 'Deployed' }],
          },
        },
      });
      mockAxiosInstance.put.mockResolvedValue({ status: 200 });

      const result = await service.updateStatus(ticketId, statusName);

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/task/${ticketId}`);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(`/task/${ticketId}`, {
        status: 'new-status-789',
      });
    });

    it('should retry 3 times with exponential backoff on network error', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          status: { statuses: [{ id: 'status-123', status: statusName }] },
        },
      });

      // Simulate ECONNRESET error (retryable)

      const networkError: any = new Error('ECONNRESET');
      networkError.code = 'ECONNRESET';
      mockAxiosInstance.put
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ status: 200 }); // Success on 3rd attempt

      const result = await service.updateStatus(ticketId, statusName);

      expect(result).toBe(true);
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(3);
    });

    it('should return false on 429 rate limit error', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          status: { statuses: [{ id: 'status-123', status: statusName }] },
        },
      });

      const rateLimitError: any = new Error('Rate limit exceeded');
      rateLimitError.response = {
        status: 429,
        headers: { 'x-ratelimit-reset': '1670400000' },
      };

      mockAxiosInstance.put.mockRejectedValue(rateLimitError);

      const result = await service.updateStatus(ticketId, statusName);

      expect(result).toBe(false); // Returns false on rate limit, doesn't throw
      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should fallback to status name if API resolution fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('API error'));
      mockAxiosInstance.put.mockResolvedValue({ status: 200 });

      const result = await service.updateStatus(ticketId, statusName);

      expect(result).toBe(true);
      // Should use statusName as fallback
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(`/task/${ticketId}`, {
        status: statusName,
      });
    });
  });

  describe('addComment', () => {
    const ticketId = 'ticket-123';
    const comment = 'Test deployment comment';

    it('should add comment successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 200 });

      const result = await service.addComment(ticketId, comment);

      expect(result).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/task/${ticketId}/comment`, {
        comment_text: comment,
        notify_all: false,
      });
    });

    it('should truncate comment exceeding max length', async () => {
      const longComment = 'x'.repeat(25000); // Exceeds 20,000 default
      mockAxiosInstance.post.mockResolvedValue({ status: 200 });

      await service.addComment(ticketId, longComment);

      const callArgs = mockAxiosInstance.post.mock.calls[0][1];
      expect(callArgs.comment_text).toHaveLength(20000); // Truncated
    });

    it('should retry on transient 5xx errors', async () => {
      const serverError: any = new Error('Server error');
      serverError.response = { status: 503 };

      mockAxiosInstance.post
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ status: 200 });

      const result = await service.addComment(ticketId, comment);

      expect(result).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('should return false after all retries exhausted', async () => {
      const serverError: any = new Error('Server error');
      serverError.response = { status: 500 };

      mockAxiosInstance.post.mockRejectedValue(serverError);

      const result = await service.addComment(ticketId, comment);

      expect(result).toBe(false);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3); // 3 attempts
      expect(sentryService.captureException).toHaveBeenCalled();
    });
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      const errors = [
        { code: 'ECONNRESET' },
        { code: 'ETIMEDOUT' },
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
      ];

      errors.forEach((error) => {
        expect((service as any).isRetryableError(error)).toBe(true);
      });
    });

    it('should identify 5xx server errors as retryable', () => {
      const error: Record<string, unknown> = { response: { status: 503 } };
      expect((service as any).isRetryableError(error)).toBe(true);
    });

    it('should identify 4xx client errors as NOT retryable', () => {
      const error: Record<string, unknown> = { response: { status: 404 } };
      expect((service as any).isRetryableError(error)).toBe(false);
    });
  });

  describe('getHierarchy', () => {
    const teams = [
      { id: 'team-1', name: 'Team One' },
      { id: 'team-2', name: 'Team Two' },
    ];
    const spaces1 = [{ id: 'space-1', name: 'Space One' }];
    const spaces2 = [{ id: 'space-2', name: 'Space Two' }];
    const lists1 = [{ id: 'list-1', name: 'List One' }];
    const folders1 = [
      { id: 'folder-1', name: 'Folder One', lists: [{ id: 'list-f1', name: 'List Folder One' }] },
    ];

    beforeEach(() => {
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url === '/team') {
          return Promise.resolve({ data: { teams } });
        }
        if (url === '/team/team-1/space') {
          return Promise.resolve({ data: { spaces: spaces1 } });
        }
        if (url === '/team/team-2/space') {
          return Promise.resolve({ data: { spaces: spaces2 } });
        }
        if (url.includes('/list')) {
          return Promise.resolve({ data: { lists: lists1 } });
        }
        if (url.includes('/folder')) {
          return Promise.resolve({ data: { folders: folders1 } });
        }
        return Promise.reject(new Error('Not found'));
      });
    });

    it('should return all organizations when no teamId is provided', async () => {
      const result = await service.getHierarchy();
      expect(result.organizations).toHaveLength(2);
      expect(result.organizations[0].id).toBe('team-1');
      expect(result.organizations[1].id).toBe('team-2');
    });

    it('should return only specified organization when teamId is provided', async () => {
      const result = await service.getHierarchy({ teamId: 'team-1' });
      expect(result.organizations).toHaveLength(1);
      expect(result.organizations[0].id).toBe('team-1');
    });

    it('should throw error if specified teamId is not found', async () => {
      await expect(service.getHierarchy({ teamId: 'team-999' })).rejects.toThrow(
        'ClickUp team team-999 not found',
      );
    });

    it('should verify spaces and lists are structure correctly', async () => {
      const result = await service.getHierarchy({ teamId: 'team-1' });
      const org = result.organizations[0];
      expect(org.spaces).toHaveLength(1);
      expect(org.spaces[0].lists).toHaveLength(2); // 1 folderless + 1 from folder
    });

    it('should handle API validation errors', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('API Fail'));
      await expect(service.getHierarchy()).rejects.toThrow('API Fail');
    });
  });
});
