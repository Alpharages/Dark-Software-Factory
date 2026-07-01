import { Injectable } from '@nestjs/common';
import { ProjectIntegrationService } from '../project-integration.service';
import { WebhooksService } from '@/webhooks/webhooks.service';
import { LoggerService } from '@/common/logger/logger.service';
import { DevelopmentGateService } from '@/ticket-intake/services/development-gate.service';
import { PMProvider, ProjectIntegration } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { IClickUpWebhookPayload } from '@/webhooks/interfaces';

@Injectable()
export class PmWebhookRouterService {
  constructor(
    private readonly projectIntegrationService: ProjectIntegrationService,
    private readonly webhooksService: WebhooksService,
    private readonly logger: LoggerService,
    private readonly developmentGate: DevelopmentGateService,
    @InjectMetric('pm_webhook_invalid_signature_total')
    private readonly invalidSignatureCounter: Counter,
  ) {}

  async handleWebhook(
    provider: PMProvider,
    rawBody: string,
    headers: Record<string, string | string[]>,
    correlationId: string,
  ): Promise<void> {
    const webhookId = this.extractWebhookId(provider, rawBody);
    if (!webhookId) {
      this.logger.warn(
        `[${correlationId}] Could not extract webhook_id for provider ${provider} — discarding`,
        { provider, correlationId },
      );
      return;
    }

    const integration = await this.projectIntegrationService.findByWebhookId(webhookId);
    if (!integration) {
      this.logger.warn(
        `[${correlationId}] Unknown webhook_id "${webhookId}" (provider: ${provider}) — discarding`,
        { provider, webhookId, correlationId },
      );
      return;
    }

    // Step 1: Verify HMAC signature BEFORE checking webhook_enabled (security gate first — AC4)
    const signature = this.getHeader(headers, 'x-signature');
    const isValid = this.verifySignature(rawBody, signature, integration);
    if (!isValid) {
      this.logger.warn(
        `[${correlationId}] Webhook signature mismatch for integration ${integration.id} (provider: ${integration.provider}, workspace: ${integration.workspace_id})`,
        {
          integrationId: integration.id,
          provider: integration.provider,
          workspaceId: integration.workspace_id,
        },
      );
      this.invalidSignatureCounter.inc({ provider: integration.provider });
      return;
    }

    // Step 2: Check webhook_enabled gate — after signature passes (AC5)
    if (!integration.webhook_enabled) {
      this.logger.debug(
        `[${correlationId}] Webhook disabled for integration ${integration.id} — discarding`,
      );
      return;
    }

    // Step 2.5: CS1-6 Development Gate — check ai_trigger_status
    // Parse once — reused for gate AND passed to processWebhook below
    const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    const taskId = typeof parsedBody['task_id'] === 'string' ? parsedBody['task_id'] : 'unknown';
    const taskStatusRaw = (parsedBody['task'] as Record<string, unknown> | undefined)?.['status'];
    const taskStatus =
      typeof taskStatusRaw === 'object' && taskStatusRaw !== null
        ? (((taskStatusRaw as Record<string, unknown>)['status'] as string) ?? '')
        : '';

    const gateDecision = await this.developmentGate.check(
      taskId,
      taskStatus,
      integration,
      'webhook',
      correlationId,
    );
    if (!gateDecision.allowed) {
      return; // silently discard — no error, no retry
    }

    // Step 3: Route to existing WebhooksService — reuse deduplication, DLQ, and metrics (AC6)
    try {
      await this.webhooksService.processWebhook(
        parsedBody as unknown as IClickUpWebhookPayload,
        correlationId,
      );
    } catch (err) {
      this.logger.error(
        `[${correlationId}] processWebhook threw for integration ${integration.id} — acknowledging to prevent webhook replay`,
        err instanceof Error ? err.stack : String(err),
        { integrationId: integration.id, provider: integration.provider },
      );
    }
  }

  private extractWebhookId(provider: PMProvider, rawBody: string): string | null {
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      switch (provider) {
        case PMProvider.CLICKUP:
          return typeof body['webhook_id'] === 'string' ? body['webhook_id'] : null;
        default:
          return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to parse webhook body: ${message}`);
      return null;
    }
  }

  private verifySignature(
    rawBody: string,
    signature: string | undefined,
    integration: ProjectIntegration,
  ): boolean {
    const secret = integration.webhook_secret;
    if (!secret) {
      this.logger.warn(
        `Webhook signature unverifiable for integration ${integration.id} — no webhook_secret configured`,
      );
      return false;
    }
    if (!signature) {
      return false;
    }

    try {
      const hmac = createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');

      const sigBuffer = Buffer.from(signature, 'utf8');
      const digestBuffer = Buffer.from(digest, 'utf8');

      if (sigBuffer.length !== digestBuffer.length) return false;
      return timingSafeEqual(sigBuffer, digestBuffer);
    } catch {
      return false;
    }
  }

  private getHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
  }
}
