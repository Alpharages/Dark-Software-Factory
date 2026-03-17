import { Controller, Post, Param, Req, Headers, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PmWebhookRouterService } from './pm-webhook-router.service';
import { PMProvider } from '@prisma/client';
import { Public } from '@/common/decorators';
import { CorrelationId } from '@/common/decorators/correlation-id.decorator';

@ApiTags('pm-webhooks')
@Controller('integrations/webhooks')
export class PmWebhookController {
  constructor(private readonly webhookRouterService: PmWebhookRouterService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider-agnostic multi-tenant webhook entry point' })
  @ApiHeader({ name: 'x-signature', description: 'HMAC-SHA256 signature', required: false })
  @ApiResponse({ status: 200, description: 'Webhook received (always 200 regardless of validity)' })
  async handleWebhook(
    @Param('provider') provider: string,
    @Req() request: FastifyRequest,
    @Headers() headers: Record<string, string | string[]>,
    @CorrelationId() correlationId: string,
  ): Promise<{ received: boolean }> {
    const providerEnum = this.mapProvider(provider);
    if (!providerEnum) {
      // Return 200 even for unknown providers to prevent enumeration
      return { received: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (request as any).rawBody as string;

    // Await so errors are logged; service wraps processWebhook in try/catch
    await this.webhookRouterService.handleWebhook(providerEnum, rawBody, headers, correlationId);

    return { received: true };
  }

  @Public()
  @Get(':provider/health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook health check' })
  async healthCheck(
    @Param('provider') provider: string,
  ): Promise<{ status: string; provider: string; timestamp: string }> {
    return { status: 'ok', provider, timestamp: new Date().toISOString() };
  }

  private mapProvider(provider: string): PMProvider | null {
    const upper = provider.toUpperCase();
    if (Object.values(PMProvider).includes(upper as PMProvider)) {
      return upper as PMProvider;
    }
    return null;
  }
}
