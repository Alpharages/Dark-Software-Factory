import { Controller, Get, Query, UseGuards, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { QaWorkloadService } from './services/qa-workload.service';
import {
  QAWorkloadSummaryDto,
  ReviewerPerformanceResponseDto,
  ReviewerPerformanceQueryDto,
  QueueFlowResponseDto,
  QueueFlowQueryDto,
  WorkloadSummaryQueryDto,
  WorkloadExportQueryDto,
} from './dto/qa-workload.dto';

@ApiTags('QA Workload')
@ApiBearerAuth()
@Controller('api/v1/qa-workload')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QaWorkloadController {
  constructor(private readonly qaWorkloadService: QaWorkloadService) {}

  @Get('summary')
  @Roles(Role.QA, Role.ADMIN, Role.MANAGER)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get summary of QA team workload and capacity' })
  @ApiResponse({
    status: 200,
    description: 'Workload summary retrieved successfully',
    type: QAWorkloadSummaryDto,
  })
  async getSummary(@Query() query: WorkloadSummaryQueryDto): Promise<QAWorkloadSummaryDto> {
    return this.qaWorkloadService.getSummary(query.period);
  }

  @Get('reviewer-performance')
  @Roles(Role.QA, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get detailed performance metrics per reviewer' })
  @ApiResponse({
    status: 200,
    description: 'Reviewer performance metrics retrieved successfully',
    type: ReviewerPerformanceResponseDto,
  })
  async getReviewerPerformance(
    @Query() query: ReviewerPerformanceQueryDto,
  ): Promise<ReviewerPerformanceResponseDto> {
    return this.qaWorkloadService.getReviewerPerformance(query);
  }

  @Get('queue-flow')
  @Roles(Role.QA, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get time-series flow data for the review queue' })
  @ApiResponse({
    status: 200,
    description: 'Queue flow data retrieved successfully',
    type: QueueFlowResponseDto,
  })
  async getQueueFlow(@Query() query: QueueFlowQueryDto): Promise<QueueFlowResponseDto> {
    return this.qaWorkloadService.getQueueFlow(query);
  }

  @Get('export')
  @Roles(Role.QA, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Export workload report' })
  @ApiResponse({ status: 200, description: 'Export file (CSV/JSON)' })
  async export(@Query() query: WorkloadExportQueryDto, @Res() res: Response) {
    if (query.format === 'pdf') {
      return res.status(HttpStatus.NOT_IMPLEMENTED).json({ message: 'PDF export not supported' });
    }

    const summary = await this.qaWorkloadService.getSummary(query.period);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `qa-workload-report-${timestamp}.${query.format}`;

    if (query.format === 'json') {
      res.set({
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send(JSON.stringify(summary, null, 2));
    } else if (query.format === 'csv') {
      // Simple CSV conversion for summary
      const rows = [
        ['Metric', 'Value'],
        ['Total Reviews Completed', summary.summary.total_reviews_completed],
        ['Total Reviews Pending', summary.summary.total_reviews_pending],
        ['SLA Compliance (%)', summary.summary.sla_compliance_percent],
        ['Avg Review Time (min)', summary.summary.avg_review_time_minutes],
        ['Queue Depth', summary.queue_health.current_depth],
        ['Oldest Pending (hours)', summary.queue_health.oldest_pending_hours],
      ];

      const csv = rows.map((r) => r.join(',')).join('\n');

      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send(csv);
    }
  }
}
