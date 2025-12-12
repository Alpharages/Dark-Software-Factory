/**
 * ClickUp Webhook Controller
 *
 * REST endpoint for receiving ClickUp webhook events
 * Validates signatures and delegates to webhook consumer
 */

import { Controller, Post, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { ClickUpWebhookConsumer } from './clickup-webhook-consumer.service';
import { ClickUpWebhookDto } from '../webhooks/dto/clickup-webhook.dto';
import {
  IClickUpWebhookPayload,
  IClickUpTask,
  IClickUpHistoryItem,
} from '../webhooks/interfaces/clickup-webhook.interface';

@ApiTags('webhooks')
@Controller('webhooks/clickup')
export class ClickUpWebhookController {
  constructor(private readonly webhookConsumer: ClickUpWebhookConsumer) {}

  /**
   * ClickUp webhook endpoint
   * Receives events from ClickUp when configured
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive ClickUp webhook event',
    description: 'Processes webhook events from ClickUp (task created, updated, etc.)',
  })
  @ApiHeader({
    name: 'X-Signature',
    description: 'ClickUp webhook signature for verification',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid signature or payload',
  })
  async handleWebhook(
    @Body() payload: ClickUpWebhookDto,
    @Headers('x-signature') signature?: string,
  ): Promise<{ success: boolean; message: string }> {
    // Convert DTO to interface format
    const webhookPayload: IClickUpWebhookPayload = {
      webhook_id: payload.webhook_id,
      event: payload.event,
      task_id: payload.task_id,
      task: payload.task as unknown as IClickUpTask,
      history_items: payload.history_items as unknown as IClickUpHistoryItem[],
    };

    return this.webhookConsumer.processWebhook(webhookPayload, signature);
  }

  /**
   * Health check endpoint for webhook receiver
   */
  @Post('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook health check',
    description: 'Verifies webhook configuration and readiness',
  })
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    return this.webhookConsumer.healthCheck();
  }
}
