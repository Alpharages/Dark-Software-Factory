import { Test, TestingModule } from '@nestjs/testing';
import { ClickUpTaskUpdateConsumer } from './clickup-task-update.consumer';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { ClickUpService } from './clickup.service';
import { ConfigService } from '@nestjs/config';
import { ProjectIntegrationService } from '../integrations/project-integration.service';
import { DependencySyncService } from '@/dependencies/dependency-sync.service';

describe('ClickUpTaskUpdateConsumer', () => {
  let consumer: ClickUpTaskUpdateConsumer;

  const mockRabbitMQService = {
    getChannel: jest.fn(),
  };

  const mockPrismaService = {
    project: {
      findFirst: jest.fn(),
    },
    ticket: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockLoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
    recordHistogram: jest.fn(),
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  const mockAuditLogService = {
    logAction: jest.fn(),
  };

  const mockClickUpService = {
    getTask: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockIntegrationService = {
    findByProjectAndProvider: jest.fn(),
  };

  const mockDependencySyncService = {
    syncDependencies: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClickUpTaskUpdateConsumer,
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: SentryService, useValue: mockSentryService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ProjectIntegrationService, useValue: mockIntegrationService },
        { provide: DependencySyncService, useValue: mockDependencySyncService },
      ],
    }).compile();

    consumer = module.get<ClickUpTaskUpdateConsumer>(ClickUpTaskUpdateConsumer);

    jest.clearAllMocks();
  });

  describe('handleTaskUpdate', () => {
    const mockMessage = {
      task_id: 'task123',
      name: 'Test Task',
      status: 'In Review',
      source: 'webhook' as const,
    };

    const mockProject = { id: 'proj1' };

    it('should discard task if no project is found', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(null);

      const result = await (consumer as any).handleTaskUpdate(mockMessage);

      expect(result).toBeUndefined();
      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('No project found'),
        expect.any(Object),
      );
    });

    it('should discard task if project has no CLICKUP integration', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(mockProject);
      mockIntegrationService.findByProjectAndProvider.mockResolvedValue(null);

      await (consumer as any).handleTaskUpdate(mockMessage);

      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('project has no CLICKUP integration'),
        expect.any(Object),
      );
      expect(mockPrismaService.ticket.findUnique).not.toHaveBeenCalled();
    });

    it('should discard task if ai_trigger_status is not configured', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(mockProject);
      mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
        id: 'int1',
        ai_trigger_status: null,
      });

      await (consumer as any).handleTaskUpdate(mockMessage);

      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('has no ai_trigger_status configured'),
        expect.any(Object),
      );
    });

    it('should discard task if status does not match ai_trigger_status (case-insensitive)', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(mockProject);
      mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
        id: 'int1',
        ai_trigger_status: 'Ready for AI',
      });

      await (consumer as any).handleTaskUpdate(mockMessage);

      expect(mockLoggerService.debug).toHaveBeenCalledWith(
        expect.stringContaining("status 'In Review' — not at trigger 'Ready for AI'"),
      );
      expect(mockPrismaService.ticket.findUnique).not.toHaveBeenCalled();
    });

    it('should proceed if status matches ai_trigger_status (exact match)', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(mockProject);
      mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
        id: 'int1',
        ai_trigger_status: 'In Review', // same case as message.status
      });

      mockPrismaService.ticket.findUnique.mockResolvedValue({ id: 't1', executions: [] });

      await (consumer as any).handleTaskUpdate(mockMessage);

      expect(mockPrismaService.ticket.findUnique).toHaveBeenCalledWith({
        where: { clickup_task_id: mockMessage.task_id },
        include: { executions: true },
      });
    });

    it('should proceed if status matches ai_trigger_status case-insensitively', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(mockProject);
      mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
        id: 'int1',
        ai_trigger_status: 'in review', // lowercase — message.status is 'In Review'
      });

      mockPrismaService.ticket.findUnique.mockResolvedValue({ id: 't1', executions: [] });

      await (consumer as any).handleTaskUpdate({ ...mockMessage, status: 'IN REVIEW' });

      expect(mockPrismaService.ticket.findUnique).toHaveBeenCalledWith({
        where: { clickup_task_id: mockMessage.task_id },
        include: { executions: true },
      });
    });
  });
});
