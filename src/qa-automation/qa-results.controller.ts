/**
 * QA Results Controller
 * Story 3.6: QA Results Storage & Retrieval
 * FR38: Lead QA can view automated QA results for each ticket
 */

import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '../auth/constants/roles.enum';
import { LoggerService } from '../common/logger/logger.service';
import { QaResultsService } from './qa-results.service';
import {
  QaResultWithExecutionDto,
  QaResultsQueryDto,
  QaResultsPageDto,
  QaResultMetricsDto,
  QualityGateOverrideDto,
} from './dto';

@ApiTags('QA Results')
@ApiBearerAuth()
@Controller('qa-results')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QaResultsController {
  constructor(
    private readonly qaResultsService: QaResultsService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get aggregated QA metrics for a project
   * Route must be defined BEFORE :executionId to avoid path conflicts
   */
  @Get('metrics/:projectId')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get QA metrics for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO 8601)' })
  @ApiResponse({
    status: 200,
    description: 'QA metrics retrieved successfully',
    type: QaResultMetricsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getMetrics(
    @Param('projectId') projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultMetricsDto> {
    this.logger.debug(`Getting metrics for project ${projectId}`, { correlationId });
    return this.qaResultsService.getMetrics(
      projectId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  /**
   * Get QA result by execution ID
   */
  @Get(':executionId')
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get QA result by execution ID' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({
    status: 200,
    description: 'QA result retrieved successfully',
    type: QaResultWithExecutionDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'QA result not found' })
  async getByExecutionId(
    @Param('executionId') executionId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultWithExecutionDto> {
    this.logger.debug(`Getting QA result for execution ${executionId}`, { correlationId });
    return this.qaResultsService.findByExecutionId(executionId);
  }

  /**
   * Query QA results with filters and pagination
   */
  @Get()
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Query QA results with filters' })
  @ApiResponse({
    status: 200,
    description: 'QA results retrieved successfully',
    type: QaResultsPageDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async query(
    @Query() queryDto: QaResultsQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultsPageDto> {
    this.logger.debug(`Querying QA results`, { filters: queryDto, correlationId });
    return this.qaResultsService.query({
      ticketId: queryDto.ticketId,
      projectId: queryDto.projectId,
      status: queryDto.status,
      startDate: queryDto.startDate ? new Date(queryDto.startDate) : undefined,
      endDate: queryDto.endDate ? new Date(queryDto.endDate) : undefined,
      page: queryDto.page,
      limit: queryDto.limit,
    });
  }
}

@ApiTags('Quality Gate')
@ApiBearerAuth()
@Controller('quality-gate')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QualityGateController {
  constructor(
    private readonly qaResultsService: QaResultsService,
    private readonly logger: LoggerService,
  ) {}

  @Post(':executionId/override')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Emergency override quality gate (requires approval)' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({ status: 200, description: 'Quality gate overridden successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async override(
    @Param('executionId') executionId: string,
    @Body() body: QualityGateOverrideDto,
    @CorrelationId() correlationId?: string,
  ) {
    this.logger.warn(`Quality gate override requested for ${executionId}`, {
      reason: body.reason,
      approvedBy: body.approvedBy,
      correlationId,
    });
    await this.qaResultsService.overrideQualityGate(executionId, body.reason, body.approvedBy);
    return { success: true, message: 'Quality gate overridden' };
  }
}
