import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLog, Prisma } from '@/prisma/client';

@Injectable()
export class AIDecisionLoggerService {
  private readonly logger = new Logger(AIDecisionLoggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
  ) {}

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
    } catch (error) {
      // Database failure - log but don't crash calling service
      const err = error as Error;
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
   * Get AI decision timeline for a specific ticket in chronological order
   * @param ticketId - Ticket identifier
   * @returns Array of decisions ordered by timestamp
   */
  async getDecisionTimeline(ticketId: string): Promise<AIDecisionLog[]> {
    return this.prisma.aIDecisionLog.findMany({
      where: { ticket_id: ticketId },
      orderBy: { timestamp: 'asc' },
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
  }

  /**
   * Get low-confidence decisions for human review
   * @param threshold - Confidence threshold (default: 0.5)
   * @returns Array of low-confidence decisions
   */
  async getLowConfidenceDecisions(threshold: number = 0.5): Promise<AIDecisionLog[]> {
    return this.prisma.aIDecisionLog.findMany({
      where: { confidence: { lt: threshold } },
      orderBy: { timestamp: 'desc' },
      take: 100, // Performance limit
    });
  }

  /**
   * Get confidence threshold from environment
   * @private
   * @returns Configured threshold value
   */
  private getConfidenceThreshold(): number {
    return parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.5');
  }
}
