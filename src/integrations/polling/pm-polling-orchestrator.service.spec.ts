import { Test, TestingModule } from '@nestjs/testing';
import { PmPollingOrchestrator } from './pm-polling-orchestrator.service';
import { PrismaService } from '../../database/prisma.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { PMProviderFactory } from '../providers/pm-provider.factory';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { LoggerService } from '../../common/logger/logger.service';
import { PMProvider } from '@prisma/client';
import { TaskTriggerSource } from '../../ticket-intake/dto/task-event.dto';
import { DevelopmentGateService } from '../../ticket-intake/services/development-gate.service';
import { QUEUE_NAMES } from '../../rabbitmq/rabbitmq.config';

const makeRawIntegration = (overrides: Record<string, unknown> = {}) => ({
  id: 'int-1',
  project_id: 'proj-1',
  provider: PMProvider.CLICKUP,
  workspace_id: 'ws-1',
  polling_enabled: true,
  polling_interval_min: 15,
  polling_last_run_at: new Date(Date.now() - 20 * 60_000), // 20 min ago — due
  access_token: 'token',
  refresh_token: null,
  token_expiry: null,
  project: { id: 'proj-1', name: 'My Project' },
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  name: 'Build Feature',
  description: 'Do it',
  status: { id: '1', name: 'in progress', color: null, type: 'IN_PROGRESS' },
  url: 'https://app.clickup.com/t/task-1',
  listId: 'list-1',
  tags: [],
  customFields: {},
  dateUpdated: new Date().toISOString(),
  ...overrides,
});

