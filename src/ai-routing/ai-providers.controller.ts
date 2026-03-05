import { Controller, Get, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ProviderHealthService } from './provider-health.service';
import { SystemConfigService } from '../system-settings/system-config.service';
import { AIProvider } from '@/prisma/client';

interface AIProviderDto {
  name: string;
  status: 'available' | 'busy' | 'unavailable' | 'paused';
  last_heartbeat: string;
  active_executions: number;
}

interface AIProvidersResponseDto {
  providers: AIProviderDto[];
  execution_paused: boolean;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  CURSOR_HEADLESS: 'Cursor CLI',
  CLAUDE_CODE: 'Antigravity',
};

/**
 * AI Providers Controller
 * BUG-002: Exposes /api/v1/ai-providers/status used by the Observability page
 */
@ApiTags('AI Providers')
@ApiBearerAuth()
@Controller('ai-providers')
export class AIProvidersController {
  private readonly logger = new Logger(AIProvidersController.name);

  constructor(
    private readonly providerHealthService: ProviderHealthService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * GET /api/v1/ai-providers/status
   * Returns health and status of all AI providers + global pause state
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('PM', 'TL', 'QA', 'MANAGER', 'ADMIN', 'OPERATOR')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get AI provider status',
    description: 'Returns health status for all AI providers and the global execution pause flag',
  })
  @ApiResponse({ status: 200, description: 'AI provider statuses and execution pause state' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProvidersStatus(): Promise<AIProvidersResponseDto> {
    this.logger.log('Fetching AI provider status');

    const providers: AIProviderDto[] = [];

    for (const provider of [AIProvider.CURSOR_HEADLESS, AIProvider.CLAUDE_CODE]) {
      const health = await this.providerHealthService.getProviderHealth(provider);

      let status: AIProviderDto['status'];
      if (!health.isHealthy) {
        status = 'unavailable';
      } else if (health.currentLoad >= 100) {
        status = 'busy';
      } else {
        status = 'available';
      }

      providers.push({
        name: PROVIDER_DISPLAY_NAMES[String(provider)] ?? String(provider),
        status,
        last_heartbeat: health.lastChecked.toISOString(),
        active_executions: health.activeExecutions,
      });
    }

    const pausedValue = await this.systemConfigService.get('execution.paused', 'false');
    const execution_paused = pausedValue === 'true';

    // If execution is paused, mark all available providers as paused
    if (execution_paused) {
      for (const p of providers) {
        if (p.status === 'available') p.status = 'paused';
      }
    }

    return { providers, execution_paused };
  }

  /**
   * POST /api/v1/ai-providers/toggle-pause
   * Toggles the global execution pause flag
   */
  @Post('toggle-pause')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('MANAGER', 'ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Toggle execution pause',
    description: 'Toggles global AI execution pause on or off',
  })
  @ApiResponse({ status: 200, description: 'Pause state updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires MANAGER or ADMIN role' })
  async togglePause(@Body() body: { paused: boolean }): Promise<{ execution_paused: boolean }> {
    this.logger.log(`Setting execution pause to: ${body.paused}`);
    await this.systemConfigService.set(
      'execution.paused',
      body.paused ? 'true' : 'false',
      'Global AI execution pause flag',
    );
    return { execution_paused: body.paused };
  }
}
