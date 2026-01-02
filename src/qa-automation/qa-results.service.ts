/**
 * QA Results Service
 * Story 3.6: Storage and retrieval of QA results
 * FR38: Lead QA can view automated QA results for each ticket
 *
 * Key Methods:
 * - savePartialResult(): Called by Stories 3.1-3.4 to store individual check results
 * - updateOverallStatus(): Called by Story 3.5 after quality gate evaluation
 * - findBy*(): Query methods for dashboards (Stories 5.4, 8.2)
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@/prisma/client';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import {
  IQaResultCreate,
  IQaResultUpdate,
  IQaResultPartial,
  IQaResultQuery,
  IQaResult,
  IQaResultWithExecution,
  IQaResultsPageResponse,
  IQaResultMetrics,
  QaResultFilterStatus,
} from './interfaces';

// Helper to convert null to Prisma.JsonNull for JSON fields
type JsonInput = Record<string, unknown> | null | undefined;
const toJsonValue = (
  value: JsonInput,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined => {
  if (value === null) return Prisma.JsonNull;
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
};

@Injectable()
export class QaResultsService {
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    @InjectMetric(QA_METRICS.QA_RESULTS_QUERIES_TOTAL)
    private readonly queriesCounter: Counter<string>,
    @InjectMetric(QA_METRICS.QA_RESULTS_QUERY_DURATION)
    private readonly queryDuration: Histogram<string>,
  ) {
    this.defaultPageSize = this.configService.get<number>(
      'qualityGate.results.defaultPageSize',
      20,
    );
    this.maxPageSize = this.configService.get<number>('qualityGate.results.maxPageSize', 100);
  }

  /**
   * Save partial QA result - CRITICAL METHOD for Stories 3.1-3.4 integration
   * Each QA check story calls this to store their specific results.
   * Uses upsert pattern to handle concurrent updates safely.
   *
   * @example Story 3.1 (Linting):
   * await qaResultsService.savePartialResult(executionId, {
   *   linting_passed: true,
   *   linting_errors: []
   * });
   *
   * @example Story 3.2 (Testing):
   * await qaResultsService.savePartialResult(executionId, {
   *   tests_passed: false,
   *   test_results: { failed: ['test1'] }
   * });
   */
  async savePartialResult(executionId: string, partialData: IQaResultPartial): Promise<IQaResult> {
    this.logger.debug(`Saving partial QA result for execution ${executionId}`, {
      fields: Object.keys(partialData),
    });

    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    let result;
    if (existing) {
      result = await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          ...(partialData.linting_passed !== undefined && {
            linting_passed: partialData.linting_passed,
          }),
          ...(partialData.linting_errors !== undefined && {
            linting_errors: toJsonValue(partialData.linting_errors),
          }),
          ...(partialData.tests_passed !== undefined && { tests_passed: partialData.tests_passed }),
          ...(partialData.test_results !== undefined && {
            test_results: toJsonValue(partialData.test_results),
          }),
          ...(partialData.test_coverage !== undefined && {
            test_coverage: partialData.test_coverage,
          }),
          ...(partialData.code_review_passed !== undefined && {
            code_review_passed: partialData.code_review_passed,
          }),
          ...(partialData.code_review_issues !== undefined && {
            code_review_issues: toJsonValue(partialData.code_review_issues),
          }),
        },
      });
    } else {
      result = await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: partialData.linting_passed ?? false,
          linting_errors: toJsonValue(partialData.linting_errors ?? null),
          tests_passed: partialData.tests_passed ?? false,
          test_results: toJsonValue(partialData.test_results ?? null),
          test_coverage: partialData.test_coverage ?? null,
          code_review_passed: partialData.code_review_passed ?? false,
          code_review_issues: toJsonValue(partialData.code_review_issues ?? null),
          overall_passed: false, // Will be set by Story 3.5
        },
      });
    }

    this.logger.debug(`Saved partial QA result ${result.id} for execution ${executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Create a new QA result record (internal use)
   * Alias for savePartialResult with full data
   */
  async create(data: IQaResultCreate): Promise<IQaResult> {
    this.logger.debug(`Creating QA result for execution ${data.executionId}`);

    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: data.executionId },
    });

    let result;
    if (existing) {
      result = await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          ...(data.linting_passed !== undefined && { linting_passed: data.linting_passed }),
          ...(data.linting_errors !== undefined && {
            linting_errors: toJsonValue(data.linting_errors),
          }),
          ...(data.tests_passed !== undefined && { tests_passed: data.tests_passed }),
          ...(data.test_results !== undefined && { test_results: toJsonValue(data.test_results) }),
          ...(data.test_coverage !== undefined && { test_coverage: data.test_coverage }),
          ...(data.code_review_passed !== undefined && {
            code_review_passed: data.code_review_passed,
          }),
          ...(data.code_review_issues !== undefined && {
            code_review_issues: toJsonValue(data.code_review_issues),
          }),
          ...(data.overall_passed !== undefined && { overall_passed: data.overall_passed }),
        },
      });
    } else {
      result = await this.prisma.qAResult.create({
        data: {
          execution_id: data.executionId,
          linting_passed: data.linting_passed ?? false,
          linting_errors: toJsonValue(data.linting_errors ?? null),
          tests_passed: data.tests_passed ?? false,
          test_results: toJsonValue(data.test_results ?? null),
          test_coverage: data.test_coverage ?? null,
          code_review_passed: data.code_review_passed ?? false,
          code_review_issues: toJsonValue(data.code_review_issues ?? null),
          overall_passed: data.overall_passed ?? false,
        },
      });
    }

    this.logger.debug(`Created QA result ${result.id} for execution ${data.executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Update an existing QA result by execution ID
   */
  async update(executionId: string, data: IQaResultUpdate): Promise<IQaResult> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    if (!existing) {
      throw new NotFoundException(`QA result not found for execution ${executionId}`);
    }

    const result = await this.prisma.qAResult.update({
      where: { id: existing.id },
      data: {
        ...(data.linting_passed !== undefined && { linting_passed: data.linting_passed }),
        ...(data.linting_errors !== undefined && {
          linting_errors: toJsonValue(data.linting_errors),
        }),
        ...(data.tests_passed !== undefined && { tests_passed: data.tests_passed }),
        ...(data.test_results !== undefined && { test_results: toJsonValue(data.test_results) }),
        ...(data.test_coverage !== undefined && { test_coverage: data.test_coverage }),
        ...(data.code_review_passed !== undefined && {
          code_review_passed: data.code_review_passed,
        }),
        ...(data.code_review_issues !== undefined && {
          code_review_issues: toJsonValue(data.code_review_issues),
        }),
        ...(data.overall_passed !== undefined && { overall_passed: data.overall_passed }),
      },
    });

    this.logger.debug(`Updated QA result ${result.id} for execution ${executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Update only the overall_passed status after quality gate evaluation
   * Called by Story 3.5 (Quality Gate Decision Engine)
   */
  async updateOverallStatus(executionId: string, passed: boolean): Promise<void> {
    await this.prisma.qAResult.updateMany({
      where: { execution_id: executionId },
      data: { overall_passed: passed },
    });
    this.logger.debug(`Updated overall status for execution ${executionId}: ${passed}`);
  }

  /**
   * Find QA result by execution ID
   */
  async findByExecutionId(executionId: string): Promise<IQaResultWithExecution> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_execution' });
    this.queriesCounter.inc({ query_type: 'by_execution' });

    try {
      const result = await this.prisma.qAResult.findFirst({
        where: { execution_id: executionId },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              ai_provider: true,
              status: true,
              ticket: {
                select: {
                  id: true,
                  title: true,
                  project_id: true,
                  clickup_task_id: true,
                },
              },
            },
          },
        },
      });

      if (!result) {
        throw new NotFoundException(`QA result not found for execution ${executionId}`);
      }

      return this.mapToInterfaceWithExecution(result);
    } finally {
      endTimer();
    }
  }

  /**
   * Legacy method - Get result by execution ID (returns raw Prisma type)
   * @deprecated Use findByExecutionId for new code
   */
  async getResult(executionId: string): Promise<IQaResult> {
    const result = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });
    if (!result) {
      throw new NotFoundException(`QA result not found for execution ${executionId}`);
    }
    return this.mapToInterface(result);
  }

  /**
   * Find QA results by ticket ID with pagination
   */
  async findByTicketId(
    ticketId: string,
    query: IQaResultQuery = {},
  ): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_ticket' });
    this.queriesCounter.inc({ query_type: 'by_ticket' });

    try {
      return this.findWithFilters({ ...query, ticketId });
    } finally {
      endTimer();
    }
  }

  /**
   * Legacy method - Get results by ticket ID (returns array)
   * @deprecated Use findByTicketId for new code with pagination
   */
  async getResultsByTicket(ticketId: string): Promise<IQaResult[]> {
    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: ticketId },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    const results = await this.prisma.qAResult.findMany({
      where: { execution_id: { in: executionIds } },
      orderBy: { created_at: 'desc' },
    });

    return results.map((r) => this.mapToInterface(r));
  }

  /**
   * Find QA results by project ID with filters and pagination
   */
  async findByProjectId(
    projectId: string,
    query: IQaResultQuery = {},
  ): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_project' });
    this.queriesCounter.inc({ query_type: 'by_project' });

    try {
      return this.findWithFilters({ ...query, projectId });
    } finally {
      endTimer();
    }
  }

  /**
   * Legacy method - Get results by project ID (returns array)
   * @deprecated Use findByProjectId for new code with pagination
   */
  async getResultsByProject(
    projectId: string,
    filters?: { status?: 'passed' | 'failed' },
  ): Promise<IQaResult[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: { project_id: projectId },
      select: { id: true },
    });
    const ticketIds = tickets.map((t) => t.id);

    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: { in: ticketIds } },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    const results = await this.prisma.qAResult.findMany({
      where: {
        execution_id: { in: executionIds },
        ...(filters?.status === 'passed' && { overall_passed: true }),
        ...(filters?.status === 'failed' && { overall_passed: false }),
      },
      orderBy: { created_at: 'desc' },
    });

    return results.map((r) => this.mapToInterface(r));
  }

  /**
   * Query QA results with filters and pagination
   */
  async query(query: IQaResultQuery): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'general' });
    this.queriesCounter.inc({ query_type: 'general' });

    try {
      return this.findWithFilters(query);
    } finally {
      endTimer();
    }
  }

  /**
   * Get aggregated metrics for a project
   * Uses Prisma aggregation for efficiency instead of loading all records
   */
  async getMetrics(projectId: string, startDate?: Date, endDate?: Date): Promise<IQaResultMetrics> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'metrics' });
    this.queriesCounter.inc({ query_type: 'metrics' });

    try {
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
      const end = endDate || new Date();

      // Get execution IDs for project via a single efficient query
      const executions = await this.prisma.execution.findMany({
        where: {
          ticket: { project_id: projectId },
        },
        select: { id: true },
      });

      const executionIds = executions.map((e) => e.id);

      if (executionIds.length === 0) {
        return this.emptyMetrics(projectId, start, end);
      }

      // Use Prisma aggregation for efficiency
      const [aggregates, results] = await Promise.all([
        this.prisma.qAResult.aggregate({
          where: {
            execution_id: { in: executionIds },
            created_at: { gte: start, lte: end },
          },
          _count: { id: true },
          _avg: { test_coverage: true },
        }),
        this.prisma.qAResult.findMany({
          where: {
            execution_id: { in: executionIds },
            created_at: { gte: start, lte: end },
          },
          select: {
            overall_passed: true,
            linting_passed: true,
            tests_passed: true,
            code_review_passed: true,
            test_coverage: true,
            created_at: true,
          },
        }),
      ]);

      const totalExecutions = aggregates._count.id;
      const passedCount = results.filter((r) => r.overall_passed).length;
      const failedCount = totalExecutions - passedCount;
      const passRate = totalExecutions > 0 ? (passedCount / totalExecutions) * 100 : 0;
      const averageCoverage = aggregates._avg.test_coverage ?? 0;

      const lintingPassRate =
        totalExecutions > 0
          ? (results.filter((r) => r.linting_passed).length / totalExecutions) * 100
          : 0;
      const testPassRate =
        totalExecutions > 0
          ? (results.filter((r) => r.tests_passed).length / totalExecutions) * 100
          : 0;
      const securityPassRate =
        totalExecutions > 0
          ? (results.filter((r) => r.code_review_passed).length / totalExecutions) * 100
          : 0;

      // Calculate daily trends
      const trendMap = new Map<string, { passed: number; failed: number; coverage: number[] }>();

      results.forEach((r) => {
        const dateKey = r.created_at.toISOString().split('T')[0];
        if (!trendMap.has(dateKey)) {
          trendMap.set(dateKey, { passed: 0, failed: 0, coverage: [] });
        }
        const day = trendMap.get(dateKey)!;
        if (r.overall_passed) {
          day.passed++;
        } else {
          day.failed++;
        }
        if (r.test_coverage !== null) {
          day.coverage.push(r.test_coverage);
        }
      });

      const trends = Array.from(trendMap.entries())
        .map(([date, data]) => ({
          date,
          passed: data.passed,
          failed: data.failed,
          coverage:
            data.coverage.length > 0
              ? Math.round(data.coverage.reduce((a, b) => a + b, 0) / data.coverage.length)
              : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        projectId,
        dateRange: { start, end },
        totalExecutions,
        passedCount,
        failedCount,
        passRate: Math.round(passRate * 100) / 100,
        averageCoverage: Math.round(averageCoverage * 100) / 100,
        lintingPassRate: Math.round(lintingPassRate * 100) / 100,
        testPassRate: Math.round(testPassRate * 100) / 100,
        securityPassRate: Math.round(securityPassRate * 100) / 100,
        trends,
      };
    } finally {
      endTimer();
    }
  }

  /**
   * Override quality gate for an execution (emergency use)
   */
  async overrideQualityGate(
    executionId: string,
    reason: string,
    approvedBy: string,
  ): Promise<void> {
    // Update QA result to passed (emergency override)
    await this.prisma.qAResult.updateMany({
      where: { execution_id: executionId },
      data: { overall_passed: true },
    });

    // Create audit log for override
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'qa_result',
        entity_id: executionId,
        action: 'quality_gate_override',
        actor_type: 'user',
        actor_id: approvedBy,
        after_state: { reason, overrideAt: new Date().toISOString() },
      },
    });

    this.logger.warn(
      `Quality gate override for execution ${executionId} by ${approvedBy}: ${reason}`,
    );
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Consolidated query method - handles all filter combinations
   */
  private async findWithFilters(query: IQaResultQuery): Promise<IQaResultsPageResponse> {
    const { page = 1, limit = this.defaultPageSize } = query;
    const effectiveLimit = Math.min(limit, this.maxPageSize);
    const skip = (page - 1) * effectiveLimit;

    // Build execution filter for ticket/project filtering
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executionFilter: any = {};
    if (query.ticketId) {
      executionFilter.ticket_id = query.ticketId;
    }
    if (query.projectId) {
      executionFilter.ticket = { project_id: query.projectId };
    }

    // Build QA result filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qaResultFilter: any = {};
    if (query.status === QaResultFilterStatus.PASSED) {
      qaResultFilter.overall_passed = true;
    } else if (query.status === QaResultFilterStatus.FAILED) {
      qaResultFilter.overall_passed = false;
    }
    if (query.startDate || query.endDate) {
      qaResultFilter.created_at = {};
      if (query.startDate) qaResultFilter.created_at.gte = query.startDate;
      if (query.endDate) qaResultFilter.created_at.lte = query.endDate;
    }

    // If filtering by ticket/project, get execution IDs first
    if (query.ticketId || query.projectId) {
      const executions = await this.prisma.execution.findMany({
        where: executionFilter,
        select: { id: true },
      });

      if (executions.length === 0) {
        return this.buildPaginatedResponse([], 0, page, effectiveLimit);
      }

      qaResultFilter.execution_id = { in: executions.map((e) => e.id) };
    }

    const [results, total] = await Promise.all([
      this.prisma.qAResult.findMany({
        where: qaResultFilter,
        skip,
        take: effectiveLimit,
        orderBy: { created_at: 'desc' },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              ai_provider: true,
              status: true,
              ticket: {
                select: {
                  id: true,
                  title: true,
                  project_id: true,
                  clickup_task_id: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.qAResult.count({ where: qaResultFilter }),
    ]);

    const data = results.map((r) => this.mapToInterfaceWithExecution(r));
    return this.buildPaginatedResponse(data, total, page, effectiveLimit);
  }

  /**
   * Build standardized paginated response
   */
  private buildPaginatedResponse(
    data: IQaResultWithExecution[],
    total: number,
    page: number,
    limit: number,
  ): IQaResultsPageResponse {
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      pageInfo: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  private emptyMetrics(projectId: string, start: Date, end: Date): IQaResultMetrics {
    return {
      projectId,
      dateRange: { start, end },
      totalExecutions: 0,
      passedCount: 0,
      failedCount: 0,
      passRate: 0,
      averageCoverage: 0,
      lintingPassRate: 0,
      testPassRate: 0,
      securityPassRate: 0,
      trends: [],
    };
  }

  private mapToInterface(result: Record<string, unknown>): IQaResult {
    return {
      id: result.id,
      execution_id: result.execution_id,
      linting_passed: result.linting_passed,
      linting_errors: result.linting_errors as Record<string, unknown> | null,
      tests_passed: result.tests_passed,
      test_results: result.test_results as Record<string, unknown> | null,
      test_coverage: result.test_coverage,
      code_review_passed: result.code_review_passed,
      code_review_issues: result.code_review_issues as Record<string, unknown> | null,
      overall_passed: result.overall_passed,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  }

  private mapToInterfaceWithExecution(result: Record<string, unknown>): IQaResultWithExecution {
    const base = this.mapToInterface(result);
    return {
      ...base,
      execution: result.execution
        ? {
            id: result.execution.id,
            ticket_id: result.execution.ticket_id,
            ai_provider: result.execution.ai_provider,
            status: result.execution.status,
            ticket: result.execution.ticket,
          }
        : undefined,
    };
  }
}
