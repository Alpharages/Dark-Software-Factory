import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';
import { QaResultsService } from './qa-results.service';

@ApiTags('QA Results')
@ApiBearerAuth()
@Controller('api/v1/qa-results')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QaResultsController {
  constructor(private readonly qaResultsService: QaResultsService) {}

  @Get(':executionId')
  @ApiOperation({ summary: 'Get QA result by execution ID' })
  async getByExecutionId(@Param('executionId') executionId: string) {
    return this.qaResultsService.getResult(executionId);
  }

  @Get()
  @ApiOperation({ summary: 'Query QA results with filters' })
  async query(
    @Query('ticketId') ticketId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: 'passed' | 'failed',
  ) {
    if (ticketId) {
      return this.qaResultsService.getResultsByTicket(ticketId);
    }
    if (projectId) {
      return this.qaResultsService.getResultsByProject(projectId, { status });
    }
    return [];
  }
}

@ApiTags('Quality Gate')
@ApiBearerAuth()
@Controller('api/v1/quality-gate')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QualityGateController {
  constructor(private readonly qaResultsService: QaResultsService) {}

  @Post(':executionId/override')
  @Roles('lead_qa', 'manager')
  @ApiOperation({ summary: 'Emergency override quality gate (requires approval)' })
  async override(
    @Param('executionId') executionId: string,
    @Body() body: { reason: string; approvedBy: string },
  ) {
    await this.qaResultsService.overrideQualityGate(executionId, body.reason, body.approvedBy);
    return { success: true, message: 'Quality gate overridden' };
  }
}
