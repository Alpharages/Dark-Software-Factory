/**
 * Story 20.1: WebhooksService Tests
 *
 * Unit tests for the enhanced Webhook Service with:
 * - Redis-based distributed deduplication (AC2, AC6)
 * - Status-based actionability filtering (AC3, AC4)
 * - Dead letter queue for failed events (AC5)
 * - ITaskEvent normalization (provider-agnostic)
 * - Comprehensive structured logging
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { WebhookDeduplicationService } from './services';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { WEBHOOK_METRICS, QUEUE_METRICS } from '../common/metrics/metrics.constants';
import { IClickUpWebhookPayload } from './interfaces';
import { StatusEvaluationService } from '../ticket-intake/services/status-evaluation.service';

// Helper to generate metric tokens
const getMetricToken = (name: string): string => `PROM_METRIC_${name.toUpperCase()}`;

// Mock dependencies
const mockPrisma = {
  auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
};

const mockRabbitMQ = {
  publishToQueue: jest.fn().mockResolvedValue(undefined),
  isHealthy: jest.fn().mockResolvedValue(true),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    const config: Record<string, unknown> = {
      'webhooks.maxRetries': 3,
      // Set to 0 so retry backoff tests don't wait real milliseconds in CI
      'webhooks.retryDelayMs': 0,
    };
    return config[key] ?? defaultValue;
  }),
};

const mockDeduplicationService = {
  checkAndSet: jest.fn(),
  isHealthy: jest.fn().mockResolvedValue(true),
  getBackendType: jest.fn().mockReturnValue('redis'),
  getStats: jest.fn().mockReturnValue({ backend: 'redis', inMemorySize: 0, dedupTtlMs: 300000 }),
};

const mockStatusEvaluationService = {
  evaluateStatus: jest.fn(),
};

const mockCounter = { inc: jest.fn() };
const mockHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };

describe('WebhooksService (Story 20.1)', () => {
  let service: WebhooksService;

  const validPayload: IClickUpWebhookPayload = {
    webhook_id: 'wh-123',
    event: 'taskCreated',
    task_id: 'task-456',
    task: {
      id: 'task-456',
      name: 'Test Task',
      description: 'Test description',
      text_content: 'Test content',
      status: { id: '1', status: 'in progress', color: '#000', type: 'custom', orderindex: 0 },
      orderindex: '0',
      date_created: '2025-01-01T00:00:00Z',
      date_updated: '2025-01-01T00:00:00Z',
      creator: { id: 1, username: 'test', color: '#000', email: 'test@test.com' },
      assignees: [],
      watchers: [],
      checklists: [],
      tags: [{ name: 'test-tag', tag_fg: '#fff', tag_bg: '#000' }],
      team_id: 'team-1',
      url: 'https://app.clickup.com/t/task-456',
      list: { id: 'list-1', name: 'Test List', access: true },
      project: { id: 'proj-1', name: 'Test Project', hidden: false, access: true },
      folder: { id: 'folder-1', name: 'Test Folder', hidden: false, access: true },
      space: { id: 'space-1' },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RabbitMQService, useValue: mockRabbitMQ },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WebhookDeduplicationService, useValue: mockDeduplicationService },
        { provide: StatusEvaluationService, useValue: mockStatusEvaluationService },
        // Metric providers using correct token format
        { provide: getMetricToken(WEBHOOK_METRICS.RECEIVED_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(WEBHOOK_METRICS.PROCESSED_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(WEBHOOK_METRICS.PROCESSING_DURATION), useValue: mockHistogram },
        { provide: getMetricToken(WEBHOOK_METRICS.ERRORS_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(WEBHOOK_METRICS.DUPLICATES_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(WEBHOOK_METRICS.FILTERED_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(WEBHOOK_METRICS.ACTIONABLE_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(QUEUE_METRICS.DEAD_LETTER_COUNT), useValue: mockCounter },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  afterEach(() => {
    if (service) {
      service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  describe('processWebhook', () => {
    beforeEach(() => {
      // Default mocks for successful processing
      mockDeduplicationService.checkAndSet.mockResolvedValue({
        isDuplicate: false,
        source: 'redis',
      });
      // CS1-1: evaluateStatus always returns non-actionable (pending CS1-3 ai_trigger_status gate)
      mockStatusEvaluationService.evaluateStatus.mockReturnValue({
        isActionable: false,
        internalStatus: 'QUEUED',
        reason: 'legacy status evaluation removed — pending CS1-3 ai_trigger_status gate',
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should process valid webhook but NOT queue (gated pending CS1-3)', async () => {
      const correlationId = 'corr-123';

      const result = await service.processWebhook(validPayload, correlationId);

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(result.correlationId).toBe(correlationId);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should deduplicate duplicate webhooks using Redis (AC2, AC6)', async () => {
      const correlationId = 'corr-123';
      mockDeduplicationService.checkAndSet.mockResolvedValue({
        isDuplicate: true,
        source: 'redis',
      });

      const result = await service.processWebhook(validPayload, correlationId);

      expect(result.willProcess).toBe(false);
      expect(result.message).toContain('Duplicate');
      expect(mockDeduplicationService.checkAndSet).toHaveBeenCalledWith('wh-123', correlationId);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should not queue any webhook (all statuses gated by CS1-3) (AC4)', async () => {
      const correlationId = 'corr-123';
      // Stub always returns isActionable: false — no override needed, using beforeEach default

      const result = await service.processWebhook(validPayload, correlationId);

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should acknowledge but not process non-PROCESSABLE_EVENTS event types (e.g. taskDeleted)', async () => {
      const unknownPayload: IClickUpWebhookPayload = {
        ...validPayload,
        webhook_id: 'wh-unknown',
        event: 'taskDeleted',
      };

      const result = await service.processWebhook(unknownPayload, 'corr-123');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should process taskUpdated events (but not queue — gated pending CS1-3)', async () => {
      const updatedPayload: IClickUpWebhookPayload = {
        ...validPayload,
        webhook_id: 'wh-updated',
        event: 'taskUpdated',
      };

      const result = await service.processWebhook(updatedPayload, 'corr-updated');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
    });

    it('should return correct correlationId and not publish (gated pending CS1-3)', async () => {
      const correlationId = 'corr-headers-test';

      const result = await service.processWebhook(validPayload, correlationId);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should handle missing task data gracefully', async () => {
      const minimalPayload: IClickUpWebhookPayload = {
        webhook_id: 'wh-minimal',
        event: 'taskCreated',
        task_id: 'task-minimal',
        // No task object
      };

      const result = await service.processWebhook(minimalPayload, 'corr-minimal');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
    });

    it('should return gated result without publishing for any event (CS1-1)', async () => {
      const correlationId = 'corr-normalize';

      const result = await service.processWebhook(validPayload, correlationId);

      // CS1-1: All webhooks gated pending CS1-3 ai_trigger_status
      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should accept payloads with custom fields without error (gated, not published)', async () => {
      const payloadWithCustomFields: IClickUpWebhookPayload = {
        ...validPayload,
        webhook_id: 'wh-custom',
        task: {
          ...validPayload.task!,
          custom_fields: [
            {
              id: 'cf-1',
              name: 'Priority',
              type: 'drop_down',
              type_config: {},
              value: 'High',
              date_created: '2025-01-01',
              hide_from_guests: false,
              required: false,
            },
          ],
        },
      };

      const result = await service.processWebhook(payloadWithCustomFields, 'corr-custom');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });

    it('should handle audit logging failures gracefully', async () => {
      mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('DB error'));

      const result = await service.processWebhook(validPayload, 'corr-audit-fail');

      // Should still return success even if audit logging fails (gated, not queued)
      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
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

    it('should return false when deduplication service is unhealthy', async () => {
      mockDeduplicationService.isHealthy.mockResolvedValueOnce(false);
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });
});
