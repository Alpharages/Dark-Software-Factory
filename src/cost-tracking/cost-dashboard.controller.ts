import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CorrelationId } from '@/common/decorators/correlation-id.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { LoggerService } from '@/common/logger/logger.service';
import { CostDashboardService } from './cost-dashboard.service';
import { CostSummaryDto, TicketCostDto, BreakdownDto, BreakdownQueryDto } from './dto';

@ApiTags('Cost Tracking')
@ApiBearerAuth()
@Controller('api/costs')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class CostDashboardController {
  constructor(
    private readonly costService: CostDashboardService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * AC#1: Cost Summary by Period
   */
  @Get('summary/:period')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests/minute
  @ApiOperation({
    summary: 'Get cost summary for specified time period',
    description:
      'Returns aggregated AI costs for day/week/month with provider and model breakdowns. ' +
      'Day = last 24 hours, week = last 7 days, month = last 30 days.',
  })
  @ApiParam({
    name: 'period',
    description: 'Time period for aggregation',
    enum: ['day', 'week', 'month'],
    example: 'day',
  })
  @ApiResponse({
    status: 200,
    description: 'Cost summary retrieved successfully',
    type: CostSummaryDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - period must be day, week, or month',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getSummary(
    @Param('period') period: string,
    @CorrelationId() correlationId?: string,
  ): Promise<CostSummaryDto> {
    // Validate period parameter
    if (!['day', 'week', 'month'].includes(period)) {
      throw new HttpException('Period must be one of: day, week, month', HttpStatus.BAD_REQUEST);
    }

    this.logger.debug(`Getting cost summary for period: ${period}`, {
      correlationId,
    });

    return await this.costService.getCostSummary(period as 'day' | 'week' | 'month', correlationId);
  }

  /**
   * AC#2: Per-Ticket Cost Breakdown
   */
  @Get('ticket/:ticketId')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests/minute
  @ApiOperation({
    summary: 'Get complete cost breakdown for a specific ticket',
    description:
      'Returns cost history for a ticket with detailed execution context. ' +
      'Includes all AI invocations, costs, tokens, and related execution data.',
  })
  @ApiParam({
    name: 'ticketId',
    description: 'Ticket ID (e.g., DSF-123)',
    example: 'DSF-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Ticket cost data retrieved successfully',
    type: TicketCostDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getTicketCost(
    @Param('ticketId') ticketId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<TicketCostDto> {
    this.logger.debug(`Getting cost breakdown for ticket: ${ticketId}`, {
      correlationId,
    });

    return await this.costService.getTicketCost(ticketId, correlationId);
  }

  /**
   * AC#3: Cost Breakdown by Agent or Model
   */
  @Get('breakdown')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } }) // 50 requests/minute (expensive query)
  @ApiOperation({
    summary: 'Get cost breakdown grouped by agent or model',
    description:
      'Flexible aggregation with pagination and date filtering. ' +
      'Group by model for provider-agnostic view, or by agent for operation-specific analysis.',
  })
  @ApiQuery({
    name: 'groupBy',
    required: true,
    description: 'Group costs by agent (with operation type) or model',
    enum: ['agent', 'model'],
    example: 'model',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Results per page (default: 50, max: 100)',
    example: 50,
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Filter by start date (ISO 8601 format)',
    example: '2025-12-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Filter by end date (ISO 8601 format)',
    example: '2025-12-31T23:59:59Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Cost breakdown retrieved successfully',
    type: BreakdownDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - invalid parameters or date format',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getBreakdown(
    @Query() query: BreakdownQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<BreakdownDto> {
    this.logger.debug('Getting cost breakdown', {
      filters: query,
      correlationId,
    });

    try {
      // Convert date strings to Date objects with validation
      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;

      // Validate dates
      if (startDate && isNaN(startDate.getTime())) {
        throw new HttpException(
          'Invalid startDate format. Use ISO 8601 format (e.g., 2025-12-01T00:00:00Z)',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (endDate && isNaN(endDate.getTime())) {
        throw new HttpException(
          'Invalid endDate format. Use ISO 8601 format (e.g., 2025-12-31T23:59:59Z)',
          HttpStatus.BAD_REQUEST,
        );
      }

      return await this.costService.getCostBreakdown(
        {
          groupBy: query.groupBy,
          page: query.page || 1,
          limit: query.limit || 50,
          startDate,
          endDate,
        },
        correlationId,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // Re-throw validation errors
      }

      this.logger.error('Breakdown endpoint error', undefined, {
        error: (error as Error).message,
        correlationId,
      });

      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
