/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { PmWebhookRouterService } from './pm-webhook-router.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { WebhooksService } from '@/webhooks/webhooks.service';
import { LoggerService } from '@/common/logger/logger.service';
import { DevelopmentGateService } from '@/ticket-intake/services/development-gate.service';
import { PMProvider } from '@prisma/client';
import { getToken } from '@willsoto/nestjs-prometheus';
import { createHmac } from 'crypto';

const makeIntegration = (overrides: Record<string, unknown> = {}) => ({
  id: 'pi-1',
  project_id: 'proj-1',
  provider: PMProvider.CLICKUP,
  workspace_id: 'ws-123',
  webhook_id: 'wh-abc',
  webhook_secret: 'super-secret-key',
  webhook_enabled: true,
  ...overrides,
});

const signBody = (body: object, secret: string): { rawBody: string; signature: string } => {
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signature };
};

describe('PmWebhookRouterService', () => {
  let service: PmWebhookRouterService;
  let projectIntegrationService: jest.Mocked<Pick<ProjectIntegrationService, 'findByWebhookId'>>;
  let webhooksService: jest.Mocked<Pick<WebhooksService, 'processWebhook'>>;
  let logger: jest.Mocked<Pick<LoggerService, 'log' | 'warn' | 'error' | 'debug'>>;
  let developmentGate: jest.Mocked<Pick<DevelopmentGateService, 'check'>>;
  let invalidSignatureCounter: { inc: jest.Mock };

  beforeEach(async () => {
    projectIntegrationService = { findByWebhookId: jest.fn() };
    webhooksService = { processWebhook: jest.fn().mockResolvedValue({ success: true }) };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    developmentGate = { check: jest.fn().mockReturnValue({ allowed: true }) } as any;
    invalidSignatureCounter = { inc: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PmWebhookRouterService,
        { provide: ProjectIntegrationService, useValue: projectIntegrationService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: LoggerService, useValue: logger },
        { provide: DevelopmentGateService, useValue: developmentGate },
        {
          provide: getToken('pm_webhook_invalid_signature_total'),
          useValue: invalidSignatureCounter,
        },
      ],
    }).compile();

    service = module.get<PmWebhookRouterService>(PmWebhookRouterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleWebhook', () => {
    const correlationId = 'test-corr-id';
    const validBody = { webhook_id: 'wh-abc', event: 'taskCreated', task_id: 't-1' };

    // AC11 test 1 — unknown provider: unrecognized provider → silent return, no processing
    it('returns silently for unknown provider (no webhook_id extraction)', async () => {
      await service.handleWebhook(
        'UNKNOWN' as PMProvider,
        JSON.stringify(validBody),
        {},
        correlationId,
      );

      expect(projectIntegrationService.findByWebhookId).not.toHaveBeenCalled();
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // AC11 test 2 — unknown webhook_id: findByWebhookId returns null → silent return + warn
    it('returns silently when webhook_id not found in database', async () => {
      projectIntegrationService.findByWebhookId.mockResolvedValue(null);
      const rawBody = JSON.stringify(validBody);

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, {}, correlationId);

      expect(projectIntegrationService.findByWebhookId).toHaveBeenCalledWith('wh-abc');
      expect(logger.warn).toHaveBeenCalled();
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // AC11 test 3 — invalid signature: HMAC mismatch → silent return + counter increment
    it('returns silently and increments counter on invalid signature', async () => {
      const integration = makeIntegration({ webhook_secret: 'correct-secret' });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      const rawBody = JSON.stringify(validBody);
      const headers = { 'x-signature': 'deadbeefdeadbeef' };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(invalidSignatureCounter.inc).toHaveBeenCalledWith({
        provider: PMProvider.CLICKUP,
      });
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // AC11 test 4 — null webhook_secret: treat as unverifiable → silent return + counter increment
    it('increments counter and returns silently when webhook_secret is null', async () => {
      const integration = makeIntegration({ webhook_secret: null });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      const rawBody = JSON.stringify(validBody);
      const headers = { 'x-signature': 'any-sig' };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(invalidSignatureCounter.inc).toHaveBeenCalledWith({
        provider: PMProvider.CLICKUP,
      });
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // AC11 test 5 — webhook_enabled = false: valid signature but disabled → discarded, not forwarded
    it('discards event silently when webhook_enabled is false', async () => {
      const secret = 'my-secret';
      const integration = makeIntegration({ webhook_secret: secret, webhook_enabled: false });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      const { rawBody, signature } = signBody(validBody, secret);
      const headers = { 'x-signature': signature };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(invalidSignatureCounter.inc).not.toHaveBeenCalled();
      expect(developmentGate.check).not.toHaveBeenCalled();
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // CS1-6: Development gate — discard when gate rejects
    it('discards event silently when development gate rejects status', async () => {
      const secret = 'my-secret';
      const integration = makeIntegration({ webhook_secret: secret });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      developmentGate.check.mockReturnValue({ allowed: false, reason: 'status_mismatch' });

      const body = {
        webhook_id: 'wh-abc',
        event: 'taskUpdated',
        task_id: 't1',
        task: { status: { status: 'backlog' } },
      };
      const { rawBody, signature } = signBody(body, secret);
      const headers = { 'x-signature': signature };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(developmentGate.check).toHaveBeenCalled();
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });

    // CS1-6: AC9 test case 3 — payload missing task.status → taskStatus resolves to '', gate runs normally
    it('passes empty taskStatus to gate when payload has no task.status field', async () => {
      const secret = 'my-secret';
      const integration = makeIntegration({ webhook_secret: secret });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      // No task.status in payload
      const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
      const { rawBody, signature } = signBody(body, secret);
      const headers = { 'x-signature': signature };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      // Gate was called with empty taskStatus — allowed by default mock
      expect(developmentGate.check).toHaveBeenCalledWith(
        't1',
        '',
        expect.any(Object),
        'webhook',
        correlationId,
      );
      expect(webhooksService.processWebhook).toHaveBeenCalled();
    });

    // AC11 test 6 — valid ClickUp event: all guards pass → processWebhook called with correct payload
    it('calls processWebhook when all guards pass (valid ClickUp event)', async () => {
      const secret = 'valid-secret';
      const integration = makeIntegration({ webhook_secret: secret });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      const { rawBody, signature } = signBody(validBody, secret);
      const headers = { 'x-signature': signature };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(developmentGate.check).toHaveBeenCalled();
      expect(webhooksService.processWebhook).toHaveBeenCalled();
      expect(invalidSignatureCounter.inc).not.toHaveBeenCalled();
    });

    // AC11 test 7 — cross-tenant isolation: two concurrent integrations each use their own secrets
    it('isolates two concurrent integrations — each uses its own secret', async () => {
      const secret1 = 'secret-workspace-1';
      const secret2 = 'secret-workspace-2';
      const integration1 = makeIntegration({
        id: 'int-1',
        webhook_id: 'wh-1',
        webhook_secret: secret1,
      });
      const integration2 = makeIntegration({
        id: 'int-2',
        webhook_id: 'wh-2',
        webhook_secret: secret2,
      });

      projectIntegrationService.findByWebhookId.mockImplementation(async (id) =>
        id === 'wh-1' ? (integration1 as any) : (integration2 as any),
      );

      const body1 = { webhook_id: 'wh-1', event: 'taskUpdated', task_id: 't1' };
      const body2 = { webhook_id: 'wh-2', event: 'taskUpdated', task_id: 't2' };
      const { rawBody: raw1, signature: sig1 } = signBody(body1, secret1);
      const { rawBody: raw2, signature: sig2 } = signBody(body2, secret2);

      await Promise.all([
        service.handleWebhook(PMProvider.CLICKUP, raw1, { 'x-signature': sig1 }, 'corr-7a'),
        service.handleWebhook(PMProvider.CLICKUP, raw2, { 'x-signature': sig2 }, 'corr-7b'),
      ]);

      expect(webhooksService.processWebhook).toHaveBeenCalledTimes(2);
      // Verify isolation: if sig1 were used for int-2, HMAC would fail → counter would have been hit
      expect(invalidSignatureCounter.inc).not.toHaveBeenCalled();
    });

    // AC11 test 8 — counter increment: pm_webhook_invalid_signature_total incremented on HMAC mismatch
    it('increments pm_webhook_invalid_signature_total on HMAC mismatch', async () => {
      const integration = makeIntegration({ webhook_secret: 'real-secret' });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      const rawBody = JSON.stringify(validBody);
      const headers = { 'x-signature': 'wrong-sig' };

      await service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId);

      expect(invalidSignatureCounter.inc).toHaveBeenCalledWith({
        provider: PMProvider.CLICKUP,
      });
    });

    // AC11 test 9 — processWebhook throws: endpoint still returns without propagating error
    it('does not propagate error when processWebhook throws', async () => {
      const secret = 'valid-secret';
      const integration = makeIntegration({ webhook_secret: secret });
      projectIntegrationService.findByWebhookId.mockResolvedValue(integration as any);
      webhooksService.processWebhook.mockRejectedValue(new Error('DLQ failure'));
      const { rawBody, signature } = signBody(validBody, secret);
      const headers = { 'x-signature': signature };

      await expect(
        service.handleWebhook(PMProvider.CLICKUP, rawBody, headers, correlationId),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalled();
    });

    it('returns early without processing when webhook body is invalid JSON', async () => {
      await service.handleWebhook(PMProvider.CLICKUP, 'not-valid-json', {}, correlationId);

      expect(projectIntegrationService.findByWebhookId).not.toHaveBeenCalled();
      expect(webhooksService.processWebhook).not.toHaveBeenCalled();
    });
  });
});
