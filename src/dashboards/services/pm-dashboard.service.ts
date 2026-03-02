import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FinancialMetricsService } from '@/financial-metrics/financial-metrics.service';
import { GitHubService } from '@/github/github.service';
import { QaResultsService } from '@/qa-automation/qa-results.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import {
  ProjectQueryDto,
  ProjectResponseDto,
  DashboardSummaryDto,
  FinancialSummaryDto,
  ProjectStatus,
  TicketSearchQueryDto,
  TicketSearchResponseDto,
} from '../dto/pm-dashboard.dto';

export type UserRole = 'PM' | 'MANAGER' | 'ADMIN';

@Injectable()
export class PmDashboardService {
  private readonly logger = new Logger(PmDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly financialMetricsService: FinancialMetricsService,
    private readonly gitHubService: GitHubService,
    private readonly qaResultsService: QaResultsService,
    private readonly aiDecisionLoggerService: AIDecisionLoggerService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async searchTickets(pmId: string, role: UserRole, queryDto: TicketSearchQueryDto) {
    const { query, page = 1, limit = 10 } = queryDto;
    const skip = (page - 1) * limit;

    // RBAC: PM only sees tickets from their own projects, MANAGER/ADMIN see all
    const where: Prisma.TicketWhereInput = {
      OR: [
        { clickup_task_id: { contains: query, mode: 'insensitive' } },
        { title: { contains: query, mode: 'insensitive' } },
      ],
    };

    if (role === 'PM') {
      where.project = {
        pm_id: pmId,
      };
    }

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updated_at: 'desc' },
        include: {
          project: {
            select: {
              name: true,
              id: true,
            },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    const data: TicketSearchResponseDto[] = tickets.map((t) => ({
      id: t.id,
      name: t.title, // Map title to name for DTO consistency or change DTO
      project_name: t.project.name,
      project_id: t.project.id,
      status: t.status,
      updated_at: t.updated_at,
    }));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getProjects(pmId: string, role: UserRole, query: ProjectQueryDto) {
    const startTime = Date.now();
    const {
      status,
      client,
      min_activity,
      has_blocked,
      sort_by = 'last_activity',
      sort_order = 'desc',
      search,
      page = 1,
      limit = 20,
    } = query;

    const skip = (page - 1) * limit;

    // RBAC: PM only sees their own projects, MANAGER/ADMIN see all
    const where: Prisma.ProjectWhereInput = {};
    if (role === 'PM') {
      where.pm_id = pmId;
    }

    if (status) where.status = status;
    if (client) where.client_name = { contains: client, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { client_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (min_activity) {
      where.updated_at = { gte: new Date(min_activity) };
    }

    if (has_blocked === 'true') {
      where.tickets = {
        some: {
          status: { in: ['QA_FAILED', 'FAILED', 'BLOCKED_CIRCULAR'] },
        },
      };
    }

    // Handle sorting
    let orderBy: Prisma.ProjectOrderByWithRelationInput = {};
    if (sort_by === 'name') orderBy = { name: sort_order };
    else if (sort_by === 'client_name') orderBy = { client_name: sort_order };
    else if (sort_by === 'created_at') orderBy = { created_at: sort_order };
    else if (sort_by === 'last_activity') orderBy = { updated_at: sort_order };
    else orderBy = { updated_at: 'desc' };

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: {
            select: { tickets: true },
          },
          tickets: {
            select: {
              status: true,
              updated_at: true,
            },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    const data: ProjectResponseDto[] = projects.map((p) => {
      const tickets = p.tickets;
      const total = tickets.length;
      const in_progress = tickets.filter((t) =>
        ['AI_PROCESSING', 'QA_REVIEW'].includes(t.status),
      ).length;
      const completed = tickets.filter((t) => ['DEPLOYED', 'COMPLETED'].includes(t.status)).length;
      const blocked = tickets.filter((t) =>
        ['QA_FAILED', 'FAILED', 'BLOCKED_CIRCULAR'].includes(t.status),
      ).length;
      const awaiting_approval = tickets.filter((t) => t.status === 'AWAITING_APPROVAL').length;

      const last_activity =
        tickets.length > 0
          ? new Date(Math.max(...tickets.map((t) => t.updated_at.getTime())))
          : p.updated_at;

      return {
        id: p.id,
        name: p.name,
        client_name: p.client_name,
        created_at: p.created_at,
        updated_at: p.updated_at,
        pm_id: p.pm_id,
        status: p.status as ProjectStatus,
        last_activity,
        tickets: {
          total,
          in_progress,
          completed,
          blocked,
          awaiting_approval,
        },
      };
    });

    this.metricsService.recordHistogram(
      'pm_dashboard_api_duration_seconds',
      (Date.now() - startTime) / 1000,
      { endpoint: 'projects' },
    );

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / (limit || 20)),
      },
    };
  }

  async getSummary(pmId: string, role: UserRole): Promise<DashboardSummaryDto> {
    const cacheKey = `dashboard_summary_${pmId}_${role}`;
    const cachedData = await this.cacheManager.get<DashboardSummaryDto>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const projectWhere: Prisma.ProjectWhereInput = {};
    if (role === 'PM') {
      projectWhere.pm_id = pmId;
    }

    const ticketsWhere: Prisma.TicketWhereInput =
      role === 'PM' ? { project: { is: { pm_id: pmId } } } : {};

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      projectStats,
      ticketStats,
      aiExecutionTimes,
      aiExecutionCounts,
      activeProjectsCount,
      qaTotal,
      qaPassed,
    ] = await Promise.all([
      this.prisma.project.aggregate({
        where: projectWhere,
        _count: {
          id: true,
        },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: ticketsWhere,
        _count: {
          id: true,
        },
      }),
      // H1+H2: select started_at (not ticket.created_at), filter to last 7 days only
      this.prisma.execution.findMany({
        where: {
          ticket: ticketsWhere,
          status: 'COMPLETED',
          started_at: { not: null },
          completed_at: { not: null, gte: sevenDaysAgo },
        },
        select: {
          started_at: true,
          completed_at: true,
        },
      }),
      this.prisma.execution.groupBy({
        by: ['status'],
        where: {
          ticket: ticketsWhere,
          status: { in: ['QUEUED', 'IN_PROGRESS'] },
        },
        _count: {
          id: true,
        },
      }),
      // M1: moved from sequential — fetch active project count in parallel
      this.prisma.project.count({
        where: { ...projectWhere, status: 'active' },
      }),
      // M1: moved from sequential — QA total and passed counts in parallel
      this.prisma.qAResult.count({
        where: { execution: { ticket: ticketsWhere } },
      }),
      this.prisma.qAResult.count({
        where: { execution: { ticket: ticketsWhere }, overall_passed: true },
      }),
    ]);

    // KPI service calls run independently with graceful degradation:
    // a failure in any KPI service must not bring down the entire dashboard summary.
    const [prMergeRateResult, qaFirstPassResult, providerDistributionResult] =
      await Promise.allSettled([
        this.gitHubService.getPrMergeRateStats({ pmId, role }),
        this.qaResultsService.getQaFirstPassRateStats({ pmId, role }),
        this.aiDecisionLoggerService.getProviderDistributionStats({ pmId, role }),
      ]);

    if (prMergeRateResult.status === 'rejected') {
      this.logger.error('getPrMergeRateStats failed', prMergeRateResult.reason);
    }
    if (qaFirstPassResult.status === 'rejected') {
      this.logger.error('getQaFirstPassRateStats failed', qaFirstPassResult.reason);
    }
    if (providerDistributionResult.status === 'rejected') {
      this.logger.error('getProviderDistributionStats failed', providerDistributionResult.reason);
    }

    const prMergeRateStats =
      prMergeRateResult.status === 'fulfilled' ? prMergeRateResult.value : { prMergeRate: 0 };
    const qaFirstPassStats =
      qaFirstPassResult.status === 'fulfilled' ? qaFirstPassResult.value : { qaFirstPassRate: 0 };
    const providerDistributionStats =
      providerDistributionResult.status === 'fulfilled' ? providerDistributionResult.value : [];

    const total_projects = projectStats._count.id;

    const ticketCountsByStatus: Record<string, number> = {};
    ticketStats.forEach((stat) => {
      ticketCountsByStatus[stat.status] = stat._count.id;
    });

    const total_tickets = Object.values(ticketCountsByStatus).reduce((a, b) => a + b, 0);
    const in_progress_tickets =
      (ticketCountsByStatus['AI_PROCESSING'] || 0) + (ticketCountsByStatus['QA_REVIEW'] || 0);
    const completed_tickets =
      (ticketCountsByStatus['DEPLOYED'] || 0) + (ticketCountsByStatus['COMPLETED'] || 0);
    const blocked_tickets =
      (ticketCountsByStatus['QA_FAILED'] || 0) +
      (ticketCountsByStatus['FAILED'] || 0) +
      (ticketCountsByStatus['BLOCKED_CIRCULAR'] || 0);
    const awaiting_approval_tickets = ticketCountsByStatus['AWAITING_APPROVAL'] || 0;

    const avg_completion_rate = total_tickets > 0 ? completed_tickets / total_tickets : 0;

    // Simple utilization logic: ratio of in-progress tickets to total projects
    const utilization_percent =
      total_projects > 0
        ? Math.min(Math.round((in_progress_tickets / (total_projects * 5)) * 100), 100)
        : 0;

    // AI Execution metrics
    const success_rate = qaTotal > 0 ? qaPassed / qaTotal : 0;

    // H1+H4: calculate avg duration using started_at→completed_at; build 7-day daily buckets
    const dailyBuckets: number[][] = Array.from({ length: 7 }, () => []);
    const now = Date.now();
    let totalDurationMs = 0;
    let validExecCount = 0;

    aiExecutionTimes.forEach((exec) => {
      if (exec.started_at && exec.completed_at) {
        const durationMs = exec.completed_at.getTime() - exec.started_at.getTime();
        totalDurationMs += durationMs;
        validExecCount++;

        const daysAgo = Math.floor((now - exec.completed_at.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAgo >= 0 && daysAgo < 7) {
          const bucketIndex = 6 - daysAgo; // index 0 = oldest day, index 6 = today
          // eslint-disable-next-line security/detect-object-injection
          dailyBuckets[bucketIndex].push(durationMs / (1000 * 60 * 60));
        }
      }
    });

    const avg_completion_time_hours =
      validExecCount > 0 ? totalDurationMs / validExecCount / (1000 * 60 * 60) : 0;

    const daily_avg_completion_hours = dailyBuckets.map((bucket) =>
      bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0,
    );

    const executionCountsByStatus: Record<string, number> = {};
    aiExecutionCounts.forEach((stat) => {
      executionCountsByStatus[stat.status] = stat._count.id;
    });
    const active_ai_executions = executionCountsByStatus['IN_PROGRESS'] || 0;
    const queued_ai_executions = executionCountsByStatus['QUEUED'] || 0;

    const result: DashboardSummaryDto = {
      total_projects,
      active_projects: activeProjectsCount,
      total_tickets,
      in_progress_tickets,
      completed_tickets,
      blocked_tickets,
      awaiting_approval_tickets,
      avg_completion_rate,
      utilization_percent,
      success_rate,
      avg_completion_time_hours,
      active_ai_executions,
      queued_ai_executions,
      daily_avg_completion_hours,
      pr_merge_rate: prMergeRateStats.prMergeRate,
      qa_first_pass_rate: qaFirstPassStats.qaFirstPassRate,
      provider_distribution: providerDistributionStats,
    };

    await this.cacheManager.set(cacheKey, result, 60 * 1000); // M2: 60s TTL matches frontend staleTime
    return result;
  }

  async getFinancialSummary(_pmId: string, _role: UserRole): Promise<FinancialSummaryDto> {
    const cacheKey = 'dashboard_financial_summary';
    const cachedData = await this.cacheManager.get<FinancialSummaryDto>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [insights, completedTickets] = await Promise.all([
      this.financialMetricsService.getDashboardBudgetInsights({ days: 14 }),
      this.prisma.ticket.count({
        where: {
          status: { in: ['COMPLETED', 'DEPLOYED'] },
          OR: [
            {
              completion_date: {
                gte: startOfMonth,
                lte: endOfMonth,
              },
            },
            {
              AND: [
                { completion_date: null },
                {
                  updated_at: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                  },
                },
              ],
            },
          ],
        },
      }),
    ]);

    const costPerTicket =
      completedTickets > 0 ? Number((insights.monthlySpend / completedTickets).toFixed(2)) : null;

    const result: FinancialSummaryDto = {
      cost_per_ticket: costPerTicket,
      daily_budget_burn: insights.dailyBudgetBurn,
      budget_ceiling: insights.budgetCeiling,
      budget_forecast: insights.budgetForecast,
    };

    await this.cacheManager.set(cacheKey, result, 60 * 1000);
    return result;
  }
}
