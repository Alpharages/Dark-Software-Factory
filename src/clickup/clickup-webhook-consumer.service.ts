/**
 * ClickUp Webhook Consumer
 *
 * Processes webhook events from ClickUp (when enabled)
 * Validates webhook signatures and publishes to internal queues
 *
 * Features:
 * - Webhook signature verification
 * - Idempotency handling via webhook_id
 * - Event filtering (only process relevant events)
 * - Publishes to same queue as polling (unified processing)
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@/common/logger';
import { MetricsService } from '@/common/metrics';
import { SentryService } from '@/common/sentry';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { PrismaService } from '@/database/prisma.service';
import * as crypto from 'crypto';
import {
  IClickUpWebhookPayload,
  PROCESSABLE_EVENTS,
  ClickUpEventType,
} from '@/webhooks/interfaces/clickup-webhook.interface';

@Injectable()
export class ClickUpWebhookConsumer {
  private readonly WEBHOOK_SECRET: string;
  private readonly ENABLED: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {
    this.ENABLED = this.config.get<boolean>('CLICKUP_USE_WEBHOOKS', false);
    this.WEBHOOK_SECRET = this.config.get<string>('CLICKUP_WEBHOOK_SECRET', '');

    if (this.ENABLED && !this.WEBHOOK_SECRET) {
      this.logger.warn(
        'ClickUp webhooks enabled but CLICKUP_WEBHOOK_SECRET not configured!',
        'ClickUpWebhookConsumer',
      );
    }

    this.logger.log('ClickUp Webhook Consumer initialized', {
      enabled: this.ENABLED,
      hasSecret: !!this.WEBHOOK_SECRET,
    });
  }

  /**
   * Verify webhook signature from ClickUp
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.WEBHOOK_SECRET) {
      this.logger.warn('Cannot verify signature - no webhook secret configured');
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', this.WEBHOOK_SECRET);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      this.metrics.incrementCounter('clickup_webhook_signature_verification', {
        status: isValid ? 'valid' : 'invalid',
      });

      return isValid;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Signature verification failed', err.message);
      this.metrics.incrementCounter('clickup_webhook_signature_verification', {
        status: 'error',
      });
      return false;
    }
  }

  /**
   * Check if we've already processed this webhook (idempotency)
   */
  private async isWebhookProcessed(webhookId: string): Promise<boolean> {
    // Idempotency check: has this webhook been processed?
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookId },
    });

    return !!existing;
  }

  /**
   * Mark webhook as processed in database
   */
  private async markWebhookProcessed(
    webhookId: string,
    payload: IClickUpWebhookPayload,
  ): Promise<void> {
    // Store webhook event for idempotency
    await this.prisma.webhookEvent.create({
      data: {
        id: webhookId,
        source: 'clickup',
        event_type: payload.event,
        payload: payload as object,
        processed_at: new Date(),
      },
    });
  }

  /**
   * Process incoming ClickUp webhook
   */
  async processWebhook(
    payload: IClickUpWebhookPayload,
    signature?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.ENABLED) {
      return {
        success: false,
        message: 'Webhooks are disabled - use polling mode',
      };
    }

    const startTime = Date.now();

    try {
      // Verify signature if provided
      if (signature && this.WEBHOOK_SECRET) {
        const isValid = this.verifySignature(JSON.stringify(payload), signature);
        if (!isValid) {
          this.logger.warn('Invalid webhook signature', {
            webhookId: payload.webhook_id,
            event: payload.event,
          });

          this.metrics.incrementCounter('clickup_webhook_processed', {
            status: 'invalid_signature',
            event: payload.event,
          });

          return {
            success: false,
            message: 'Invalid signature',
          };
        }
      }

      // Check idempotency
      const alreadyProcessed = await this.isWebhookProcessed(payload.webhook_id);
      if (alreadyProcessed) {
        this.logger.debug('Webhook already processed (idempotent)', {
          webhookId: payload.webhook_id,
        });

        this.metrics.incrementCounter('clickup_webhook_processed', {
          status: 'duplicate',
          event: payload.event,
        });

        return {
          success: true,
          message: 'Already processed (idempotent)',
        };
      }

      // Check if event is processable
      const isProcessable = PROCESSABLE_EVENTS.includes(payload.event as ClickUpEventType);

      if (!isProcessable) {
        this.logger.debug('Webhook event not processable, acknowledging', {
          webhookId: payload.webhook_id,
          event: payload.event,
        });

        await this.markWebhookProcessed(payload.webhook_id, payload);

        this.metrics.incrementCounter('clickup_webhook_processed', {
          status: 'ignored',
          event: payload.event,
        });

        return {
          success: true,
          message: 'Event acknowledged but not processed',
        };
      }

      // Publish to same queue as polling for unified processing
      // Wrap message with messageId, correlationId, payload per RabbitMQConsumerBase contract
      const messageId = `webhook-${payload.webhook_id}`;

      await this.rabbitmq.publishToQueue(
        'clickup-task-updated-queue',
        {
          messageId,
          correlationId: messageId,
          payload: {
            task_id: payload.task_id,
            name: payload.task?.name,
            status: payload.task?.status?.status,
            date_updated: payload.task?.date_updated,
            assignees: payload.task?.assignees,
            custom_fields: payload.task?.custom_fields,
            source: 'webhook',
            webhookId: payload.webhook_id,
            eventType: payload.event,
            receivedAt: new Date().toISOString(),
          },
        },
        {
          persistent: true,
          correlationId: messageId,
          headers: {
            'x-source': 'webhook',
            'x-webhook-id': payload.webhook_id,
            'x-task-id': payload.task_id,
            'x-event-type': payload.event,
          },
        },
      );

      // Mark as processed
      await this.markWebhookProcessed(payload.webhook_id, payload);

      const duration = Date.now() - startTime;

      this.logger.log('Webhook processed successfully', {
        webhookId: payload.webhook_id,
        event: payload.event,
        taskId: payload.task_id,
        duration,
      });

      this.metrics.incrementCounter('clickup_webhook_processed', {
        status: 'success',
        event: payload.event,
      });

      this.metrics.recordHistogram('clickup_webhook_processing_duration_seconds', duration / 1000, {
        event: payload.event,
      });

      return {
        success: true,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - startTime;

      this.logger.error('Failed to process webhook', err.stack || err.message, {
        webhookId: payload.webhook_id,
        event: payload.event,
        duration,
      });

      this.sentry.captureException(err, {
        tags: { operation: 'clickup_webhook_processing' },
        extra: {
          webhookId: payload.webhook_id,
          event: payload.event,
          taskId: payload.task_id,
        },
      });

      this.metrics.incrementCounter('clickup_webhook_processed', {
        status: 'error',
        event: payload.event,
      });

      return {
        success: false,
        message: `Processing failed: ${err.message}`,
      };
    }
  }

  /**
   * Health check: verify webhook configuration
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!this.ENABLED) {
      return {
        healthy: true,
        message: 'Webhooks disabled - polling mode active',
      };
    }

    if (!this.WEBHOOK_SECRET) {
      return {
        healthy: false,
        message: 'Webhook secret not configured',
      };
    }

    return {
      healthy: true,
      message: 'Webhook consumer ready',
    };
  }
}
