import { Module } from '@nestjs/common';
import { PmWebhookController } from './pm-webhook.controller';
import { PmWebhookRouterService } from './pm-webhook-router.service';
import { IntegrationsModule } from '../integrations.module';
import { WebhooksModule } from '@/webhooks/webhooks.module';
import { DevelopmentGateModule } from '@/ticket-intake/services/development-gate.module';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [IntegrationsModule, WebhooksModule, DevelopmentGateModule],
  controllers: [PmWebhookController],
  providers: [
    PmWebhookRouterService,
    makeCounterProvider({
      name: 'pm_webhook_invalid_signature_total',
      help: 'Total number of webhook requests rejected due to invalid HMAC signature',
      labelNames: ['provider'],
    }),
  ],
})
export class PmWebhookModule {}
