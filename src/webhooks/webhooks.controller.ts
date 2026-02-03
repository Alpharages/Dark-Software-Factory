import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Get,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { ClickUpWebhookDto, WebhookResponseDto } from './dto';
import { Public } from '../common/decorators';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { IClickUpWebhookPayload, IClickUpTask, IClickUpHistoryItem } from './interfaces';

/**
 * Maps validated ClickUpWebhookDto to IClickUpWebhookPayload interface
 *
 * Note: DTO validation via class-validator ensures the data structure is valid.
 * The cast is safe because validation has already occurred.
 */
function mapDtoToPayload(dto: ClickUpWebhookDto): IClickUpWebhookPayload {
  return {
    webhook_id: dto.webhook_id,
    event: dto.event,
    task_id: dto.task_id,
    task: dto.task as IClickUpTask | undefined,
    history_items: dto.history_items as IClickUpHistoryItem[] | undefined,
  };
}

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
@Controller('webhooks')
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
    description: 'Webhook acknowledged and queued for processing',
    type: WebhookResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid webhook payload' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async handleClickUpWebhook(
    @Body() payload: ClickUpWebhookDto,
    @CorrelationId() correlationId: string,
  ): Promise<WebhookResponseDto> {
    this.logger.log(
      `[${correlationId}] Received ClickUp webhook: ${payload.event} for task ${payload.task_id}`,
    );

    try {
      // Process the webhook with type-safe mapping
      const response = await this.webhooksService.processWebhook(
        mapDtoToPayload(payload),
        correlationId,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Error processing webhook: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Categorize errors for appropriate HTTP responses
      const err = error as Error;

      // Validation errors -> 400 Bad Request
      if (err.name === 'ValidationError' || err.message.includes('validation')) {
        throw new BadRequestException(`Invalid webhook payload: ${err.message}`);
      }

      // System errors -> 500 Internal Server Error
      // Let NestJS handle this as a 500
      throw new InternalServerErrorException(`Webhook processing failed: ${err.message}`);
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
