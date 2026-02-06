/**
 * Production Error Dashboard Controller
 * Story 9-U-5: Production Error Dashboard
 *
 * API endpoints for the production error dashboard.
 */

import { Controller, Get, Post, Param, Body, Query, UseGuards, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '@/database/prisma.service';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ProductionErrorDashboardService } from './production-error-dashboard.service';
import { ProductionErrorDashboardMetrics } from './production-error-dashboard.metrics';
import {
  ErrorOverviewDto,
  ErrorListResponseDto,
  ErrorListFiltersDto,
} from './dto/error-overview.dto';
import { ErrorTrendResponseDto, ErrorTrendsQueryDto } from './dto/error-trend.dto';
import { ApplicationHealthResponseDto } from './dto/application-health.dto';
import {
  BulkCreateTicketsDto,
  BulkCreateTicketsResponseDto,
  AcknowledgeErrorDto,
  ExportErrorsQueryDto,
} from './dto/bulk-create-tickets.dto';
// CSV generation helper function
function generateCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((header) => {
        // eslint-disable-next-line security/detect-object-injection
        const value = row[header];
        // Escape values that contain commas or quotes
        const str = String(value ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

@ApiTags('Production Error Dashboard')
@Controller('monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ProductionErrorDashboardController {
  private readonly logger = new Logger(ProductionErrorDashboardController.name);

  constructor(
    private readonly dashboardService: ProductionErrorDashboardService,
    private readonly metrics: ProductionErrorDashboardMetrics,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get error overview metrics
   * AC#1: Error Overview Widget
   */
  @Get('errors/overview')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Get error overview metrics for dashboard widget' })
  @ApiResponse({ status: 200, description: 'Overview metrics retrieved', type: ErrorOverviewDto })
  async getErrorOverview(): Promise<ErrorOverviewDto> {
    this.metrics.incrementDashboardViews();
    return this.dashboardService.getErrorOverview();
  }

  /**
   * Get filtered error list with pagination
   * AC#2: Error List Table with Filtering
   */
  @Get('errors')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Get filtered list of production errors' })
  @ApiResponse({ status: 200, description: 'Error list retrieved', type: ErrorListResponseDto })
  async getErrorList(@Query() filters: ErrorListFiltersDto): Promise<ErrorListResponseDto> {
    this.metrics.incrementFilterUsage(filters.sortBy || 'default');
    return this.dashboardService.getErrorList(filters);
  }

  /**
   * Get error trends for chart
   * AC#5: Error Trend Chart
   */
  @Get('errors/trends')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Get error trends for 7-day rolling chart' })
  @ApiResponse({ status: 200, description: 'Trend data retrieved', type: ErrorTrendResponseDto })
  async getErrorTrends(@Query() query: ErrorTrendsQueryDto): Promise<ErrorTrendResponseDto> {
    const days = query.days || 7;
    return this.dashboardService.getErrorTrends(days);
  }

  /**
   * Get application health heatmap
   * AC#6: Application Health Heatmap
   */
  @Get('applications/health')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Get application health status for heatmap' })
  @ApiResponse({
    status: 200,
    description: 'Application health data retrieved',
    type: ApplicationHealthResponseDto,
  })
  async getApplicationHealth(): Promise<ApplicationHealthResponseDto> {
    return this.dashboardService.getApplicationHealth();
  }

  /**
   * Get all unique applications for filter dropdown
   */
  @Get('applications')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Get all unique application names' })
  @ApiResponse({ status: 200, description: 'Applications retrieved', type: [String] })
  async getApplications(): Promise<string[]> {
    return this.dashboardService.getApplications();
  }

  /**
   * Bulk create fix tickets for selected errors
   * AC#7: Quick Actions & Bulk Operations
   */
  @Post('errors/bulk-create-tickets')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Bulk create ClickUp tickets for selected errors' })
  @ApiResponse({
    status: 200,
    description: 'Tickets created',
    type: BulkCreateTicketsResponseDto,
  })
  async bulkCreateTickets(
    @Body() dto: BulkCreateTicketsDto,
  ): Promise<BulkCreateTicketsResponseDto> {
    this.metrics.incrementTicketsCreated(true);
    return this.dashboardService.bulkCreateTickets(dto.errorIds);
  }

  /**
   * Mark error as acknowledged
   * AC#7: Quick Actions & Bulk Operations
   */
  @Post('errors/:id/acknowledge')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Mark a production error as acknowledged' })
  @ApiResponse({ status: 200, description: 'Error acknowledged' })
  async acknowledgeError(
    @Param('id') errorId: string,
    @Body() dto: AcknowledgeErrorDto,
  ): Promise<void> {
    await this.dashboardService.acknowledgeError(errorId, dto.acknowledgedBy);
  }

  /**
   * Export errors to CSV
   * AC#7: Quick Actions & Bulk Operations
   */
  @Get('errors/export')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Export errors to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file generated' })
  async exportErrors(@Query() query: ExportErrorsQueryDto, @Res() res: Response): Promise<void> {
    const errors = await this.dashboardService.exportErrors(query.ids);

    const csvData = errors.map((e) => ({
      ID: e.id,
      Application: e.application,
      'Error Type': e.error_type,
      'Error Message': e.error_message,
      Severity: e.severity,
      'Occurred At': e.occurred_at.toISOString(),
      'Affected Users': e.affected_users,
      'Fix Ticket URL': e.fix_ticket_url || '',
      Status: e.resolved ? 'Resolved' : 'Active',
      'Acknowledged At': e.acknowledged_at?.toISOString() || '',
      'Acknowledged By': e.acknowledged_by || '',
    }));

    const csv = generateCsv(csvData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=production-errors.csv');
    res.send(csv);
  }

  /**
   * Track error detail view (for metrics)
   * AC#9: Prometheus Metrics Integration
   */
  @Post('errors/:id/view')
  @Roles(Role.MANAGER, Role.TL, Role.QA, Role.PM, Role.ADMIN, Role.VIEWER)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Track error detail view (for analytics)' })
  @ApiResponse({ status: 200, description: 'View tracked' })
  async trackErrorView(@Param('id') errorId: string): Promise<void> {
    const error = await this.prisma.productionError.findUnique({
      where: { id: errorId },
      select: { severity: true },
    });

    if (error) {
      this.metrics.incrementDetailView(error.severity);
    }
  }
}
