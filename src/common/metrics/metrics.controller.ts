import { Controller, Get } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';

@Controller()
export class MetricsController {
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
