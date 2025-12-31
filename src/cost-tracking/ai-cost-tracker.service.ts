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
  ) { }

  /**
   * Check if project budget allows for this execution
   */
  async checkBudgetAvailability(
    ticketId: string,
    estimatedCost: Decimal,
  ): Promise<{ allowed: boolean; reason?: string; budget?: number; spend?: number }> {
    try {
      // 1. Get Project Budget
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          project_id: true,
          project: {
            select: { budget_usd: true },
          },
        },
      });

      if (!ticket || !ticket.project) {
        // Warning: Ticket or Project not found.
        // FAIL CLOSED: Block execution to prevent unauthorized spend.
        this.logger.error(`Ticket ${ticketId} or associated Project not found for budget check.`);
        return { allowed: false, reason: 'Project context not found (Fail Closed)' };
      }

      const projectId = ticket.project_id;
      const budget = ticket.project.budget_usd
        ? ticket.project.budget_usd.toNumber()
        : 100.0; // Default $100

      // 2. Get Current Spend
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

      const currentSpend = totalCostAggregation?._sum?.cost_usd?.toNumber() || 0;
      const estimatedTotal = currentSpend + estimatedCost.toNumber();

      // 3. Check Limit
      if (estimatedTotal > budget) {
        return {
          allowed: false,
          reason: `Project budget exceeded (${estimatedTotal.toFixed(2)} > ${budget.toFixed(2)})`,
          budget,
          spend: currentSpend,
        };
      }

      return {
        allowed: true,
        budget,
        spend: currentSpend,
      };
    } catch (error) {
      this.logger.error(`Failed to check budget availability: ${(error as Error).message}`);
      // Fail open or closed? "Prevent unexpected cost overruns" suggests Fail Closed.
      // But if DB is down, blocking everything might be bad.
      // Let's return allowed: true but with reason, same as missing project context?
      // Actually, if we can't verify budget, we risk overrun.
      // Let's fail safe (Block) if it's a budget check error?
      // Re-reading AC: "The system MUST check... If budget is exceeded, the execution MUST be blocked".
      // If we error, we don't know if budget is exceeded.
      // Let's log error and return allowed: false to be safe against overruns.
      return {
        allowed: false,
        reason: `Error checking budget: ${(error as Error).message}`,
      };
    }
  }

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
   * Estimate cost before AI execution based on prompt length
   * Uses GPT's approximation: ~4 characters per token
   *
   * @param prompt - The input prompt string
   * @param model - The AI model to be used
   * @param estimatedOutputTokens - Estimated output tokens (default: 500)
   * @returns Estimated cost in USD as Decimal
   */
  estimateCost(prompt: string, model: string, estimatedOutputTokens: number = 500): Decimal {
    // GPT models: roughly 4 characters per token (from OpenAI docs)
    const estimatedInputTokens = Math.floor(prompt.length / 4);

    return this.calculateUSD(model, estimatedInputTokens, estimatedOutputTokens);
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

  async getCostStats(ticketId: string): Promise<{ totalCost: number; projectBudget: number; projectSpend: number }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        project: true,
      },
    });

    if (!ticket) {
      return { totalCost: 0, projectBudget: 0, projectSpend: 0 };
    }

    // Ticket total cost
    const ticketCostAgg = await this.prisma.aICostLog.aggregate({
      where: { ticket_id: ticketId },
      _sum: { cost_usd: true },
    });
    const totalCost = ticketCostAgg._sum.cost_usd?.toNumber() || 0;

    // Project stats
    const projectId = ticket.project_id;
    const projectCostAgg = await this.prisma.aICostLog.aggregate({
      where: { ticket: { project_id: projectId } },
      _sum: { cost_usd: true },
    });
    const projectSpend = projectCostAgg._sum.cost_usd?.toNumber() || 0;
    const projectBudget = ticket.project?.budget_usd?.toNumber() || 100;

    return { totalCost, projectBudget, projectSpend };
  }
}
