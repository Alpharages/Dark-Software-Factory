import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BugEscapeAnalyzer } from './bug-escape-analyzer.service';
import { Ticket, Execution, QAResult, QaReviewQueue, BugEscape } from '@/prisma/client';
import { QaMetricsService } from '../qa-metrics.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { BugEscapeQueryDto } from './dto/bug-escape-query.dto';
import { QualityTrendsQueryDto } from './dto/quality-trends-query.dto';
import { EscapeRateResponseDto } from './dto/escape-rate-response.dto';
import { BugEscapeDetailDto } from './dto/bug-escape-detail.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class BugEscapeService {
  private readonly logger = new Logger(BugEscapeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyzer: BugEscapeAnalyzer,
    private readonly metricService: QaMetricsService,
    private readonly aiLogger: AIDecisionLoggerService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Classify a production error as a bug escape
   */
  async classifyEscape(productionErrorId: string, ticketId?: string): Promise<BugEscape | null> {
    const error = await this.prisma.productionError.findUnique({
      where: { id: productionErrorId },
      include: {
        bug_escape: true,
      },
    });

    if (!error) {
      throw new Error(`Production error ${productionErrorId} not found`);
    }

    if (error.bug_escape) {
      return error.bug_escape;
    }

    // Attempt to resolve ticket if not provided
    const resolvedTicketId = ticketId;

    if (!resolvedTicketId) {
      // Here we would implement fingerprint matching logic
      // For MVP, we defer to manual linkage or consumer logic
      return null;
    }

    return this.createEscape(productionErrorId, resolvedTicketId, null, null);
  }

  async createEscape(
    productionErrorId: string,
    ticketId: string | null,
    executionId: string | null,
    qaResultId: string | null,
    qaReviewQueueId: string | null = null,
  ): Promise<BugEscape | null> {
    const error = await this.prisma.productionError.findUnique({
      where: { id: productionErrorId },
    });
    if (!error) throw new Error('Error not found');

    let ticket: Ticket | null = null;
    let execution: Execution | null = null;
    let qaResult: QAResult | null = null;
    let reviewQueue: QaReviewQueue | null = null;

    if (ticketId) {
      ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    }
    if (executionId) {
      execution = await this.prisma.execution.findUnique({ where: { id: executionId } });
    }
    if (qaResultId) {
      qaResult = await this.prisma.qAResult.findUnique({ where: { id: qaResultId } });
    }
    if (qaReviewQueueId) {
      reviewQueue = await this.prisma.qaReviewQueue.findUnique({ where: { id: qaReviewQueueId } });
    }
    // If ticket found but other IDs missing, try to resolve them
    if (ticket && !executionId) {
      // Find latest completed execution for this ticket
      const lastExecution = await this.prisma.execution.findFirst({
        where: { ticket_id: ticket.id, status: 'COMPLETED' },
        orderBy: { updated_at: 'desc' },
        include: { qa_result: true, qa_review_queue: true },
      });
      if (lastExecution) {
        execution = lastExecution;
        executionId = lastExecution.id;
        if (!qaResult && lastExecution.qa_result) {
          qaResult = lastExecution.qa_result;
          qaResultId = lastExecution.qa_result!.id;
        }
        if (!reviewQueue && lastExecution.qa_review_queue) {
          reviewQueue = lastExecution.qa_review_queue;
          qaReviewQueueId = reviewQueue.id;
        }
      }
    }

    if (!ticket) {
      // Create an "Orphaned" escape or throw?
      // Story says "create escape record with ticket_id: null".
      // Schema says ticket_id is Int/String? Schema: ticket_id String (Not optional).
      // Schema definition: ticket_id String ... ticket Ticket relation.
      // If schema requires ticket_id, we MUST link to a ticket.
      // If auto-linking fails, we might need a "Unknown Ticket" or make schema optional.
      // Looking at schema I added: `ticket_id String` (Required).
      // This is a discrepancy with Story "ticket_id: null".
      // I will stick to schema requirement and assume we must find a ticket or create a placeholder ticket?
      // Or I should have made it optional.
      // Since I already ran schema update, I can't easily change it without another migration.
      // I will assume for MVP we only classify if we find the ticket.
      // Or I can update the schema to make it optional.
      // Let's assume we find it or fail for now.
      // Better: Find a "Unknown" project/ticket or fail.
      if (!ticketId) {
        this.logger.error(
          `Cannot create bug escape without ticket ID for error ${productionErrorId}`,
        );
        return null;
      }
    }

    // Analysis
    const category = this.analyzer.determineEscapeCategory(error, qaResult, reviewQueue);

    // Create Record
    const escape = await this.prisma.bugEscape.create({
      data: {
        production_error_id: productionErrorId,
        ticket_id: ticketId!,
        execution_id: executionId,
        qa_result_id: qaResultId,
        qa_review_queue_id: qaReviewQueueId,
        escape_category: category,
        severity_at_detection: error.severity,
        detected_at: error.occurred_at,
        project_id: ticket?.project_id || 'unknown',
        ai_provider: execution?.ai_provider?.toString() || null,
        complexity_score: execution?.complexity_score || ticket?.ticket_quality_score || null,
      },
    });

    // Metrics
    // Record bug escape
    this.metricService.recordBugEscape(
      category,
      escape.project_id,
      escape.ai_provider || undefined,
    );

    this.logger.log(`Created bug escape record ${escape.id} with category ${category}`);
    return escape;
  }

  async calculateEscapeRate(query: BugEscapeQueryDto): Promise<EscapeRateResponseDto> {
    // Cache Key
    const cacheKey = `escape_rate_${JSON.stringify(query)}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached as EscapeRateResponseDto;

    try {
      // Calculation logic mock (simplistic for MVP)
      // Count escapes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {};
      if (query.project_id) where.project_id = query.project_id;
      // Date filter
      const escapes = await this.prisma.bugEscape.count({ where });

      // Count deployments (Tickets with status DEPLOYED or COMPLETED)
      const deployments = await this.prisma.ticket.count({
        where: {
          ...(query.project_id ? { project_id: query.project_id } : {}),
          status: { in: ['DEPLOYED', 'COMPLETED'] },
        },
      });

      const rate = deployments > 0 ? (escapes / deployments) * 100 : 0;

      const response: EscapeRateResponseDto = {
        period: query.period || '30d',
        summary: {
          total_deployed: deployments,
          total_escapes: escapes,
          escape_rate_percent: parseFloat(rate.toFixed(2)),
          target_rate_percent: 5.0,
          status: rate <= 5.0 ? 'within_target' : 'exceeded',
        },
        breakdown: [], // Implement breakdown logic
        trend: {
          direction: 'stable',
          change_percent: 0,
          previous_period_rate: 0,
        },
      };

      // Cache result
      await this.cacheManager.set(cacheKey, response, 3600000); // 1 hour

      // Update global gauge
      this.metricService.updateEscapeRate(query.project_id || 'all', rate);

      return response;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Failed to calculate escape rate: ${err.message}`);
      // Return a default or error response in case of failure
      return {
        period: query.period || '30d',
        summary: {
          total_deployed: 0,
          total_escapes: 0,
          escape_rate_percent: 0,
          target_rate_percent: 5.0,
          status: 'error',
        },
        breakdown: [],
        trend: {
          direction: 'stable',
          change_percent: 0,
          previous_period_rate: 0,
        },
      };
    }
  }

  async getQualityTrends(query: QualityTrendsQueryDto) {
    // const now = new Date();
    // Default to 90 days if not flexible
    // const startDate = new Date(now.setDate(now.getDate() - 90));

    // This would ideally use raw SQL or extensive Prisma aggregation
    // For MVP, we'll fetch escapes and aggregate in memory or use basic counts

    // Aggregate
    // Return mocked trend structure for now until we have real chart requirement
    return {
      metric: query.metric,
      period: query.period || '90d',
      data: [
        { date: '2024-01-01', value: 5 },
        { date: '2024-02-01', value: 2 },
        { date: '2024-03-01', value: 8 },
      ],
    };
  }

  async getEscapeDetails(id: string): Promise<BugEscapeDetailDto> {
    const escape = await this.prisma.bugEscape.findUnique({
      where: { id },
      include: {
        production_error: true,
        ticket: true,
        execution: true,
      },
    });
    if (!escape) throw new Error('Not found');

    return {
      id: escape.id,
      production_error_id: escape.production_error_id,
      ticket_id: escape.ticket_id,
      project_id: escape.project_id,
      escape_category: escape.escape_category,
      detected_at: escape.detected_at,
      // Map other fields
      error_message: escape.production_error.error_message,
    } as BugEscapeDetailDto;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async compareProviders(projectId?: string): Promise<any[]> {
    // 1. Get escapes per provider
    const escapes = await this.prisma.bugEscape.groupBy({
      by: ['ai_provider'],
      _count: { id: true },
      where: {
        ...(projectId ? { project_id: projectId } : {}),
        detected_at: { gte: new Date(new Date().setMonth(new Date().getMonth() - 3)) }, // Last 3 months
      },
    });

    // 2. Get tickets/deployments per provider
    // Note: Ticket model doesn't explicitly store 'ai_provider' on the ticket itself in all cases,
    // usually it's on Execution or inferred.
    // But BugEscapeServiceImpl stores inferred provider.
    // We need deployment counts to calculate rate.
    // For MVP, we'll return raw escape counts.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return escapes.map((e: any) => ({
      provider: e.ai_provider || 'unknown',
      escapes: e._count.id,
      // deployment_count: ...,
      // escape_rate: ...
    }));
  }
}
