import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { Prisma } from '@/prisma/client';
import {
  CostSummaryDto,
  ProviderCostDto,
  ModelCostDto,
  TicketCostDto,
  CostLogDto,
  BreakdownDto,
  GroupedCostDto,
  PaginationMetaDto,
} from './dto';

type Decimal = Prisma.Decimal;

@Injectable()
export class CostDashboardService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
    private readonly sentry: SentryService,
  ) {
    this.logger = new Logger(CostDashboardService.name);
  }

  /**
   * Get aggregated cost summary for a time period
   */
  async getCostSummary(
    period: 'day' | 'week' | 'month',
    correlationId?: string,
  ): Promise<CostSummaryDto> {
    try {
      // Calculate date range based on period
      const endDate = new Date();
      const startDate = new Date();

      switch (period) {
        case 'day':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setDate(startDate.getDate() - 30);
          break;
      }

      this.loggerService.debug('Getting cost summary', {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        correlationId,
      });

      // Run provider and model aggregations in parallel for performance
      const [providerAggregates, modelAggregates, totalAggregates] = await Promise.all([
        // Group by provider
        this.prisma.aICostLog.groupBy({
          by: ['ai_provider'],
          where: { timestamp: { gte: startDate } },
          _sum: {
            cost_usd: true,
            tokens_input: true,
            tokens_output: true,
          },
          _count: true,
        }),
        // Group by model
        this.prisma.aICostLog.groupBy({
          by: ['model_name'],
          where: { timestamp: { gte: startDate } },
          _sum: {
            cost_usd: true,
            tokens_input: true,
            tokens_output: true,
          },
          _count: true,
        }),
        // Get overall totals
        this.prisma.aICostLog.aggregate({
          where: { timestamp: { gte: startDate } },
          _sum: {
            cost_usd: true,
            tokens_input: true,
            tokens_output: true,
          },
          _count: true,
        }),
      ]);

      // Map provider aggregates to DTO
      const byProvider: ProviderCostDto[] = providerAggregates.map((agg) => ({
        provider: agg.ai_provider,
        costUsd: agg._sum.cost_usd?.toString() || '0.00',
        tokens: (agg._sum.tokens_input || 0) + (agg._sum.tokens_output || 0),
      }));

      // Map model aggregates to DTO
      const byModel: ModelCostDto[] = modelAggregates.map((agg) => ({
        model: agg.model_name,
        costUsd: agg._sum.cost_usd?.toString() || '0.00',
        tokens: (agg._sum.tokens_input || 0) + (agg._sum.tokens_output || 0),
      }));

      return {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalCostUsd: totalAggregates._sum.cost_usd?.toString() || '0.00',
        totalTokensInput: totalAggregates._sum.tokens_input || 0,
        totalTokensOutput: totalAggregates._sum.tokens_output || 0,
        invocationCount: totalAggregates._count,
        byProvider,
        byModel,
      };
    } catch (_error) {
      this.logger.error(`Failed to get cost summary: ${(_error as Error).message}`, {
        period,
        correlationId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'getCostSummary', period },
      });

      // Return zeros on failure (graceful degradation)
      return {
        period,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        totalCostUsd: '0.00',
        totalTokensInput: 0,
        totalTokensOutput: 0,
        invocationCount: 0,
        byProvider: [],
        byModel: [],
      };
    }
  }

  /**
   * Get complete cost breakdown for a specific ticket
   */
  async getTicketCost(ticketId: string, correlationId?: string): Promise<TicketCostDto> {
    try {
      this.loggerService.debug('Getting ticket cost', { ticketId, correlationId });

      // Query all cost logs for the ticket with execution relation
      const costLogs = await this.prisma.aICostLog.findMany({
        where: { ticket_id: ticketId },
        orderBy: { timestamp: 'desc' },
        include: {
          execution: {
            select: {
              id: true,
              status: true,
              ai_provider: true,
              selected_model: true,
            },
          },
        },
      });

      // Calculate totals
      const totalCostUsd = costLogs
        .reduce((sum, log) => {
          const logCost = log.cost_usd as Decimal;
          return sum.add(logCost);
        }, new Prisma.Decimal(0))
        .toString();

      const totalTokens = costLogs.reduce(
        (sum, log) => sum + (log.tokens_input || 0) + (log.tokens_output || 0),
        0,
      );

      // Map to DTOs
      const costLogDtos: CostLogDto[] = costLogs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        aiProvider: log.ai_provider,
        modelName: log.model_name,
        operationType: log.operation_type,
        tokensInput: log.tokens_input,
        tokensOutput: log.tokens_output,
        costUsd: (log.cost_usd as Decimal).toString(),
        execution: log.execution
          ? {
              id: log.execution.id,
              status: log.execution.status,
              aiProvider: log.execution.ai_provider,
              selectedModel: log.execution.selected_model,
            }
          : undefined,
      }));

      return {
        ticketId,
        totalCostUsd,
        totalTokens,
        invocationCount: costLogs.length,
        costLogs: costLogDtos,
      };
    } catch (_error) {
      this.logger.error(`Failed to get ticket cost: ${(_error as Error).message}`, {
        ticketId,
        correlationId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'getTicketCost', ticketId },
      });

      // Return empty result on failure (graceful degradation)
      return {
        ticketId,
        totalCostUsd: '0.00',
        totalTokens: 0,
        invocationCount: 0,
        costLogs: [],
      };
    }
  }

  /**
   * Get cost breakdown grouped by agent or model with pagination
   */
  async getCostBreakdown(
    options: {
      groupBy: 'agent' | 'model';
      page: number;
      limit: number;
      startDate?: Date;
      endDate?: Date;
    },
    correlationId?: string,
  ): Promise<BreakdownDto> {
    try {
      const { groupBy, page = 1, limit = 50, startDate, endDate } = options;

      this.loggerService.debug('Getting cost breakdown', {
        groupBy,
        page,
        limit,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        correlationId,
      });

      // Build where clause for date filtering
      const whereClause: Prisma.AICostLogWhereInput = {};
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = startDate;
        if (endDate) whereClause.timestamp.lte = endDate;
      }

      // Determine groupBy fields
      const groupByFields: Prisma.AICostLogScalarFieldEnum[] =
        groupBy === 'model' ? ['model_name'] : ['ai_provider', 'operation_type'];

      // Calculate pagination offsets
      const skip = (page - 1) * limit;
      const take = limit;

      // Run data query and count query in parallel
      const [breakdownData, totalCount] = await Promise.all([
        this.prisma.aICostLog.groupBy({
          by: groupByFields,
          where: whereClause,
          _sum: {
            cost_usd: true,
            tokens_input: true,
            tokens_output: true,
          },
          _count: true,
          orderBy: {
            _sum: {
              cost_usd: 'desc',
            },
          },
          skip,
          take,
        }),
        // Count total groups for pagination metadata
        this.prisma.aICostLog
          .groupBy({
            by: groupByFields,
            where: whereClause,
          })
          .then((results) => results.length),
      ]);

      // Map to DTOs
      const data: GroupedCostDto[] = (breakdownData as Record<string, unknown>[]).map((group) => {
        const sum = group._sum as Record<string, unknown>;
        return {
          groupKey:
            groupBy === 'model'
              ? (group.model_name as string)
              : `${group.ai_provider as string} (${(group.operation_type as string).replace(/_/g, ' ')})`,
          totalCostUsd: (sum.cost_usd as Prisma.Decimal)?.toString() || '0.00',
          totalTokens: ((sum.tokens_input as number) || 0) + ((sum.tokens_output as number) || 0),
          invocationCount: group._count as number,
        };
      });

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / limit);
      const meta: PaginationMetaDto = {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasMore: page < totalPages,
      };

      return {
        groupBy,
        data,
        meta,
      };
    } catch (_error) {
      this.logger.error(`Failed to get cost breakdown: ${(_error as Error).message}`, {
        groupBy: options.groupBy,
        correlationId,
        error: (_error as Error).stack,
      });
      this.sentry.captureException(_error as Error, {
        tags: { operation: 'getCostBreakdown', groupBy: options.groupBy },
      });

      // Re-throw to let controller handle HTTP status
      throw _error;
    }
  }
}
