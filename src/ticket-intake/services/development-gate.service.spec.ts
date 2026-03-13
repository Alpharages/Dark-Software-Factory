/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DevelopmentGateService } from './development-gate.service';
import { LoggerService } from '@/common/logger/logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { IntegrationProvider } from '@prisma/client';

describe('DevelopmentGateService', () => {
  let service: DevelopmentGateService;
  let logger: jest.Mocked<LoggerService>;
  let metrics: jest.Mocked<MetricsService>;

  const mockIntegration: any = {
    id: 'int-123',
    project_id: 'proj-1',
    provider: IntegrationProvider.CLICKUP,
    workspace_id: 'ws-1',
    webhook_id: 'wh-1',
    webhook_secret: 'secret',
    webhook_enabled: true,
    polling_enabled: false,
    polling_interval_min: 5,
    polling_last_run_at: null,
    ai_trigger_status: 'ready for ai', // normalized is 'ready for ai'
    bot_user_id: 'bot-1',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    const mockLogger = {
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };
    const mockMetrics = {
      incrementCounter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevelopmentGateService,
        { provide: LoggerService, useValue: mockLogger },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<DevelopmentGateService>(DevelopmentGateService);
    logger = module.get(LoggerService);
    metrics = module.get(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('check', () => {
    it('should ALLOW when status matches trigger status (case-insensitive, trimmed)', () => {
      const result = service.check(
        'task-1',
        ' READY FOR AI ',
        mockIntegration,
        'webhook',
        'corr-1',
      );

      expect(result.allowed).toBe(true);
      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should REJECT and log warn when ai_trigger_status is missing', () => {
      const integrationNoTrigger = { ...mockIntegration, ai_trigger_status: null };

      const result = service.check(
        'task-1',
        'any',
        integrationNoTrigger as any,
        'webhook',
        'corr-1',
      );

      expect(result.allowed).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no ai_trigger_status configured'),
        expect.any(Object),
      );
      expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_tasks_dropped_no_trigger_total', {
        provider: IntegrationProvider.CLICKUP,
        project_id: 'proj-1',
      });
    });

    it('should REJECT and log debug when status does not match trigger status (webhook — polling counter NOT incremented)', () => {
      const result = service.check(
        'task-1',
        'in progress',
        mockIntegration as any,
        'webhook',
        'corr-1',
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('status_mismatch');
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('not at trigger'),
        expect.any(Object),
      );
      expect(metrics.incrementCounter).not.toHaveBeenCalled();
    });

    it('should increment pm_polling_tasks_skipped_total for polling when status mismatch', () => {
      service.check('task-1', 'backlog', mockIntegration as any, 'polling', 'corr-1');

      expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_polling_tasks_skipped_total', {
        provider: IntegrationProvider.CLICKUP,
        project_id: 'proj-1',
      });
    });

    it('should increment pm_tasks_dropped_no_trigger_total for webhooks when trigger missing', () => {
      const integrationNoTrigger = { ...mockIntegration, ai_trigger_status: '' };

      service.check('task-1', 'any', integrationNoTrigger as any, 'webhook', 'corr-1');

      expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_tasks_dropped_no_trigger_total', {
        provider: IntegrationProvider.CLICKUP,
        project_id: 'proj-1',
      });
    });

    it('should increment pm_polling_tasks_skipped_total for polling when trigger missing', () => {
      const integrationNoTrigger = { ...mockIntegration, ai_trigger_status: '' };

      service.check('task-1', 'any', integrationNoTrigger as any, 'polling', 'corr-1');

      expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_tasks_dropped_no_trigger_total', {
        provider: IntegrationProvider.CLICKUP,
        project_id: 'proj-1',
      });
    });

    it('should handle different providers', () => {
      const githubIntegration = { ...mockIntegration, provider: 'GITHUB' as any };

      const result = service.check(
        'task-1',
        'ready for ai',
        githubIntegration as any,
        'webhook',
        'corr-1',
      );

      expect(result.allowed).toBe(true);
    });
  });
});
