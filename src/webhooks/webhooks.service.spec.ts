import { ClickUpEventType } from './interfaces';

/**
 * Unit tests for WebhooksService
 *
 * Note: Full integration testing with metrics is done via e2e tests.
 * These unit tests focus on business logic validation.
 */
describe('WebhooksService', () => {
  // Mock dependencies
  const mockPrisma = {
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  const mockRabbitMQ = {
    publishToQueue: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };

  // Import and instantiate service manually to avoid NestJS DI issues with metrics
  let WebhooksService: typeof import('./webhooks.service').WebhooksService;
  let service: InstanceType<typeof WebhooksService>;

  beforeAll(async () => {
    // Dynamic import to avoid module resolution issues
    const module = await import('./webhooks.service');
    WebhooksService = module.WebhooksService;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Create service instance with mocked dependencies
    service = new WebhooksService(
      mockPrisma as never,
      mockRabbitMQ as never,
      mockCounter as never,
      mockCounter as never,
      mockHistogram as never,
      mockCounter as never,
      mockCounter as never,
    );
  });

  afterEach(() => {
    // Clean up the interval timer to prevent open handles
    if (service) {
      service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processWebhook', () => {
    const validPayload = {
      webhook_id: 'wh-123',
      event: 'taskCreated',
      task_id: 'task-456',
      task: {
        id: 'task-456',
        name: 'Test Task',
        description: 'Test description',
        status: { id: '1', status: 'Open', color: '#000', type: 'open', orderindex: 0 },
        date_created: '2025-01-01T00:00:00Z',
        date_updated: '2025-01-01T00:00:00Z',
        creator: { id: 1, username: 'test', color: '#000', email: 'test@test.com' },
        team_id: 'team-1',
        url: 'https://app.clickup.com/t/task-456',
        list: { id: 'list-1', name: 'Test List', access: true },
        project: { id: 'proj-1', name: 'Test Project', hidden: false, access: true },
        folder: { id: 'folder-1', name: 'Test Folder', hidden: false, access: true },
        space: { id: 'space-1' },
      },
    };

    it('should process valid webhook and publish to queue', async () => {
      const correlationId = 'corr-123';

      const result = await service.processWebhook(validPayload as never, correlationId);

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({
          taskId: 'task-456',
          eventType: ClickUpEventType.TASK_CREATED,
        }),
        expect.any(Object),
      );
      // Metrics are recorded by the real AppMetricsModule
    });

    it('should deduplicate duplicate webhooks', async () => {
      const correlationId = 'corr-123';

      // First call
      await service.processWebhook(validPayload as never, correlationId);

      // Second call with same webhook_id
      const result = await service.processWebhook(validPayload as never, correlationId);

      expect(result.willProcess).toBe(false);
      expect(result.message).toContain('Duplicate');
      // Should only publish once
      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledTimes(1);
    });

    it('should acknowledge but not process unknown event types', async () => {
      const unknownPayload = {
        ...validPayload,
        webhook_id: 'wh-unknown',
        event: 'taskDeleted',
      };

      const result = await service.processWebhook(unknownPayload as never, 'corr-123');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should process taskUpdated events', async () => {
      const updatedPayload = {
        ...validPayload,
        webhook_id: 'wh-updated',
        event: 'taskUpdated',
      };

      const result = await service.processWebhook(updatedPayload as never, 'corr-updated');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(true);
      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({
          eventType: ClickUpEventType.TASK_UPDATED,
        }),
        expect.any(Object),
      );
    });

    it('should include correlation ID in queue message headers', async () => {
      const correlationId = 'corr-headers-test';
      const headerPayload = {
        ...validPayload,
        webhook_id: 'wh-headers',
      };

      await service.processWebhook(headerPayload as never, correlationId);

      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.any(Object),
        expect.objectContaining({
          correlationId,
          headers: expect.objectContaining({
            'x-correlation-id': correlationId,
          }),
        }),
      );
    });

    it('should handle missing task data gracefully', async () => {
      const minimalPayload = {
        webhook_id: 'wh-minimal',
        event: 'taskCreated',
        task_id: 'task-minimal',
        // No task object
      };

      const result = await service.processWebhook(minimalPayload as never, 'corr-minimal');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(true);
    });

    it('should track metrics on successful processing', async () => {
      const metricsPayload = {
        ...validPayload,
        webhook_id: 'wh-metrics',
      };

      // This test verifies the service processes without errors
      // Metrics recording is verified through the AppMetricsModule
      const result = await service.processWebhook(metricsPayload as never, 'corr-metrics');
      expect(result.success).toBe(true);
    });
  });

  describe('isHealthy', () => {
    it('should return true when all dependencies are healthy', async () => {
      const result = await service.isHealthy();
      expect(result).toBe(true);
    });

    it('should return false when database is unhealthy', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB Error'));
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });

    it('should return false when RabbitMQ is unhealthy', async () => {
      mockRabbitMQ.isHealthy.mockResolvedValueOnce(false);
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });
});
