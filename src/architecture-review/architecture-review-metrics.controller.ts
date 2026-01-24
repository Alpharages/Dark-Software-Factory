import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AdrMetricsService } from './metrics/adr-metrics.service';
import { AdrInsightsService } from './metrics/adr-insights.service';
import { AdrMetricsDto, AdrTrendsDto } from './metrics/dto/adr-metrics.dto';

@ApiTags('architecture-review')
@Controller('architecture-review')
export class ArchitectureReviewMetricsController {
  constructor(
    private readonly metricsService: AdrMetricsService,
    private readonly insightsService: AdrInsightsService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get architecture review metrics' })
  @ApiResponse({ status: 200, type: AdrMetricsDto })
  @ApiQuery({ name: 'project_id', required: false })
  async getMetrics(@Query('project_id') projectId?: string): Promise<AdrMetricsDto> {
    return this.metricsService.getReviewMetrics(projectId);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Get architecture review trends and insights' })
  @ApiResponse({ status: 200, type: AdrTrendsDto })
  @ApiQuery({ name: 'project_id', required: false })
  async getTrends(@Query('project_id') projectId?: string): Promise<AdrTrendsDto> {
    // Basic trend data from metrics service
    const trends = await this.metricsService.getTrendAnalysis(projectId);

    // Enrich with AI insights
    const insights = await this.insightsService.generateInsights(projectId);
    trends.learning_insights = insights.patterns;

    return trends;
  }
}
