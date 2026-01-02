import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { ClickUpWebhookDto, WebhookResponseDto } from './dto';
import { Public } from '../common/decorators';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { IClickUpWebhookPayload } from './interfaces';

/**
 * ClickUp Webhook Controller
 *
 * Per architecture.md:
 * - Webhook endpoint: POST /webhooks/clickup (secured with signature verification)
 * - POST /api/v1/webhooks/clickup
 * - Rate limit: 100 requests/minute (handled by global throttler)
 *
 * Per FR56: System can receive ClickUp webhook events (task created, updated)
 */
@ApiTags('webhooks')
@Controller('api/v1/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * ClickUp Webhook Endpoint
   *
   * Receives webhook events from ClickUp when tasks are created/updated.
   *
   * Authentication: Signature verification (not JWT)
   * Rate Limit: 100 requests/minute (per NFR)
   * Response Time: <5 seconds (per NFR-P1)
   *
   * @param payload - ClickUp webhook payload
   * @param correlationId - Auto-generated correlation ID
   * @returns Acknowledgment response
   */
  @Public() // Webhooks bypass JWT auth - use signature verification instead
  @UseGuards(WebhookSignatureGuard)
  @Post('clickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive ClickUp webhook events' })
  @ApiHeader({
    name: 'x-signature',
    description: 'HMAC-SHA256 webhook signature',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook acknowledged',
    type: WebhookResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async handleClickUpWebhook(
    @Body() payload: ClickUpWebhookDto,
    @CorrelationId() correlationId: string,
  ): Promise<WebhookResponseDto> {
    this.logger.log(
      `[${correlationId}] Received ClickUp webhook: ${payload.event} for task ${payload.task_id}`,
    );

    try {
      // Process the webhook
      const response = await this.webhooksService.processWebhook(
        payload as unknown as IClickUpWebhookPayload,
        correlationId,
      );

      return response;
    } catch (_error) {
      this.logger.error(
        `[${correlationId}] Error processing webhook: ${(_error as Error).message}`,
        (_error as Error).stack,
      );

      // Still return 200 to prevent ClickUp retries on processing errors
      // Log the error for investigation
      const response = new WebhookResponseDto();
      response.success = true;
      response.message = 'Webhook received but processing failed';
      response.correlationId = correlationId;
      response.willProcess = false;
      response.timestamp = new Date().toISOString();

      return response;
    }
  }

  /**
   * Webhook Health Check
   *
   * Used by ClickUp to verify endpoint is reachable during setup.
   * Also useful for internal monitoring.
   */
  @Public()
  @Get('clickup/health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook health check' })
  @ApiResponse({
    status: 200,
    description: 'Webhook endpoint health status',
  })
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const isHealthy = await this.webhooksService.isHealthy();

    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
    };
  }
}
