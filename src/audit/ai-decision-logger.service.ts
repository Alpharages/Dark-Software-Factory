import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLog, Prisma } from '@/prisma/client';

@Injectable()
export class AIDecisionLoggerService {
  private readonly logger = new Logger(AIDecisionLoggerService.name);
  // Fix: Issue #5 - Cache confidence threshold to avoid env var reads on every call
  private readonly confidenceThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
  ) {
    // Parse once at initialization
    const envThreshold = process.env.AI_CONFIDENCE_THRESHOLD;
    this.confidenceThreshold = envThreshold ? parseFloat(envThreshold) : 0.5;

    // Validate the cached value
    if (
      isNaN(this.confidenceThreshold) ||
      this.confidenceThreshold < 0 ||
      this.confidenceThreshold > 1
    ) {
      this.logger.warn(`Invalid AI_CONFIDENCE_THRESHOLD: "${envThreshold}". Using default 0.5`);
      this.confidenceThreshold = 0.5;
    }
  }

  /**
   * Log an AI decision with full audit trail
   * @param data - Decision data to log
   * @returns Created log entry or null on failure
   */
  async logDecision(data: {
    agentName: string;
    action: string;
    reasoning: string;
    ticketId: string;
    executionId?: string;
    inputData: Record<string, unknown>;
    outputData: Record<string, unknown>;
    confidence: number; // 0-1 range
  }): Promise<AIDecisionLog | null> {
    // Fix: Issue #6 - Validate confidence value is within valid range
    if (data.confidence < 0 || data.confidence > 1 || isNaN(data.confidence)) {
      this.logger.error(`Invalid confidence value: ${data.confidence}. Must be between 0 and 1.`, {
        agentName: data.agentName,
        action: data.action,
        ticketId: data.ticketId,
      });
      // Clamp to valid range rather than failing entirely
      data.confidence = Math.max(0, Math.min(1, data.confidence || 0));
    }

    try {
      // 1. Create database entry
      const log = await this.prisma.aIDecisionLog.create({
        data: {
          agent_name: data.agentName,
          action: data.action,
          reasoning: data.reasoning,
          ticket_id: data.ticketId,
          execution_id: data.executionId,
          input_data: data.inputData as Prisma.InputJsonValue,
          output_data: data.outputData as Prisma.InputJsonValue,
          confidence: data.confidence,
        },
      });

      // 2. Record Prometheus metrics (wrap in try-catch since incrementCounter may throw)
      try {
        this.metrics.incrementCounter('audit_logs_total', {
          agent_name: data.agentName,
          action: data.action,
        });
      } catch (err) {
        this.logger.warn('Failed to record metrics', (err as Error).message);
      }

      // 3. Alert on low confidence
      if (data.confidence < this.getConfidenceThreshold()) {
        try {
          this.metrics.incrementCounter('audit_logs_low_confidence_total', {
            agent_name: data.agentName,
          });
        } catch (err) {
          this.logger.warn('Failed to record low-confidence metric', (err as Error).message);
        }

        try {
          this.sentry.captureMessage('Low confidence AI decision', ErrorSeverity.HIGH, {
            agentName: data.agentName,
            action: data.action,
            confidence: data.confidence,
            ticketId: data.ticketId,
            reasoning: data.reasoning,
          });
        } catch (err) {
          this.logger.warn('Failed to send Sentry alert', (err as Error).message);
        }
      }

      // 4. Structured logging with correlation ID
      this.logger.log({
        message: `AI decision logged: ${data.agentName} - ${data.action}`,
        confidence: data.confidence,
        ticketId: data.ticketId,
        correlationId: data.executionId, // For cross-service tracing
      });

      return log;
    } catch (_error) {
      // Database failure - log but don't crash calling service
      const err = _error as Error;
      this.logger.error('Failed to create audit log', {
        error: err.message,
        ticketId: data.ticketId,
        agentName: data.agentName,
      });
      this.sentry.captureException(err);
      return null; // Graceful degradation
    }
  }

  /**
   * AC#1: Get chronological timeline of all decisions for a ticket
   * @param ticketId - Ticket identifier
   * @param correlationId - Optional correlation ID for distributed tracing
   * @returns Array of decisions ordered by timestamp (oldest first)
   */
  async getDecisionTimeline(ticketId: string, correlationId?: string): Promise<AIDecisionLog[]> {
    try {
      const decisions = await this.prisma.aIDecisionLog.findMany({
        where: { ticket_id: ticketId },
        orderBy: { timestamp: 'asc' }, // Chronological order (oldest first)
        include: {
          execution: {
            select: {
              id: true,
              status: true,
              ai_provider: true,
            },
          },
        },
      });

      this.logger.debug(`Retrieved ${decisions.length} decisions for ticket ${ticketId}`, {
        correlationId,
        ticketId,
        count: decisions.length,
      });

      return decisions;
    } catch (_error) {
      const err = _error as Error;
      this.logger.error(`Failed to get timeline for ticket ${ticketId}`, {
        error: err.message,
        correlationId,
        ticketId,
      });
      this.sentry.captureException(err, {
        tags: { operation: 'getDecisionTimeline', ticketId },
        extra: { correlationId },
      });
      return []; // Graceful degradation
    }
  }

  /**
   * AC#2: Get low-confidence decisions for review queue with pagination
   * @param options - Pagination and confidence threshold options
   * @param correlationId - Optional correlation ID for distributed tracing
   * @returns Paginated low-confidence decisions with metadata
   */
  async getLowConfidenceDecisions(
    options: { page: number; limit: number; minConfidence: number } = {
      page: 1,
      limit: 100,
      minConfidence: 0.5,
    },
    correlationId?: string,
  ): Promise<{
    data: AIDecisionLog[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  }> {
    try {
      const { page, limit, minConfidence } = options;
      const skip = (page - 1) * limit;

      const [decisions, total] = await Promise.all([
        this.prisma.aIDecisionLog.findMany({
          where: { confidence: { lt: minConfidence } },
          orderBy: { timestamp: 'desc' }, // Newest first
          skip,
          take: limit,
          include: {
            execution: {
              select: {
                id: true,
                status: true,
                ai_provider: true,
                ticket_id: true,
              },
            },
          },
        }),
        this.prisma.aIDecisionLog.count({
          where: { confidence: { lt: minConfidence } },
        }),
      ]);

      const totalPages = Math.ceil(total / limit);

      this.logger.debug(
        `Retrieved ${decisions.length} low-confidence decisions (page ${page}/${totalPages})`,
        { correlationId, page, totalPages, total },
      );

      return {
        data: decisions,
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
      };
    } catch (_error) {
      const err = _error as Error;
      this.logger.error('Failed to get low-confidence decisions', {
        error: err.message,
        options,
        correlationId,
      });
      this.sentry.captureException(err, {
        tags: { operation: 'getLowConfidenceDecisions' },
        extra: { options, correlationId },
      });
      throw _error; // Propagate for controller error handling
    }
  }

  /**
   * AC#3: Search decisions with flexible filters and pagination
   * @param filters - Search filters and pagination options
   * @param correlationId - Optional correlation ID for distributed tracing
   * @returns Paginated search results with metadata
   */
  async searchDecisions(
    filters: {
      agent_name?: string;
      action?: string;
      ticketId?: string;
      executionId?: string;
      startDate?: Date;
      endDate?: Date;
      page: number;
      limit: number;
    },
    correlationId?: string,
  ): Promise<{
    data: AIDecisionLog[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  }> {
    try {
      const { page, limit, ...searchFilters } = filters;
      const skip = (page - 1) * limit;

      // Build dynamic where clause
      const whereClause: Prisma.AIDecisionLogWhereInput = {};

      if (searchFilters.agent_name) whereClause.agent_name = searchFilters.agent_name;
      if (searchFilters.action) whereClause.action = searchFilters.action;
      if (searchFilters.ticketId) whereClause.ticket_id = searchFilters.ticketId;
      if (searchFilters.executionId) whereClause.execution_id = searchFilters.executionId;

      if (searchFilters.startDate || searchFilters.endDate) {
        whereClause.timestamp = {};
        if (searchFilters.startDate) whereClause.timestamp.gte = searchFilters.startDate;
        if (searchFilters.endDate) whereClause.timestamp.lte = searchFilters.endDate;
      }

      const [decisions, total] = await Promise.all([
        this.prisma.aIDecisionLog.findMany({
          where: whereClause,
          orderBy: { timestamp: 'desc' }, // Newest first
          skip,
          take: limit,
          include: {
            execution: {
              select: {
                id: true,
                status: true,
                ai_provider: true,
                ticket_id: true,
              },
            },
          },
        }),
        this.prisma.aIDecisionLog.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      this.logger.debug(
        `Search returned ${decisions.length} decisions (page ${page}/${totalPages})`,
        {
          correlationId,
          filters: searchFilters,
          page,
          totalPages,
          total,
        },
      );

      return {
        data: decisions,
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
      };
    } catch (_error) {
      const err = _error as Error;
      this.logger.error('Failed to search decisions', {
        error: err.message,
        filters,
        correlationId,
      });
      this.sentry.captureException(err, {
        tags: { operation: 'searchDecisions' },
        extra: { filters, correlationId },
      });
      throw _error; // Propagate for controller error handling
    }
  }

  /**
   * Get the cached confidence threshold
   * @private
   * @returns Configured threshold value
   */
  private getConfidenceThreshold(): number {
    return this.confidenceThreshold;
  }
}
