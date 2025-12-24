import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AIProvider, Prisma } from '@/prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { AI_PROVIDER_RATES, ALERT_THRESHOLDS } from '@/common/metrics/metrics.constants';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';

@Injectable()
export class AICostTrackerService {
  private readonly logger = new Logger(AICostTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Calculate USD cost based on model and token counts
   */
  calculateUSD(model: string, inputTokens: number, outputTokens: number): Decimal {
    const rates =
      AI_PROVIDER_RATES[model as keyof typeof AI_PROVIDER_RATES] || AI_PROVIDER_RATES.default;

    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;

    return new Decimal(inputCost + outputCost);
  }

  /**
   * Log AI cost to database and Prometheus
   */
  async logCost(params: {
    executionId?: string;
    ticketId?: string;
    provider: AIProvider;
    model: string;
    inputTokens: number;
    outputTokens: number;
    agentName: string;
    operationType: string;
  }): Promise<void> {
    const {
      executionId,
      ticketId,
      provider,
      model,
      inputTokens,
      outputTokens,
      agentName,
      operationType,
    } = params;

    const costUsd = this.calculateUSD(model, inputTokens, outputTokens);

    try {
      // 1. Log to Database
      await this.prisma.aICostLog.create({
        data: {
          execution_id: executionId,
          ticket_id: ticketId,
          ai_provider: provider,
          model_name: model,
          operation_type: operationType,
          tokens_input: inputTokens,
          tokens_output: outputTokens,
          tokens_total: inputTokens + outputTokens,
          cost_usd: costUsd,
        },
      });

      // 2. Log to Prometheus
      this.metrics.recordAICost({
        provider: provider.toString(),
        model,
        inputTokens,
        outputTokens,
        costUsd: costUsd.toNumber(),
        agentName,
        operationType,
        projectId: ticketId ? await this.getProjectId(ticketId) : undefined,
      });

      this.logger.log(
        `Logged AI cost: ${costUsd.toFixed(6)} USD (${model}, in:${inputTokens}, out:${outputTokens})`,
      );

      // 3. Check Budget Thresholds
      if (ticketId) {
        await this.checkBudgetThresholds(ticketId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to log AI cost: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Check budget thresholds and trigger alerts
   */
  private async checkBudgetThresholds(ticketId: string): Promise<void> {
    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          project_id: true,
          project: {
            select: {
              budget_usd: true,
            },
          },
        },
      });

      if (!ticket || !ticket.project) return;

      const projectId = ticket.project_id;
      const projectBudget = ticket.project.budget_usd
        ? ticket.project.budget_usd.toNumber()
        : 100.0; // Fallback to $100 if not set

      const totalCostAggregation = await this.prisma.aICostLog.aggregate({
        where: {
          ticket: {
            project_id: projectId,
          },
        },
        _sum: {
          cost_usd: true,
        },
      });

      const currentTotal = totalCostAggregation?._sum?.cost_usd?.toNumber() || 0;
      const utilizationPercent = (currentTotal / projectBudget) * 100;

      this.metrics.setBudgetUtilization(projectId, utilizationPercent);

      if (utilizationPercent >= ALERT_THRESHOLDS.COST_BUDGET_CRITICAL) {
        this.sentry.captureMessage(
          `CRITICAL: Project ${projectId} has reached ${utilizationPercent.toFixed(1)}% of its AI budget (${currentTotal.toFixed(2)} / ${projectBudget.toFixed(2)} USD)`,
          ErrorSeverity.FATAL,
        );
      } else if (utilizationPercent >= ALERT_THRESHOLDS.COST_BUDGET_WARNING) {
        this.sentry.captureMessage(
          `WARNING: Project ${projectId} has reached ${utilizationPercent.toFixed(1)}% of its AI budget`,
          ErrorSeverity.HIGH,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to check budget thresholds: ${(error as Error).message}`);
    }
  }

  private async getProjectId(ticketId: string): Promise<string | undefined> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { project_id: true },
    });
    return ticket?.project_id;
  }
}
