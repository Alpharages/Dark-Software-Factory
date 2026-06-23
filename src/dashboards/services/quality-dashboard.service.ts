import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '@/database/prisma.service';
import { QualityGateConfigService } from '@/qa-automation/quality-gate-config/quality-gate-config.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import {
  QualityDashboardSummaryDto,
  QualityMetricsQueryDto,
  QualityMetricsResponseDto,
  ProviderComparisonResponseDto,
  QualityDrillDownDto,
  QualityAlertDto,
  MetricItemDto,
  ProviderComparisonItemDto,
  ProviderAnalysisDto,
  DashboardSummaryDataDto,
  QualityGatesSummaryDto,
  BugEscapeMetricsDto,
  QaResultBreakdownItemDto,
  ExportQueryDto,
} from '../dto/quality-dashboard.dto';
import { AIProvider } from '@/prisma/client';

@Injectable()
export class QualityDashboardService {
  private readonly logger = new Logger(QualityDashboardService.name);
  private readonly CACHE_TTL = 300 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualityGateConfigService: QualityGateConfigService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectMetric('quality_dashboard_api_calls_total')
    private readonly apiCallsCounter: Counter<string>,
    @InjectMetric('quality_dashboard_alerts_total') private readonly alertsCounter: Counter<string>,
    @InjectMetric('quality_dashboard_summary_cache_hits_total')
    private readonly cacheHitsCounter: Counter<string>,
  ) {}

  /**
   * Get comprehensive dashboard summary with caching
   */
  async getSummary(): Promise<QualityDashboardSummaryDto> {
    this.apiCallsCounter.inc({ endpoint: 'summary' });

    const cacheKey = 'quality_dashboard_summary';
    const cached = await this.cacheManager.get<QualityDashboardSummaryDto>(cacheKey);
    if (cached) {
      this.cacheHitsCounter.inc({ endpoint: 'summary' });
      return cached;
    }

    const period = '30d';
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // Parallel fetch for summary data
    const [escapeStats, qaStats, pendingReviews, deploymentStats, qualityGateConfigStats] =
      await Promise.all([
        this.calculateEscapeRate(period),
        this.getOverallQaStats(startDate),
        this.prisma.qaReviewQueue.count({ where: { status: 'PENDING' } }),
        this.getDeploymentStats(startDate),
        this.getQualityGateConfigStats(),
      ]);

    const summaryData: DashboardSummaryDataDto = {
      total_tickets_processed: qaStats.total,
      tickets_passed_qa: qaStats.passed,
      tickets_failed_qa: qaStats.failed,
      overall_pass_rate_percent: qaStats.passRate,
      bug_escapes: {
        total: escapeStats.summary.total_escapes,
        rate_percent: escapeStats.summary.escape_rate_percent,
        target_percent: escapeStats.summary.target_rate_percent,
        status: escapeStats.summary.status,
      } as BugEscapeMetricsDto,
      avg_test_coverage_percent: qaStats.avgCoverage,
      avg_test_pass_rate_percent: qaStats.avgTestPassRate,
      pending_reviews: pendingReviews,
      deployment_success_rate_percent: deploymentStats.successRate,
    };

    // Generate alerts based on thresholds
    const alerts: QualityAlertDto[] = await this.generateAlerts(summaryData);

    const result: QualityDashboardSummaryDto = {
      period,
      summary: summaryData,
      quality_gates_summary: qualityGateConfigStats,
      alerts,
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * Get filtered and grouped quality metrics
   */
  async getMetrics(query: QualityMetricsQueryDto): Promise<QualityMetricsResponseDto> {
    const { period = '30d', group_by = 'project', page = 1, limit = 20 } = query;
    // Calculate start date based on period
    const startDate = this.calculateStartDate(period);

    // Helper to get metrics for a specific dimension
    const getMetricsForDimension = async (id: string, name: string, pmName?: string) => {
      // Reuse getOverallQaStats but filtered by project/provider etc.
      // For MVP we only fully support project grouping efficiently via existing services
      // Other groupings would require more complex queries

      const qaMetrics = await this.getQaMetrics(id, startDate);
      const escapeStats = await this.calculateEscapeRate(
        period,
        group_by === 'project' ? id : undefined,
      );

      // Deployment success rate
      const deploymentStats = await this.getDeploymentStats(
        startDate,
        group_by === 'project' ? id : undefined,
      );

      return {
        dimension_id: id,
        dimension_name: name,
        pm_name: pmName,
        metrics: {
          tickets_processed: qaMetrics.totalExecutions,
          qa_pass_rate_percent: qaMetrics.passRate,
          avg_coverage_percent: qaMetrics.averageCoverage,
          bug_escapes: escapeStats.summary.total_escapes,
          bug_escape_rate_percent: escapeStats.summary.escape_rate_percent,
          deployment_success_rate_percent: deploymentStats.successRate,
        },
        trend: this.calculateTrend(qaMetrics.passRate), // Simplified trend
        last_updated: new Date(),
      } as MetricItemDto;
    };

    let items: MetricItemDto[] = [];
    let total = 0;

    if (group_by === 'project') {
      const projects = await this.prisma.project.findMany({
        skip: (page - 1) * limit,
        take: limit,
        // orderBy: { name: 'asc' }, // Add if Project model has name
      });
      total = await this.prisma.project.count();

      // This causes N+1 queries, but standard for this complexity.
      // Could be optimized with raw SQL later.
      items = await Promise.all(
        projects.map((p) =>
          getMetricsForDimension(p.id, p.name || 'Unnamed Project', p.pm_id || undefined),
        ),
      );
    } else if (query.group_by === 'ai_provider') {
      const providers = Object.values(AIProvider);
      total = providers.length;
      items = await Promise.all(providers.map((p) => getMetricsForDimension(p, p)));
    }

    return {
      period,
      group_by,
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Compare AI providers
   */
  async getProviderComparison(period: string = '30d'): Promise<ProviderComparisonResponseDto> {
    const startDate = this.calculateStartDate(period);

    // Get raw data
    const providerEscapes = await this.compareProviderEscapes();

    // We need to aggregate QA results by provider
    const _qaStatsByProvider = await this.prisma.execution.groupBy({
      by: ['ai_provider'],
      where: {
        created_at: { gte: startDate },
        qa_result: { isNot: null },
      },
      _count: { id: true },
      // Prisma groupBy doesn't support relation aggregation easily without raw query for pass rate
      // We'll fetch aggregates in parallel steps
    });

    const comparisonItems: ProviderComparisonItemDto[] = [];
    const providers = Object.values(AIProvider);

    for (const provider of providers) {
      // 1. Get detailed execution stats
      const executions = await this.prisma.execution.findMany({
        where: {
          ai_provider: provider,
          created_at: { gte: startDate },
        },
        include: { qa_result: true },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const castExecutions = executions as any[];

      const total = executions.length;
      if (total === 0) continue;

      const passed = castExecutions.filter((e) => e.qa_result?.overall_passed).length;
      const passRate = (passed / total) * 100;

      const coverageSum = castExecutions.reduce(
        (sum, e) => sum + (e.qa_result?.test_coverage || 0),
        0,
      );
      const avgCoverage = coverageSum / total;

      const complexitySum = castExecutions.reduce((sum, e) => sum + (e.complexity_score || 0), 0);
      const avgComplexity = complexitySum / total;

      // Escapes
      const providerEscapeData = providerEscapes.find(
        (e: unknown) => (e as { provider: AIProvider }).provider === provider,
      );
      const escapes = (providerEscapeData as { escapes?: number })?.escapes || 0;
      const escapeRate = (escapes / total) * 100; // Simplified rate based on executions

      // Deployment success
      // Assuming COMPLETED/DEPLOYED status means success
      const successfulDeploys = executions.filter((e) =>
        ['COMPLETED', 'DEPLOYED'].includes(e.status),
      ).length;
      const deployRate = (successfulDeploys / total) * 100;

      comparisonItems.push({
        provider,
        tickets_processed: total,
        qa_pass_rate_percent: parseFloat(passRate.toFixed(2)),
        avg_coverage_percent: parseFloat(avgCoverage.toFixed(2)),
        avg_complexity_score: parseFloat(avgComplexity.toFixed(2)),
        bug_escapes: escapes,
        bug_escape_rate_percent: parseFloat(escapeRate.toFixed(2)),
        deployment_success_rate_percent: parseFloat(deployRate.toFixed(2)),
        common_escape_categories: [], // Populate if data available
        trend: 'stable',
      });
    }

    // Analysis logic
    const bestProvider = comparisonItems.reduce(
      (prev, current) =>
        prev.qa_pass_rate_percent > current.qa_pass_rate_percent ? prev : current,
      comparisonItems[0] || { provider: 'none' },
    );

    const keyDifferences = [
      `Best pass rate: ${bestProvider.provider}`,
      // Add more dynamic analysis strings
    ];

    return {
      period,
      comparison: comparisonItems,
      analysis: {
        better_provider: bestProvider.provider,
        key_differences: keyDifferences,
      } as ProviderAnalysisDto,
    };
  }

  /**
   * Drill down into specific dimension
   */
  async getDrillDown(
    dimensionType: string,
    dimensionId: string,
    period: string = '30d',
  ): Promise<QualityDrillDownDto> {
    const startDate = this.calculateStartDate(period);

    // 1. Fetch dimension details
    let dimensionName = 'Unknown';
    let pmName;

    if (dimensionType === 'project') {
      const project = await this.prisma.project.findUnique({ where: { id: dimensionId } });
      if (!project) throw new NotFoundException('Project not found');
      dimensionName = project.name;
      pmName = project.pm_id;
    }

    // 2. Overview Stats
    const qaMetrics = await this.getQaMetrics(dimensionId, startDate);
    const deploymentStats = await this.getDeploymentStats(startDate, dimensionId);

    // 3. Quality Gate Config
    const qgConfig = await this.qualityGateConfigService.getEffectiveConfig(dimensionId);

    // 4. Breakdown
    const breakdownByCat: QaResultBreakdownItemDto[] = [
      { category: 'linting', pass_rate: qaMetrics.lintingPassRate },
      { category: 'testing', pass_rate: qaMetrics.testPassRate },
      { category: 'security', pass_rate: qaMetrics.securityPassRate },
    ];

    // 5. Bug Escapes
    const escapeStats = await this.calculateEscapeRate(period, dimensionId);

    // 6. Recent Tickets
    const recentExecutions = await this.prisma.execution.findMany({
      where: {
        ticket: { project_id: dimensionId },
        created_at: { gte: startDate },
      },
      take: 5,
      orderBy: { created_at: 'desc' },
      include: { ticket: true, qa_result: true },
    });

    const recentTickets = recentExecutions.map((e) => ({
      ticket_id: e.ticket_id,
      clickup_id: e.ticket.clickup_task_id,
      title: e.ticket.title,
      status: e.status,
      qa_result: e.qa_result?.overall_passed ? 'PASSED' : 'FAILED',
      coverage_percent: e.qa_result?.test_coverage || 0,
      processed_at: e.updated_at,
    }));

    return {
      dimension: {
        type: dimensionType,
        id: dimensionId,
        name: dimensionName,
        pm: pmName,
      },
      period,
      overview: {
        tickets_processed: qaMetrics.totalExecutions,
        qa_pass_rate_percent: qaMetrics.passRate,
        deployment_success_rate_percent: deploymentStats.successRate,
      },
      quality_gates: {
        config: {
          min_coverage: qgConfig.thresholds.minCoverage,
          min_test_pass_rate: qgConfig.thresholds.minTestPassRate,
          max_complexity: qgConfig.thresholds.maxComplexity,
        },
        effectiveness: {
          tickets_blocked: qaMetrics.failedCount,
          tickets_passed: qaMetrics.passedCount,
          most_common_failure: 'coverage', // Mock or calculate
        },
      },
      qa_results_breakdown: {
        by_category: breakdownByCat,
        by_complexity_bucket: [], // Implement complexity buckets
      },
      bug_escapes: {
        total: escapeStats.summary.total_escapes,
        by_category: await this.getEscapesByCategory(
          dimensionType === 'project' ? dimensionId : undefined,
        ),
        avg_resolution_time_hours: 0, // Not yet implemented
      },
      recent_tickets: recentTickets,
    };
  }

  /**
   * Generate export file
   */
  async generateExport(
    query: ExportQueryDto,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const metrics = await this.getMetrics({
      period: query.period,
      project_id: query.project_id,
      limit: 1000,
    } as QualityMetricsQueryDto);

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `quality-metrics-${query.period}-${timestamp}.${query.format}`;

    if (query.format === 'json') {
      return {
        buffer: Buffer.from(JSON.stringify(metrics, null, 2)),
        contentType: 'application/json',
        filename,
      };
    } else if (query.format === 'csv') {
      const headers = [
        'Dimension Type',
        'Dimension Name',
        'PM',
        'Tickets Processed',
        'QA Pass Rate (%)',
        'Avg Coverage (%)',
        'Bug Escapes',
        'Escape Rate (%)',
        'Deploy Success Rate (%)',
        'Trend',
      ].join(',');

      const rows = metrics.items.map((item) =>
        [
          query.group_by || 'project',
          `"${item.dimension_name}"`,
          `"${item.pm_name || ''}"`,
          item.metrics.tickets_processed,
          item.metrics.qa_pass_rate_percent,
          item.metrics.avg_coverage_percent,
          item.metrics.bug_escapes,
          item.metrics.bug_escape_rate_percent,
          item.metrics.deployment_success_rate_percent,
          item.trend,
        ].join(','),
      );

      const csvContent = [headers, ...rows].join('\n');

      return {
        buffer: Buffer.from(csvContent),
        contentType: 'text/csv',
        filename,
      };
    } else {
      throw new Error(`Unsupported format: ${query.format}`);
    }
  }

  // ===========================================
  // Helpers
  // ===========================================

  private calculateStartDate(period: string): Date {
    const date = new Date();
    switch (period) {
      case '7d':
        date.setDate(date.getDate() - 7);
        break;
      case '90d':
        date.setDate(date.getDate() - 90);
        break;
      case 'ytd':
        date.setMonth(0, 1);
        break;
      case '30d':
      default:
        date.setDate(date.getDate() - 30);
        break;
    }
    return date;
  }

  private calculateTrend(value: number): string {
    // Simplistic trend logic
    return value > 80 ? 'improving' : 'stable';
  }

  private async getOverallQaStats(startDate: Date) {
    const results = await this.prisma.qAResult.findMany({
      where: { created_at: { gte: startDate } },
    });

    const total = results.length;
    const passed = results.filter((r) => r.overall_passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    const coverageSum = results.reduce((sum, r) => sum + (r.test_coverage || 0), 0);
    const avgCoverage = total > 0 ? coverageSum / total : 0;

    // Approximation for test pass rate (aggregating individual test runs would be expensive)
    const avgTestPassRate =
      total > 0 ? (results.filter((r) => r.tests_passed).length / total) * 100 : 0;

    return { total, passed, failed, passRate, avgCoverage, avgTestPassRate };
  }

  private async getQaMetrics(projectId: string, startDate: Date, endDate = new Date()) {
    const results = await this.prisma.qAResult.findMany({
      where: {
        created_at: { gte: startDate, lte: endDate },
        execution: { ticket: { project_id: projectId } },
      },
      select: {
        overall_passed: true,
        linting_passed: true,
        tests_passed: true,
        code_review_passed: true,
        test_coverage: true,
      },
    });

    const totalExecutions = results.length;
    const passedCount = results.filter((r) => r.overall_passed).length;
    const rate = (count: number) => (totalExecutions > 0 ? (count / totalExecutions) * 100 : 0);
    // Average only rows with a recorded coverage value, matching Prisma `_avg`
    // semantics (NULL coverage rows are excluded from both sum and count) so a
    // missing reading does not drag the reported average toward zero.
    const coverageValues = results
      .map((r) => r.test_coverage)
      .filter((c): c is number => c != null);
    const averageCoverage =
      coverageValues.length > 0
        ? coverageValues.reduce((sum, c) => sum + c, 0) / coverageValues.length
        : 0;

    return {
      totalExecutions,
      passedCount,
      failedCount: totalExecutions - passedCount,
      passRate: rate(passedCount),
      averageCoverage,
      lintingPassRate: rate(results.filter((r) => r.linting_passed).length),
      testPassRate: rate(results.filter((r) => r.tests_passed).length),
      securityPassRate: rate(results.filter((r) => r.code_review_passed).length),
    };
  }

  private async calculateEscapeRate(period: string, projectId?: string) {
    const [escapes, deployments] = await Promise.all([
      this.prisma.bugEscape.count({
        where: projectId ? { project_id: projectId } : {},
      }),
      this.prisma.ticket.count({
        where: {
          ...(projectId ? { project_id: projectId } : {}),
          status: { in: ['DEPLOYED', 'COMPLETED'] },
        },
      }),
    ]);
    const rate = deployments > 0 ? (escapes / deployments) * 100 : 0;

    return {
      period,
      summary: {
        total_deployed: deployments,
        total_escapes: escapes,
        escape_rate_percent: parseFloat(rate.toFixed(2)),
        target_rate_percent: 5.0,
        status: rate <= 5.0 ? 'within_target' : 'exceeded',
      },
    };
  }

  private async compareProviderEscapes() {
    const escapes = await this.prisma.bugEscape.groupBy({
      by: ['ai_provider'],
      _count: { id: true },
      where: {
        detected_at: { gte: new Date(new Date().setMonth(new Date().getMonth() - 3)) },
      },
    });

    return escapes.map((e) => ({
      provider: e.ai_provider || 'unknown',
      escapes: e._count.id,
    }));
  }

  private async getEscapesByCategory(projectId?: string) {
    const groups = await this.prisma.bugEscape.groupBy({
      by: ['escape_category'],
      where: {
        ...(projectId ? { project_id: projectId } : {}),
        detected_at: { gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
      },
      _count: { escape_category: true },
    });

    return groups.map((g) => ({
      category: g.escape_category,
      count: g._count.escape_category,
    }));
  }

  private async getDeploymentStats(startDate: Date, projectId?: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        updated_at: { gte: startDate },
        ...(projectId ? { project_id: projectId } : {}),
      },
    });
    const total = tickets.length;
    const successful = tickets.filter((t) => ['DEPLOYED', 'COMPLETED'].includes(t.status)).length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;
    return { total, successful, successRate };
  }

  private async getQualityGateConfigStats(): Promise<QualityGatesSummaryDto> {
    const totalProjects = await this.prisma.project.count();
    const customConfigs = await this.prisma.qualityGateConfig.count({
      where: { projectId: { not: null } },
    });

    const defaults = totalProjects - customConfigs;

    const globalConfig = await this.qualityGateConfigService.getEffectiveConfig();

    return {
      projects_configured: totalProjects,
      projects_using_defaults: defaults,
      average_coverage_threshold: globalConfig.thresholds.minCoverage,
    };
  }

  private async generateAlerts(summary: DashboardSummaryDataDto): Promise<QualityAlertDto[]> {
    const alerts: QualityAlertDto[] = [];

    // Configurable thresholds could be injected
    if (summary.bug_escapes.rate_percent > summary.bug_escapes.target_percent) {
      const alert = {
        type: 'critical' as const,
        message: `Bug escape rate (${summary.bug_escapes.rate_percent}%) exceeds target`,
        metric: 'bug_escape_rate',
      };
      alerts.push(alert);

      // Log alert via AIDecisionLogger (AC#7)
      await this.aiDecisionLogger.logDecision({
        agentName: 'QualityDashboardService',
        action: 'quality_alert_generated',
        reasoning: alert.message,
        ticketId: 'dashboard_summary', // No specific ticket, dashboard-level
        inputData: {
          current_rate: summary.bug_escapes.rate_percent,
          target_rate: summary.bug_escapes.target_percent,
        },
        outputData: {
          alert_type: alert.type,
          metric: alert.metric,
        },
        confidence: 1.0, // High confidence for threshold-based alerts
      });

      // Increment Prometheus counter
      this.alertsCounter.inc({ type: 'critical', metric: 'bug_escape_rate' });
    }

    if (summary.overall_pass_rate_percent < 75) {
      const alert = {
        type: 'warning' as const,
        message: `Overall QA Pass rate is low (${summary.overall_pass_rate_percent.toFixed(1)}%)`,
        metric: 'pass_rate',
      };
      alerts.push(alert);

      // Log alert via AIDecisionLogger (AC#7)
      await this.aiDecisionLogger.logDecision({
        agentName: 'QualityDashboardService',
        action: 'quality_alert_generated',
        reasoning: alert.message,
        ticketId: 'dashboard_summary',
        inputData: {
          current_rate: summary.overall_pass_rate_percent,
          threshold: 75,
        },
        outputData: {
          alert_type: alert.type,
          metric: alert.metric,
        },
        confidence: 1.0,
      });

      // Increment Prometheus counter
      this.alertsCounter.inc({ type: 'warning', metric: 'pass_rate' });
    }

    return alerts;
  }
}
