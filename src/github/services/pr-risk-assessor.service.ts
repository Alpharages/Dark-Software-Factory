import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubService } from '../github.service';
import { PRRiskLevel } from '@/prisma/client';

export interface RiskAssessmentResult {
  riskLevel: PRRiskLevel;
  reasoning: string;
  mergeRecommendation: string;
}

@Injectable()
export class PRRiskAssessorService {
  private readonly logger = new Logger(PRRiskAssessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly github: GitHubService,
  ) {}

  /**
   * Assess the risk level of a Pull Request
   */
  async assess(
    executionId: string,
    repository: string,
    prNumber: number,
    correlationId?: string,
  ): Promise<RiskAssessmentResult> {
    this.logger.log(`Starting PR risk assessment for ${repository}#${prNumber}`, {
      executionId,
      correlationId,
    });

    try {
      // 1. Fetch PR diff — retry with back-off because GitHub may not have
      //    propagated the newly-created PR yet (causes 404 on immediate call)
      const diff = await this.fetchDiffWithRetry(repository, prNumber);

      // 2. Fetch execution context with ticket and context documents
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: {
          ticket: {
            include: {
              context_documents: true,
            },
          },
        },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const assessment: RiskAssessmentResult = {
        riskLevel: PRRiskLevel.MEDIUM,
        reasoning:
          'AI PR risk assessment was removed with ai-routing; defaulting to manual review.',
        mergeRecommendation: 'Manual review required before merge.',
      };

      // 7. Store results
      await this.prisma.execution.update({
        where: { id: executionId },
        data: {
          risk_level: assessment.riskLevel,
        },
      });

      // 8. Log decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'PRRiskAssessor',
        action: 'risk_assessment',
        reasoning: assessment.reasoning,
        ticketId: execution.ticket.id,
        executionId,
        inputData: { repository, prNumber, diffLength: diff.length },
        outputData: {
          riskLevel: assessment.riskLevel,
          recommendation: assessment.mergeRecommendation,
        },
        confidence: 0.85,
      });

      // 9. Record metrics
      this.metrics.incrementCounter('pr_risk_level_total', {
        risk_level: assessment.riskLevel,
        repository,
      });

      return assessment;
    } catch (_error) {
      this.logger.error(`PR risk assessment failed for ${repository}#${prNumber}`, {
        error: (_error as Error).message,
        executionId,
      });
      throw _error;
    }
  }

  /**
   * Fetch PR diff with exponential back-off retry.
   *
   * GitHub may return 404 immediately after PR creation while the PR propagates
   * through their infrastructure. This method retries up to `maxAttempts` times
   * with delays of 1 s, 2 s, 4 s, … before re-throwing.
   */
  private async fetchDiffWithRetry(
    repository: string,
    prNumber: number,
    maxAttempts = 3,
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.github.getPullRequestDiff(repository, prNumber);
      } catch (err) {
        const isNotFound =
          (err as Error).message?.includes('Not Found') || (err as Error).message?.includes('404');

        if (!isNotFound || attempt === maxAttempts) {
          throw err;
        }

        const delayMs = 1000 * Math.pow(2, attempt - 1); // 1 s, 2 s, 4 s …
        this.logger.warn(
          `PR ${repository}#${prNumber} not yet available on GitHub ` +
            `(attempt ${attempt}/${maxAttempts}) — retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Should never reach here (loop always throws or returns)
    throw new Error(`fetchDiffWithRetry: failed to fetch diff for ${repository}#${prNumber}`);
  }
}
