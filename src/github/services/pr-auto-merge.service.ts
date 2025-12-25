import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitHubService, GitHubPR } from '../github.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { PRRiskLevel } from '@/prisma/client';

@Injectable()
export class PRAutoMergeService {
  private readonly logger = new Logger(PRAutoMergeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly github: GitHubService,
    private readonly prisma: PrismaService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Attempts to auto-merge a PR if it meets criteria
   */
  async attemptAutoMerge(
    executionId: string,
    repository: string,
    prNumber: number,
    _correlationId?: string,
  ): Promise<boolean> {
    const isEnabled = this.config.get<boolean>('github.autoMergeLowRisk');
    const { owner, repo } = this.parseRepository(repository);

    if (!isEnabled) {
      return false;
    }

    try {
      // 1. Fetch execution to get risk level
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
      });

      if (!execution || execution.risk_level !== PRRiskLevel.LOW) {
        this.logger.log(
          `[${executionId}] Skipping auto-merge for ${repository}#${prNumber}: Risk level is ${execution?.risk_level || 'UNKNOWN'}`,
        );
        return false;
      }

      // 2. Fetch PR to ensure it's mergeable
      let pr: GitHubPR = await this.github.getPullRequest(owner, repo, prNumber, executionId);

      if (pr.state !== 'open') {
        this.logger.warn(
          `[${executionId}] PR ${repository}#${prNumber} is not open (state: ${pr.state}), skipping merge`,
        );
        return false;
      }

      // Handle null mergeable status from GitHub (it's still calculating)
      if (pr.mergeable === null) {
        this.logger.log(
          `[${executionId}] PR ${repository}#${prNumber} mergeability is being calculated by GitHub. Retrying once...`,
        );
        // Wait 3 seconds and retry once
        await new Promise((resolve) => setTimeout(resolve, 3000));
        pr = await this.github.getPullRequest(owner, repo, prNumber, executionId);
      }

      if (pr.mergeable === false) {
        this.logger.warn(
          `[${executionId}] PR ${repository}#${prNumber} has conflicts or failed status checks, skipping auto-merge`,
        );
        return false;
      }

      if (pr.mergeable === null) {
        this.logger.warn(
          `[${executionId}] PR ${repository}#${prNumber} mergeability still unknown after retry, skipping auto-merge`,
        );
        return false;
      }

      this.logger.log(
        `[${executionId}] Executing auto-merge for LOW risk PR ${repository}#${prNumber}`,
      );

      // 3. Execute merge
      const result = await this.github.mergePullRequest(
        owner,
        repo,
        prNumber,
        'squash',
        executionId,
      );

      // 4. Log decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'PRAutoMerge',
        action: 'pr_auto_merge',
        reasoning: `PR # ${prNumber} in ${repository} is LOW risk and auto-merge is enabled.`,
        ticketId: execution.ticket_id || '',
        executionId,
        inputData: { repository, prNumber, riskLevel: execution.risk_level },
        outputData: { success: !!result, mergeSha: result?.sha },
        confidence: 1.0,
      });

      // 5. Update metrics
      this.metrics.incrementCounter('github_pr_auto_merged_total', {
        repository,
        status: 'success',
      });

      return true;
    } catch (error) {
      this.logger.error(`[${executionId}] Auto-merge failed for ${repository}#${prNumber}`, {
        error: (error as Error).message,
        executionId,
      });

      this.metrics.incrementCounter('github_pr_auto_merged_total', {
        repository,
        status: 'failed',
      });

      return false;
    }
  }

  private parseRepository(repository: string): { owner: string; repo: string } {
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repository}`);
    }
    return { owner, repo };
  }
}
