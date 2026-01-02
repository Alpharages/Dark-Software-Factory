import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
  Post,
  Body,
  Res,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerService } from '@/common/logger/logger.service';
import { FinancialMetricsService } from './financial-metrics.service';
import {
  CostPerFeatureQueryDto,
  CostPerFeatureDto,
  RoiQueryDto,
  RoiMetricsDto,
  BudgetTrendsQueryDto,
  BudgetTrendsDto,
  ModelEfficiencyQueryDto,
  ModelEfficiencyDto,
  ShareLinkQueryDto,
  ShareLinkResponseDto,
  ScheduleReportQueryDto,
  ScheduleReportResponseDto,
  HistoricalRoiQueryDto,
  HistoricalRoiResponseDto,
} from './dto';

@Controller('api/v1/financial-metrics')
@ApiTags('Financial Metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class FinancialMetricsController {
  private readonly logger: Logger;

  constructor(
    private readonly financialMetricsService: FinancialMetricsService,
    private readonly loggerService: LoggerService,
  ) {
    this.logger = new Logger(FinancialMetricsController.name);
  }

  /**
   * AC#1: Cost per Feature/Epic endpoint
   * NOTE: Requires epic_num field in Ticket model
   */
  @Get('cost-per-feature')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get cost breakdown per feature/epic',
    description:
      'Displays AI cost breakdown at the Feature/Epic level with drill-down to individual stories. Includes cost by provider and average cost per story.',
  })
  @ApiQuery({
    name: 'epicId',
    description: 'Epic identifier (e.g., "epic-5" or "5")',
    required: true,
    example: 'epic-5',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Optional project ID filter',
    required: false,
    example: 'project-uuid',
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Optional start date filter (ISO 8601)',
    required: false,
    example: '2025-12-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Optional end date filter (ISO 8601)',
    required: false,
    example: '2025-12-31T23:59:59Z',
  })
  @ApiQuery({
    name: 'format',
    description: 'Response format (json or csv)',
    required: false,
    enum: ['json', 'csv'],
    example: 'json',
  })
  @ApiResponse({
    status: 200,
    description: 'Cost breakdown retrieved successfully',
    type: [CostPerFeatureDto],
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized - No JWT token' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient role' })
  async getCostPerFeature(@Query() query: CostPerFeatureQueryDto, @Res() res?: Response) {
    try {
      this.loggerService.debug('GET /cost-per-feature', { query });

      // Parse dates if provided
      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;

      const result = await this.financialMetricsService.getCostPerFeature({
        epicId: query.epicId,
        projectId: query.projectId,
        startDate,
        endDate,
      });

      // Handle CSV export with proper headers
      if (query.format === 'csv' && res) {
        const csv = this.convertCostPerFeatureToCsv(result);
        const filename = `cost-per-feature-${query.epicId}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csv);
      }

      return result;
    } catch (_error) {
      this.logger.error(`Cost per feature error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#2: ROI Calculator endpoint
   * NOTE: Requires story_points field in Ticket model
   */
  @Get('roi')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({
    summary: 'Calculate Return on Investment',
    description:
      'Calculates ROI by comparing AI costs against business value metrics (story points delivered). Includes trend comparison with previous period.',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
    example: 'project-123',
  })
  @ApiQuery({
    name: 'period',
    description: 'Time period for ROI calculation',
    required: true,
    enum: ['day', 'week', 'month'],
    example: 'month',
  })
  @ApiQuery({
    name: 'valuePerPoint',
    description: 'Value per story point in USD (default: 500)',
    required: false,
    example: 500,
  })
  @ApiResponse({
    status: 200,
    description: 'ROI calculated successfully',
    type: RoiMetricsDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async calculateRoi(@Query() query: RoiQueryDto) {
    try {
      this.loggerService.debug('GET /roi', { query });

      return await this.financialMetricsService.calculateRoi({
        projectId: query.projectId,
        period: query.period,
        valuePerPoint: query.valuePerPoint,
      });
    } catch (_error) {
      this.logger.error(`ROI calculation error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#3: Budget Utilization Trends endpoint
   */
  @Get('budget-trends')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get budget utilization trends',
    description:
      'Visualizes budget utilization over time with trend analysis, forecasting, and anomaly detection. Includes burn rate and days until budget exhausted.',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
    example: 'project-123',
  })
  @ApiQuery({
    name: 'period',
    description: 'Time period for trend analysis',
    required: true,
    enum: ['week', 'month', 'quarter'],
    example: 'month',
  })
  @ApiQuery({
    name: 'format',
    description: 'Response format (json or csv)',
    required: false,
    enum: ['json', 'csv'],
    example: 'json',
  })
  @ApiResponse({
    status: 200,
    description: 'Budget trends retrieved successfully',
    type: BudgetTrendsDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getBudgetTrends(@Query() query: BudgetTrendsQueryDto, @Res() res?: Response) {
    try {
      this.loggerService.debug('GET /budget-trends', { query });

      const result = await this.financialMetricsService.getBudgetTrends({
        projectId: query.projectId,
        period: query.period,
      });

      // Handle CSV export for timeSeries data
      if (query.format === 'csv' && res) {
        const csv = this.convertBudgetTrendsToCsv(result);
        const filename = `budget-trends-${query.projectId}-${query.period}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csv);
      }

      return result;
    } catch (_error) {
      this.logger.error(`Budget trends error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#4: AI Model Efficiency Analysis endpoint
   */
  @Get('model-efficiency')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({
    summary: 'Analyze AI model efficiency',
    description:
      'Compares AI provider/model performance by cost efficiency and quality. Includes success rate, cost per execution, and recommendations for optimization.',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
    example: 'project-123',
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Optional start date filter (ISO 8601)',
    required: false,
    example: '2025-12-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Optional end date filter (ISO 8601)',
    required: false,
    example: '2025-12-31T23:59:59Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Model efficiency analysis retrieved successfully',
    type: ModelEfficiencyDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getModelEfficiency(@Query() query: ModelEfficiencyQueryDto) {
    try {
      this.loggerService.debug('GET /model-efficiency', { query });

      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;

      return await this.financialMetricsService.getModelEfficiency({
        projectId: query.projectId,
        startDate,
        endDate,
      });
    } catch (_error) {
      this.logger.error(`Model efficiency error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#5: Generate shareable read-only dashboard link endpoint
   */
  @Post('share-link')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Generate shareable read-only dashboard link',
    description:
      'Creates a temporary JWT-backed URL for read-only access to the financial dashboard.',
  })
  @ApiResponse({
    status: 201,
    description: 'Share link generated successfully',
    type: ShareLinkResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateShareLink(@Body() body: ShareLinkQueryDto) {
    try {
      this.loggerService.debug('POST /share-link', { body });
      return await this.financialMetricsService.generateShareLink(body);
    } catch (_error) {
      this.logger.error(`Share link generation error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#6: Schedule email report endpoint
   */
  @Post('schedule-report')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Schedule automated financial reports',
    description:
      'Registers an email recipient for automated weekly or monthly financial summary reports.',
  })
  @ApiResponse({
    status: 201,
    description: 'Report scheduled successfully',
    type: ScheduleReportResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  async scheduleReport(@Body() body: ScheduleReportQueryDto) {
    try {
      this.loggerService.debug('POST /schedule-report', { body });
      return await this.financialMetricsService.scheduleReport(body);
    } catch (_error) {
      this.logger.error(`Report scheduling error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * AC#2 Extension: Historical ROI Trend endpoint
   */
  @Get('historical-roi')
  @Roles(Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get historical ROI trend',
    description: 'Retrieves a time-series of ROI data points for visualization in charts.',
  })
  @ApiResponse({
    status: 200,
    description: 'Historical ROI retrieved successfully',
    type: HistoricalRoiResponseDto,
  })
  async getHistoricalRoi(@Query() query: HistoricalRoiQueryDto) {
    try {
      this.loggerService.debug('GET /historical-roi', { query });

      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;

      return await this.financialMetricsService.getHistoricalRoi({
        projectId: query.projectId,
        startDate,
        endDate,
      });
    } catch (_error) {
      this.logger.error(`Historical ROI error: ${(_error as Error).message}`);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Helper method to convert cost per feature data to CSV format
   * AC#6: Export feature
   */
  private convertCostPerFeatureToCsv(data: CostPerFeatureDto[]): string {
    if (data.length === 0) return 'Epic,Story,Cost USD,Tokens,Completion Date';

    const header = 'Epic,Story,Cost USD,Tokens,Completion Date';
    const rows = data.flatMap((epic) =>
      epic.storyCosts.map(
        (story) =>
          `${epic.epicId},${story.storyId},${story.costUsd},${story.tokensTotal},${story.completionDate || 'N/A'}`,
      ),
    );

    return [header, ...rows].join('\n');
  }

  /**
   * Helper method to convert budget trends timeSeries data to CSV format
   * AC#6: Export feature for AC#3
   */
  private convertBudgetTrendsToCsv(data: BudgetTrendsDto): string {
    const header = 'Date,Daily Cost USD,Cumulative Cost USD,Utilization %';
    const rows = data.timeSeries.map(
      (point) =>
        `${point.date},${point.dailyCost},${point.cumulativeCost},${point.utilizationPct.toFixed(2)}`,
    );

    return [header, ...rows].join('\n');
  }
}
