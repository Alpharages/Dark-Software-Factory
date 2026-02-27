import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { MetricsService } from './metrics.service';
import { ShortcutTelemetryDto } from './dto/telemetry.dto';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/auth.guard';

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller({ path: 'telemetry', version: '1' })
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Post('shortcut')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record keyboard shortcut usage telemetry' })
  @ApiResponse({ status: 201, description: 'Telemetry recorded' })
  async recordShortcutUsage(@Body() dto: ShortcutTelemetryDto) {
    this.metricsService.incrementKeyboardShortcutUsage(dto.shortcut);
    return { success: true };
  }

  /**
   * Readiness check - indicates if the service is ready to receive traffic
   * Note: /health endpoint is provided by AppController with comprehensive checks (DB + RabbitMQ)
   */
  @Public()
  @Get('ready')
  ready(): { status: string; timestamp: string } {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness check - indicates if the service is alive
   */
  @Public()
  @Get('live')
  live(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
