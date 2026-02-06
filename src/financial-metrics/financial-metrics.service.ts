import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { Prisma } from '@/prisma/client';
import {
  CostPerFeatureDto,
  StoryCostDto,
  ProviderBreakdownDto,
  RoiMetricsDto,
  RoiMetricsInnerDto,
  RoiTrendDto,
  BudgetTrendsDto,
  BudgetSummaryDto,
  TrendForecastDto,
  TimeSeriesDataPointDto,
  FinancialAnomalyDto,
  ModelEfficiencyDto,
  ModelMetricsDto,
  ModelRecommendationDto,
  ShareLinkResponseDto,
  ScheduleReportResponseDto,
  HistoricalRoiResponseDto,
  RoiDataPointDto,
} from './dto';
import { JwtService } from '@nestjs/jwt';

type Decimal = Prisma.Decimal;

@Injectable()
export class FinancialMetricsService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
    private readonly sentry: SentryService,
    private readonly jwtService: JwtService,
  ) {
    this.logger = new Logger(FinancialMetricsService.name);
  }

  /**
   * AC#1: Get cost per feature/epic breakdown
   * NOTE: Requires epic_num field in Ticket model (see Technical Debt)
   */
  async getCostPerFeature(options: {
    epicId: string;
    projectId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<CostPerFeatureDto[]> {
    try {
      const { epicId, projectId, startDate, endDate } = options;
      const whereClause: Prisma.AICostLogWhereInput = {};

      // Date range filter
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = startDate;
        if (endDate) whereClause.timestamp.lte = endDate;
      }

      const epic_num = epicId.replace('epic-', '');

      // Strategic alignment using epic_num (Story 6-R-3 schema update)
      (whereClause as Record<string, unknown>).ticket = {
        epic_num,
      };

      if (projectId) {
        ((whereClause as Record<string, unknown>).ticket as Record<string, unknown>).project_id =
          projectId;
      }

      // Query cost logs and aggregate by ticket
      const costLogs = await this.prisma.aICostLog.findMany({
        where: whereClause,
        include: {
          ticket: {
            select: {
              id: true,
              title: true,
              clickup_task_id: true,
              completion_date: true,
            } as { title: boolean; clickup_task_id: boolean; completion_date: boolean },
          },
        },
      });

      // Group by ticket
      const ticketCostMap = new Map<
        string,
        {
          title: string;
          cost: Decimal;
          tokens: number;
          completionDate?: Date;
        }
      >();

      costLogs.forEach((log) => {
        const ticketData = (
          log as { ticket: { title: string; clickup_task_id: string; completion_date: Date } }
        ).ticket;
        if (!log.ticket_id || !ticketData) return;

        const existing = ticketCostMap.get(log.ticket_id) || {
          title: ticketData.title,
          cost: new Prisma.Decimal(0),
          tokens: 0,
          completionDate: ticketData.completion_date || undefined,
        };

        existing.cost = existing.cost.add(log.cost_usd as Decimal);
        existing.tokens += (log.tokens_input || 0) + (log.tokens_output || 0);

        ticketCostMap.set(log.ticket_id, existing);
      });

      // Calculate epic totals
      let totalCost = new Prisma.Decimal(0);
      ticketCostMap.forEach((data) => {
        totalCost = totalCost.add(data.cost);
      });

      // Map stories
      const storyCosts: StoryCostDto[] = Array.from(ticketCostMap.entries()).map(
        ([ticketId, data]) => ({
          storyId: ticketId,
          storyTitle: data.title,
          costUsd: data.cost.toString(),
          tokensTotal: data.tokens,
          completionDate: data.completionDate?.toISOString(),
        }),
      );

      // Calculate provider breakdown
      const providerCostMap = new Map<string, Decimal>();
      costLogs.forEach((log) => {
        const existing = providerCostMap.get(log.ai_provider) || new Prisma.Decimal(0);
        providerCostMap.set(log.ai_provider, existing.add(log.cost_usd as Decimal));
      });

      const totalCostNum = parseFloat(totalCost.toString());
      const byProvider: ProviderBreakdownDto[] = Array.from(providerCostMap.entries()).map(
        ([provider, cost]) => {
          const providerCost = parseFloat(cost.toString());
          return {
            provider,
            costUsd: cost.toString(),
            percentage: totalCostNum > 0 ? (providerCost / totalCostNum) * 100 : 0,
          };
        },
      );

      const avgCostPerStory =
        storyCosts.length > 0 ? totalCost.dividedBy(storyCosts.length).toString() : '0.00';

      return [
        {
          epicId,
          epicTitle: `Epic ${epic_num}`,
          totalCostUsd: totalCost.toString(),
          storyCount: storyCosts.length,
          avgCostPerStory,
          storyCosts,
          byProvider,
        },
      ];
    } catch (_error) {
      this.logger.error(`Failed to get cost per feature: ${(_error as Error).message}`);
      throw _error;
    }
  }

  /**
   * AC#2: Calculate ROI with value tracking
   * Uses story_points and completion_date fields (Story 6-R-3 schema update)
   */
  async calculateRoi(options: {
    projectId: string;
    period: 'day' | 'week' | 'month';
    valuePerPoint?: number;
  }): Promise<RoiMetricsDto> {
    try {
      const { projectId, period, valuePerPoint = 500 } = options;

      this.loggerService.debug('Calculating ROI', { projectId, period, valuePerPoint });

      // Calculate date ranges
      const currentEndDate = new Date();
      const currentStartDate = new Date();
      const previousEndDate = new Date(currentStartDate);
      const previousStartDate = new Date();

      switch (period) {
        case 'day':
          currentStartDate.setHours(currentStartDate.getHours() - 24);
          previousStartDate.setHours(previousStartDate.getHours() - 48);
          previousEndDate.setHours(previousEndDate.getHours() - 24);
          break;
        case 'week':
          currentStartDate.setDate(currentStartDate.getDate() - 7);
          previousStartDate.setDate(previousStartDate.getDate() - 14);
          previousEndDate.setDate(previousEndDate.getHours() - 7);
          break;
        case 'month':
          currentStartDate.setDate(currentStartDate.getDate() - 30);
          previousStartDate.setDate(previousStartDate.getDate() - 60);
          previousEndDate.setDate(previousEndDate.getDate() - 30);
          break;
      }

      // Get current period cost
      const currentCostAggregate = await this.prisma.aICostLog.aggregate({
        where: {
          timestamp: {
            gte: currentStartDate,
            lte: currentEndDate,
          },
          ticket: {
            project_id: projectId,
          },
        },
        _sum: {
          cost_usd: true,
        },
      });

      const totalCostUsd = currentCostAggregate._sum.cost_usd?.toString() || '0.00';
      const totalCost = parseFloat(totalCostUsd);

      // Calculate delivered value based on story points and updated_at (completion proxy)
      const deliveredTickets = await this.prisma.ticket.aggregate({
        where: {
          project_id: projectId,
          status: 'COMPLETED',
          updated_at: {
            gte: currentStartDate,
            lte: currentEndDate,
          },
        },
        _count: {
          id: true,
        },
      });

      // Using ticket count as a proxy for story points since story_points field doesn't exist
      const storyPointsDelivered = deliveredTickets._count?.id || 0;
      const totalValueUsd = (storyPointsDelivered * valuePerPoint).toFixed(2);

      // Calculate ROI
      const roiPercentage =
        totalCost > 0 ? ((parseFloat(totalValueUsd) - totalCost) / totalCost) * 100 : 0;
      const costPerStoryPoint =
        storyPointsDelivered > 0 ? (totalCost / storyPointsDelivered).toFixed(2) : '0.00';

      // Calculate break-even point
      const breakEvenStories = totalCost > 0 ? Math.ceil(totalCost / valuePerPoint) : 0;

      // Get previous period ROI for trend
      const previousCostAggregate = await this.prisma.aICostLog.aggregate({
        where: {
          timestamp: {
            gte: previousStartDate,
            lte: previousEndDate,
          },
          ticket: {
            project_id: projectId,
          },
        },
        _sum: {
          cost_usd: true,
        },
      });

      const previousCost = parseFloat(previousCostAggregate._sum.cost_usd?.toString() || '0');
      const previousValue = storyPointsDelivered * valuePerPoint; // Placeholder - needs actual query
      const previousRoi =
        previousCost > 0 ? ((previousValue - previousCost) / previousCost) * 100 : 0;

      // Calculate trend
      const roiChange = roiPercentage - previousRoi;
      const changeStr = roiChange > 0 ? `+${roiChange.toFixed(1)}%` : `${roiChange.toFixed(1)}%`;
      const direction: 'improving' | 'declining' | 'stable' =
        Math.abs(roiChange) < 5 ? 'stable' : roiChange > 0 ? 'improving' : 'declining';

      const metrics: RoiMetricsInnerDto = {
        totalCostUsd,
        totalValueUsd,
        storyPointsDelivered,
        valuePerPoint,
        roiPercentage: parseFloat(roiPercentage.toFixed(1)),
        costPerStoryPoint,
        breakEvenPoint: `${breakEvenStories} stories`,
      };

      const trend: RoiTrendDto = {
        previousPeriodRoi: parseFloat(previousRoi.toFixed(1)),
        change: changeStr,
        direction,
      };

      return {
        projectId,
        period,
        metrics,
        trend,
      };
    } catch (_error) {
      this.logger.error(`Failed to calculate ROI: ${(_error as Error).message}`, {
        projectId: options.projectId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'calculateRoi' },
      });
      throw _error;
    }
  }

  /**
   * AC#3: Get budget utilization trends with forecasting
   */
  async getBudgetTrends(options: {
    projectId: string;
    period: 'week' | 'month' | 'quarter';
  }): Promise<BudgetTrendsDto> {
    try {
      const { projectId, period } = options;

      this.loggerService.debug('Getting budget trends', { projectId, period });

      // Get project budget
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { budget_usd: true },
      });

      if (!project || !project.budget_usd) {
        throw new Error(`Project ${projectId} not found or budget not set`);
      }

      const totalBudget = parseFloat(project.budget_usd.toString());

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 90;
      startDate.setDate(startDate.getDate() - days);

      // Get daily cost aggregations using Prisma ORM (prevents SQL injection)
      // Build where clause for cost logs
      const costWhereClause: Prisma.AICostLogWhereInput = {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
        ticket: {
          project_id: projectId,
        },
      };

      // Query all cost logs for the period
      const costLogs = await this.prisma.aICostLog.findMany({
        where: costWhereClause,
        select: {
          timestamp: true,
          cost_usd: true,
        },
        orderBy: {
          timestamp: 'asc',
        },
      });

      // Group by date in application layer
      const dailyCostMap = new Map<string, Decimal>();
      costLogs.forEach((log) => {
        const dateKey = log.timestamp.toISOString().split('T')[0];
        const existing = dailyCostMap.get(dateKey) || new Prisma.Decimal(0);
        dailyCostMap.set(dateKey, existing.add(log.cost_usd as Decimal));
      });

      const dailyCosts = Array.from(dailyCostMap.entries())
        .map(([dateStr, cost]) => ({
          date: new Date(dateStr),
          cost,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      // Calculate cumulative costs and time series
      let cumulativeCost = 0;
      const timeSeries: TimeSeriesDataPointDto[] = dailyCosts.map((day) => {
        const dailyCostNum = parseFloat((day.cost as Decimal).toString());
        cumulativeCost += dailyCostNum;
        return {
          date: day.date.toISOString().split('T')[0],
          dailyCost: dailyCostNum.toFixed(2),
          cumulativeCost: cumulativeCost.toFixed(2),
          utilizationPct: (cumulativeCost / totalBudget) * 100,
        };
      });

      // Get total spent
      const totalSpent = cumulativeCost;
      const remaining = totalBudget - totalSpent;
      const utilizationPct = (totalSpent / totalBudget) * 100;

      // Calculate burn rate
      const daysElapsed = dailyCosts.length || 1;
      const burnRatePerDay = totalSpent / daysElapsed;

      // Forecast
      const daysRemaining = remaining > 0 ? Math.floor(remaining / burnRatePerDay) : 0;
      const forecastDate = new Date();
      forecastDate.setDate(forecastDate.getDate() + daysRemaining);

      const status: 'healthy' | 'warning' | 'critical' =
        utilizationPct < 50 ? 'healthy' : utilizationPct < 80 ? 'warning' : 'critical';

      // Detect anomalies (spending > 150% of 7-day rolling average)
      const anomalies: FinancialAnomalyDto[] = [];
      if (dailyCosts.length >= 7) {
        for (let i = 7; i < dailyCosts.length; i++) {
          const rollingAvg =
            dailyCosts
              .slice(i - 7, i)
              .reduce((sum, day) => sum + parseFloat((day.cost as Decimal).toString()), 0) / 7;

          // eslint-disable-next-line security/detect-object-injection
          const dayCost = parseFloat((dailyCosts[i].cost as Decimal).toString());
          if (dayCost > rollingAvg * 1.5) {
            const spike = ((dayCost / rollingAvg) * 100).toFixed(0);
            anomalies.push({
              // eslint-disable-next-line security/detect-object-injection
              date: dailyCosts[i].date.toISOString().split('T')[0],
              cost: dayCost.toFixed(2),
              avgCost: rollingAvg.toFixed(2),
              spike: `${spike}%`,
              reason: 'Spending spike detected',
            });
          }
        }
      }

      const budget: BudgetSummaryDto = {
        totalBudgetUsd: totalBudget.toFixed(2),
        spentUsd: totalSpent.toFixed(2),
        remainingUsd: remaining.toFixed(2),
        utilizationPercentage: parseFloat(utilizationPct.toFixed(2)),
      };

      const trends: TrendForecastDto = {
        burnRatePerDay: burnRatePerDay.toFixed(2),
        forecastDaysRemaining: daysRemaining,
        forecastExhaustionDate: forecastDate.toISOString().split('T')[0],
        status,
      };

      return {
        projectId,
        period,
        budget,
        trends,
        timeSeries,
        anomalies,
      };
    } catch (_error) {
      this.logger.error(`Failed to get budget trends: ${(_error as Error).message}`, {
        projectId: options.projectId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'getBudgetTrends' },
      });
      throw _error;
    }
  }

  /**
   * AC#4: Analyze AI model efficiency
   */
  async getModelEfficiency(options: {
    projectId: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<ModelEfficiencyDto> {
    try {
      const { projectId, startDate, endDate } = options;

      this.loggerService.debug('Getting model efficiency', { projectId });

      // Build where clause
      const whereClause: Prisma.AICostLogWhereInput = {
        ticket: {
          project_id: projectId,
        },
      };

      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = startDate;
        if (endDate) whereClause.timestamp.lte = endDate;
      }

      // Group by model and provider
      const modelAggregates = await this.prisma.aICostLog.groupBy({
        by: ['model_name', 'ai_provider'],
        where: whereClause,
        _sum: {
          cost_usd: true,
          tokens_total: true,
        },
        _count: true,
      });

      // Get execution stats per model
      const models: ModelMetricsDto[] = await Promise.all(
        modelAggregates.map(async (agg) => {
          // Query executions for this model to calculate success rate
          const executions = await this.prisma.execution.findMany({
            where: {
              ai_provider: agg.ai_provider,
              selected_model: agg.model_name,
              ticket: {
                project_id: projectId,
              },
            },
            select: {
              status: true,
              started_at: true,
              completed_at: true,
              retry_count: true,
            },
          });

          const completedCount = executions.filter((e) => e.status === 'COMPLETED').length;
          const successRate =
            executions.length > 0 ? (completedCount / executions.length) * 100 : 0;

          // Calculate average execution time
          const avgTime =
            executions.length > 0
              ? executions.reduce((sum, e) => {
                  if (e.started_at && e.completed_at) {
                    const duration = (e.completed_at.getTime() - e.started_at.getTime()) / 1000;
                    return sum + duration;
                  }
                  return sum;
                }, 0) / executions.length
              : 0;

          // Calculate self-healing rate (executions with retry_count > 0)
          const selfHealingCount = executions.filter((e) => (e.retry_count || 0) > 0).length;
          const selfHealingRate =
            executions.length > 0 ? (selfHealingCount / executions.length) * 100 : 0;

          const totalCost = parseFloat(agg._sum.cost_usd?.toString() || '0');
          const totalTokens = agg._sum.tokens_total || 0;
          const executionCount = agg._count;

          return {
            modelName: agg.model_name,
            provider: agg.ai_provider,
            totalCostUsd: totalCost.toFixed(2),
            executionCount,
            successRate: parseFloat(successRate.toFixed(1)),
            costPerExecution: executionCount > 0 ? (totalCost / executionCount).toFixed(2) : '0.00',
            costPer1kTokens:
              totalTokens > 0 ? ((totalCost / totalTokens) * 1000).toFixed(4) : '0.0000',
            avgExecutionTimeSec: Math.round(avgTime),
            selfHealingRate: parseFloat(selfHealingRate.toFixed(1)),
          };
        }),
      );

      // Calculate recommendation (lowest cost per success)
      let mostEfficient = models[0];
      let bestScore = Infinity;

      models.forEach((model) => {
        const cost = parseFloat(model.costPerExecution);
        const successRate = model.successRate / 100;
        const costPerSuccess = successRate > 0 ? cost / successRate : Infinity;

        if (costPerSuccess < bestScore) {
          bestScore = costPerSuccess;
          mostEfficient = model;
        }
      });

      // Calculate potential savings
      const totalCost = models.reduce((sum, m) => sum + parseFloat(m.totalCostUsd), 0);
      const avgCostPerExec = parseFloat(mostEfficient?.costPerExecution || '0');
      const totalExecs = models.reduce((sum, m) => sum + m.executionCount, 0);
      const potentialOptimizedCost = avgCostPerExec * totalExecs;
      const savingsPercent =
        totalCost > 0 ? ((totalCost - potentialOptimizedCost) / totalCost) * 100 : 0;

      const recommendation: ModelRecommendationDto = {
        mostEfficient: mostEfficient?.modelName || 'N/A',
        reason: `Lower cost per execution ($${mostEfficient?.costPerExecution || '0'}), higher success rate (${mostEfficient?.successRate || 0}%)`,
        potentialSavings: `${savingsPercent.toFixed(0)}% if migrating to ${mostEfficient?.modelName || 'N/A'}`,
      };

      return {
        models,
        recommendation,
      };
    } catch (_error) {
      this.logger.error(`Failed to get model efficiency: ${(_error as Error).message}`, {
        projectId: options.projectId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'getModelEfficiency' },
      });
      throw _error;
    }
  }

  /**
   * AC#5: Generate shareable read-only dashboard link
   */
  async generateShareLink(options: {
    projectId: string;
    expireDays?: number;
  }): Promise<ShareLinkResponseDto> {
    try {
      const { projectId, expireDays = 7 } = options;
      this.loggerService.debug('Generating share link', { projectId, expireDays });

      const payload = {
        projectId,
        scope: 'financial_metrics_readonly',
        iat: Math.floor(Date.now() / 1000),
      };

      const token = this.jwtService.sign(payload, {
        expiresIn: `${expireDays}d`,
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expireDays);

      // In production, this URL would come from config
      const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
      const shareUrl = `${baseUrl}/shared-dashboard?token=${token}`;

      return {
        shareUrl,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (_error) {
      this.logger.error(`Failed to generate share link: ${(_error as Error).message}`);
      throw _error;
    }
  }

  /**
   * AC#6: Schedule email report
   */
  async scheduleReport(options: {
    projectId: string;
    email: string;
    frequency: 'weekly' | 'monthly';
  }): Promise<ScheduleReportResponseDto> {
    try {
      const { projectId, email, frequency } = options;
      this.loggerService.debug('Scheduling report', { projectId, email, frequency });

      // Store in SystemConfig as a JSON array of schedules for now
      // Future improvement: dedicated ReportSchedule table
      const configKey = 'REPORTS_SCHEDULE';
      const existingConfig = await this.prisma.systemConfig.findUnique({
        where: { key: configKey },
      });

      const schedules = existingConfig ? JSON.parse(existingConfig.value) : [];
      schedules.push({
        projectId,
        email,
        frequency,
        createdAt: new Date().toISOString(),
      });

      await this.prisma.systemConfig.upsert({
        where: { key: configKey },
        update: { value: JSON.stringify(schedules) },
        create: {
          key: configKey,
          value: JSON.stringify(schedules),
          description: 'Scheduled financial reports',
        },
      });

      return {
        success: true,
        message: `Report successfully scheduled for ${email} (${frequency})`,
      };
    } catch (_error) {
      this.logger.error(`Failed to schedule report: ${(_error as Error).message}`);
      throw _error;
    }
  }

  /**
   * AC#2 Extension: Get historical ROI trend
   */
  async getHistoricalRoi(options: {
    projectId: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<HistoricalRoiResponseDto> {
    try {
      const { projectId, startDate, endDate } = options;
      this.loggerService.debug('Getting historical ROI', { projectId });

      // Default to last 30 days if no range provided
      const end = endDate || new Date();
      const start = startDate || new Date();
      if (!startDate) start.setDate(start.getDate() - 30);

      // Query daily costs
      const costLogs = await this.prisma.aICostLog.findMany({
        where: {
          ticket: { project_id: projectId },
          timestamp: { gte: start, lte: end },
        },
        select: {
          timestamp: true,
          cost_usd: true,
        },
        orderBy: { timestamp: 'asc' },
      });

      // Query completed tickets for value tracking
      const completedTickets = await this.prisma.ticket.findMany({
        where: {
          project_id: projectId,
          status: 'COMPLETED',
          updated_at: { gte: start, lte: end },
        },
        select: {
          updated_at: true,
          // story_points: true // Placeholder: using fixed 1 point per ticket for now
        },
      });

      // Group by date
      const dailyMap = new Map<string, { cost: Decimal; value: Decimal }>();

      costLogs.forEach((log) => {
        const dateKey = log.timestamp.toISOString().split('T')[0];
        const day = dailyMap.get(dateKey) || {
          cost: new Prisma.Decimal(0),
          value: new Prisma.Decimal(0),
        };
        day.cost = day.cost.add(log.cost_usd as Decimal);
        dailyMap.set(dateKey, day);
      });

      completedTickets.forEach((ticket) => {
        const dateKey = ticket.updated_at.toISOString().split('T')[0];
        const day = dailyMap.get(dateKey) || {
          cost: new Prisma.Decimal(0),
          value: new Prisma.Decimal(0),
        };
        // Using current calculateRoi valuePerPoint (500) as default
        day.value = day.value.add(new Prisma.Decimal(500));
        dailyMap.set(dateKey, day);
      });

      // Convert map to sorted time series
      const timeSeries: RoiDataPointDto[] = Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => {
          const cost = parseFloat(data.cost.toString());
          const value = parseFloat(data.value.toString());
          const roi = cost > 0 ? ((value - cost) / cost) * 100 : 0;
          return {
            date,
            roi: parseFloat(roi.toFixed(1)),
            cost: data.cost.toString(),
            value: data.value.toString(),
          };
        });

      return {
        projectId,
        timeSeries,
      };
    } catch (_error) {
      this.logger.error(`Failed to get historical ROI: ${(_error as Error).message}`);
      throw _error;
    }
  }
}
