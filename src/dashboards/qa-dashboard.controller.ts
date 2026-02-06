import { Controller, Get, Param, Query, UseGuards, Res } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../auth/constants/roles.enum';
import { ThrottlerGuard } from '@nestjs/throttler';
import { QualityDashboardService } from './services/quality-dashboard.service';
import {
  QualityDashboardSummaryDto,
  QualityMetricsQueryDto,
  QualityMetricsResponseDto,
  ProviderComparisonResponseDto,
  QualityDrillDownDto,
  ExportQueryDto,
} from './dto/quality-dashboard.dto';

@ApiTags('Quality Dashboard')
@ApiBearerAuth()
@Controller('qa-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class QaDashboardController {
  constructor(private readonly qualityDashboardService: QualityDashboardService) {}

  @Get('summary')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get high-level quality dashboard summary' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary retrieved successfully',
    type: QualityDashboardSummaryDto,
  })
  async getSummary(): Promise<QualityDashboardSummaryDto> {
    return this.qualityDashboardService.getSummary();
  }

  @Get('query')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Query granular quality metrics with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Metrics retrieved successfully',
    type: QualityMetricsResponseDto,
  })
  async getMetrics(@Query() query: QualityMetricsQueryDto): Promise<QualityMetricsResponseDto> {
    return this.qualityDashboardService.getMetrics(query);
  }

  @Get('provider-comparison')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Compare performance across AI providers' })
  @ApiQuery({ name: 'period', required: false, enum: ['7d', '30d', '90d', 'ytd'] })
  @ApiResponse({
    status: 200,
    description: 'Provider comparison retrieved successfully',
    type: ProviderComparisonResponseDto,
  })
  async getProviderComparison(
    @Query('period') period?: string,
  ): Promise<ProviderComparisonResponseDto> {
    return this.qualityDashboardService.getProviderComparison(period);
  }

  @Get('drill-down/:dimensionType/:dimensionId')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Drill down into specific project or provider' })
  @ApiParam({ name: 'dimensionType', enum: ['project', 'ai_provider', 'pm'] })
  @ApiParam({ name: 'dimensionId', description: 'ID of the project/provider/pm' })
  @ApiQuery({ name: 'period', required: false })
  @ApiResponse({
    status: 200,
    description: 'Drill-down data retrieved successfully',
    type: QualityDrillDownDto,
  })
  async getDrillDown(
    @Param('dimensionType') dimensionType: string,
    @Param('dimensionId') dimensionId: string,
    @Query('period') period?: string,
  ): Promise<QualityDrillDownDto> {
    return this.qualityDashboardService.getDrillDown(dimensionType, dimensionId, period);
  }

  @Get('export')
  @Roles(Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Export quality metrics report' })
  @ApiResponse({ status: 200, description: 'Export file (PDF/CSV/JSON)' })
  async export(@Query() query: ExportQueryDto, @Res() res: Response) {
    if (query.format === 'pdf') {
      return res.status(501).json({ message: 'PDF export not supported yet' });
    }

    const { buffer, contentType, filename } =
      await this.qualityDashboardService.generateExport(query);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    res.send(buffer);
  }
}