describe('PmPollingOrchestrator', () => {
  let orchestrator: PmPollingOrchestrator;
  let prisma: jest.Mocked<PrismaService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let rabbitmq: jest.Mocked<RabbitMQService>;
  let metrics: jest.Mocked<MetricsService>;
  let sentry: jest.Mocked<SentryService>;
  let logger: jest.Mocked<LoggerService>;
  let developmentGate: jest.Mocked<DevelopmentGateService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PmPollingOrchestrator,
        {
          provide: PrismaService,
          useValue: {
            projectIntegration: { findMany: jest.fn() },
          },
        },
        {
          provide: ProjectIntegrationService,
          useValue: {
            getDecryptedIntegration: jest.fn(),
            updateIntegration: jest.fn(),
          },
        },
        {
          provide: PMProviderFactory,
          useValue: { getProvider: jest.fn() },
        },
        {
          provide: RabbitMQService,
          useValue: { publishToQueue: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { incrementCounter: jest.fn(), recordHistogram: jest.fn() },
        },
        {
          provide: SentryService,
          useValue: { captureException: jest.fn() },
        },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
        },
        {
          provide: DevelopmentGateService,
          useValue: { check: jest.fn().mockResolvedValue({ allowed: true }) },
        },
      ],
    }).compile();

    orchestrator = module.get<PmPollingOrchestrator>(PmPollingOrchestrator);
    prisma = module.get(PrismaService);
    integrationService = module.get(ProjectIntegrationService);
    providerFactory = module.get(PMProviderFactory);
    rabbitmq = module.get(RabbitMQService);
    metrics = module.get(MetricsService);
    sentry = module.get(SentryService);
    logger = module.get(LoggerService);
    developmentGate = module.get(DevelopmentGateService);
  });

  it('should be defined', () => {
    expect(orchestrator).toBeDefined();
  });

  // AC11 test case 1 — skips integration not yet due
  it('skips integration not yet due (5 min ago, 15 min interval)', async () => {
    const raw = makeRawIntegration({ polling_last_run_at: new Date(Date.now() - 5 * 60_000) });
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).not.toHaveBeenCalled();
    expect(integrationService.getDecryptedIntegration).not.toHaveBeenCalled();
  });

  // AC11 test case 2 — polls integration that is due
  it('polls integration that is due (20 min ago, 15 min interval)', async () => {
    const raw = makeRawIntegration();
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    const provider = { getUpdatedTasks: jest.fn().mockResolvedValue([]) };
    providerFactory.getProvider.mockResolvedValue(provider as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).toHaveBeenCalledWith(raw);
    expect(provider.getUpdatedTasks).toHaveBeenCalled();
  });

  // AC11 test case 3 — polls integration with null polling_last_run_at (first poll)
  it('polls integration with null polling_last_run_at (first poll — always due)', async () => {
    const raw = makeRawIntegration({ polling_last_run_at: null });
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    const provider = { getUpdatedTasks: jest.fn().mockResolvedValue([]) };
    providerFactory.getProvider.mockResolvedValue(provider as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(provider.getUpdatedTasks).toHaveBeenCalled();
    // since should be ~24h ago when polling_last_run_at is null
    const sinceArg: Date = provider.getUpdatedTasks.mock.calls[0][1];
    expect(Date.now() - sinceArg.getTime()).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
  });

  // AC11 test case 4 — publishes correct ITaskEvent with triggerSource POLLING
  it('publishes ITaskEvent with triggerSource POLLING and correct envelope', async () => {
    const raw = makeRawIntegration();
    const task = makeTask();
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([task]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);
    rabbitmq.publishToQueue.mockResolvedValue(undefined);

    await orchestrator.pollDueIntegrations();

    expect(rabbitmq.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.TICKET_INTAKE,
      expect.objectContaining({
        payload: expect.objectContaining({
          externalId: 'task-1',
          triggerSource: TaskTriggerSource.POLLING,
          projectIdentifier: 'list-1',
        }),
      }),
      expect.objectContaining({
        persistent: true,
        headers: { 'x-source': 'polling' },
      }),
    );
    expect(developmentGate.check).toHaveBeenCalled();
  });

  // CS1-6: AC10 test case 1 — gate blocks ALL tasks → publishToQueue never called
  it('does not publish any tasks when development gate blocks all of them', async () => {
    const raw = makeRawIntegration();
    const task1 = makeTask({
      id: 'task-1',
      status: { id: '1', name: 'backlog', color: null, type: 'custom' },
    });
    const task2 = makeTask({
      id: 'task-2',
      status: { id: '2', name: 'in progress', color: null, type: 'custom' },
    });

    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([task1, task2]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    developmentGate.check.mockResolvedValue({ allowed: false, reason: 'status_mismatch' });

    await orchestrator.pollDueIntegrations();

    expect(rabbitmq.publishToQueue).not.toHaveBeenCalled();
    expect(developmentGate.check).toHaveBeenCalledTimes(2);
  });

  // CS1-6: AC10 test case 3 — gate blocks all tasks (trigger_not_configured) → publishToQueue never called
  it('does not publish any tasks when gate returns trigger_not_configured for all tasks', async () => {
    const raw = makeRawIntegration();
    const task = makeTask({
      status: { id: '1', name: 'ready for ai', color: null, type: 'custom' },
    });

    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([task]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    developmentGate.check.mockResolvedValue({ allowed: false, reason: 'trigger_not_configured' });

    await orchestrator.pollDueIntegrations();

    expect(rabbitmq.publishToQueue).not.toHaveBeenCalled();
  });

  // CS1-6: Development gate — skips task when gate rejects
  it('skips individual task when development gate rejects status during polling', async () => {
    const raw = makeRawIntegration();
    const taskAllowed = makeTask({ id: 'task-allowed', status: { name: 'ready for ai' } });
    const taskRejected = makeTask({ id: 'task-rejected', status: { name: 'backlog' } });

    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([taskAllowed, taskRejected]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    // Mock gate: allow first, reject second
    developmentGate.check
      .mockResolvedValueOnce({ allowed: true, reason: 'allowed' })
      .mockResolvedValueOnce({ allowed: false, reason: 'status_mismatch' });

    await orchestrator.pollDueIntegrations();

    // Only one task should be published
    expect(rabbitmq.publishToQueue).toHaveBeenCalledTimes(1);
    expect(rabbitmq.publishToQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payload: expect.objectContaining({ externalId: 'task-allowed' }) }),
      expect.any(Object),
    );
    expect(developmentGate.check).toHaveBeenCalledTimes(2);
  });

  // AC11 test case 5 — updates polling_last_run_at after successful poll
  it('updates polling_last_run_at via ProjectIntegrationService after successful poll', async () => {
    const raw = makeRawIntegration();
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(integrationService.updateIntegration).toHaveBeenCalledWith('int-1', {
      polling_last_run_at: expect.any(Date),
    });
  });

  // AC11 test case 6 — does NOT update polling_last_run_at on provider error
  it('does NOT update polling_last_run_at on provider error', async () => {
    const raw = makeRawIntegration();
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockRejectedValue(new Error('Provider down'));

    await orchestrator.pollDueIntegrations();

    expect(integrationService.updateIntegration).not.toHaveBeenCalled();
  });

  // AC11 test case 7 — continues processing other integrations when one throws
  it('continues processing other integrations when one throws', async () => {
    const raw1 = makeRawIntegration({ id: 'int-1' });
    const raw2 = makeRawIntegration({ id: 'int-2' });
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw1, raw2]);
    integrationService.getDecryptedIntegration
      .mockResolvedValueOnce(raw1 as any)
      .mockResolvedValueOnce(raw2 as any);
    providerFactory.getProvider
      .mockRejectedValueOnce(new Error('Int 1 failed'))
      .mockResolvedValueOnce({ getUpdatedTasks: jest.fn().mockResolvedValue([]) } as any);
    integrationService.updateIntegration.mockResolvedValue(raw2 as any);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).toHaveBeenCalledTimes(2);
    expect(integrationService.updateIntegration).toHaveBeenCalledWith('int-2', expect.any(Object));
  });

  // AC11 test case 8 — calls Sentry on provider error
  it('captures exception in Sentry on provider error', async () => {
    const raw = makeRawIntegration();
    (prisma.projectIntegration.findMany as jest.Mock).mockResolvedValue([raw]);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    const providerError = new Error('Provider down');
    providerFactory.getProvider.mockRejectedValue(providerError);

    await orchestrator.pollDueIntegrations();

    expect(sentry.captureException).toHaveBeenCalledWith(providerError, expect.any(Object));
    expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_polling_errors_total', {
      provider: PMProvider.CLICKUP,
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
