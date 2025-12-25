import { Controller, Get, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ObservabilityDashboardService } from './services/observability-dashboard.service';
import {
  TimelineResponseDto,
  QueueMetricsDto,
  SystemHealthDto,
  FileLockResponseDto,
} from './dto/observability-dashboard.dto';

@ApiTags('Observability Dashboard')
@ApiBearerAuth()
@Controller('api/v1/dashboard')
export class ObservabilityDashboardController {
  private readonly logger = new Logger(ObservabilityDashboardController.name);

  constructor(private readonly dashboardService: ObservabilityDashboardService) {}

  /**
   * AC#1: GET /api/v1/dashboard/ticket-timeline/:ticketId
   * Returns chronological event log for a ticket
   */
  @Get('ticket-timeline/:ticketId')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('PM', 'TL', 'QA', 'MANAGER', 'ADMIN')
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute
  @ApiOperation({
    summary: 'Get ticket timeline',
    description:
      'Returns chronological event log combining AIDecisionLog, AuditLog, and Execution status changes',
  })
  @ApiParam({
    name: 'ticketId',
    description: 'Ticket UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Timeline events in chronological order',
    type: TimelineResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token missing or invalid' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicketTimeline(@Param('ticketId') ticketId: string): Promise<TimelineResponseDto> {
    this.logger.log(`Fetching timeline for ticket ${ticketId}`);
    return this.dashboardService.getTicketTimeline(ticketId);
  }

  /**
   * AC#2: GET /api/v1/dashboard/queue-metrics
   * Returns RabbitMQ queue statistics with processing rates
   */
  @Get('queue-metrics')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('PM', 'TL', 'QA', 'MANAGER', 'ADMIN', 'OPERATOR')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get queue metrics',
    description:
      'Returns RabbitMQ queue depths, processing rates, and oldest message age for monitoring',
  })
  @ApiResponse({
    status: 200,
    description: 'Queue metrics for AI execution, QA check, and deployment queues',
    type: QueueMetricsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getQueueMetrics(): Promise<QueueMetricsDto> {
    this.logger.log('Fetching queue metrics');
    return this.dashboardService.getQueueMetrics();
  }

  /**
   * AC#3: GET /api/v1/dashboard/system-health
   * Returns component health status (database, RabbitMQ, Prometheus)
   */
  @Get('system-health')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('PM', 'TL', 'QA', 'MANAGER', 'ADMIN', 'OPERATOR', 'DEVELOPER')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get system health',
    description:
      'Returns health status of database, RabbitMQ, and Prometheus with latency measurements',
  })
  @ApiResponse({
    status: 200,
    description: 'System health with component statuses and overall uptime',
    type: SystemHealthDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getSystemHealth(): Promise<SystemHealthDto> {
    this.logger.log('Fetching system health');
    return this.dashboardService.getSystemHealth();
  }

  /**
   * AC#4: GET /api/v1/dashboard/file-locks
   * Returns active file locks with conflict detection
   */
  @Get('file-locks')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles('PM', 'TL', 'MANAGER', 'ADMIN', 'OPERATOR')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get active file locks',
    description: 'Returns file locks with waiting tickets to identify conflicts',
  })
  @ApiResponse({
    status: 200,
    description: 'Active file locks grouped by file path with conflict information',
    type: FileLockResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getFileLocks(): Promise<FileLockResponseDto> {
    this.logger.log('Fetching file locks');
    return this.dashboardService.getFileLocks();
  }
}
