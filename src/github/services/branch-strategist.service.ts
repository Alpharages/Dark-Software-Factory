import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubStatus } from '@/prisma/client';

/**
 * Branch Selection Strategy
 */
export enum BranchSelectionStrategy {
  MAIN = 'main',
  FOLLOW = 'follow',
  MERGE_MAIN = 'merge-main',
}

/**
 * AI Branch Strategist Service
 *
 * Handles base branch selection based on dependency chains.
 * Implements AC#1-6 from Story 12.4
 */
@Injectable()
export class BranchStrategistService {
  private readonly logger = new Logger(BranchStrategistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  /**
   * Selects the base branch for a ticket based on its dependencies
   *
   * @param ticketId - The database UUID of the ticket
   * @param dependencyIds - Array of ticket IDs this ticket depends on
   * @returns The selected base branch name
   */
  async selectBaseBranch(ticketId: string, dependencyIds: string[]): Promise<string> {
    const startTime = Date.now();
    let selectedBranch = 'main';
    let strategy: BranchSelectionStrategy = BranchSelectionStrategy.MAIN;
    let reasoning = '';

    try {
      // Fetch the ticket and its project to get the default branch
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { project: true },
      });

      const defaultBranch = ticket?.project?.default_branch || 'main';
      selectedBranch = defaultBranch;
      reasoning = `No dependencies found. Defaulting to project base branch: ${defaultBranch}.`;

      if (dependencyIds.length === 0) {
        // AC#1: No Dependencies
        strategy = BranchSelectionStrategy.MAIN;
        reasoning = `No dependencies found. Defaulting to project base branch: ${defaultBranch}.`;
      } else if (dependencyIds.length === 1) {
        // AC#2: Single Dependency
        const depBranch = await this.getDependencyBranch(dependencyIds[0]);
        if (depBranch) {
          selectedBranch = depBranch;
          strategy = BranchSelectionStrategy.FOLLOW;
          reasoning = `Single dependency found. Following branch: ${depBranch}.`;
        } else {
          selectedBranch = defaultBranch;
          strategy = BranchSelectionStrategy.MAIN;
          reasoning = `Single dependency found but no active feature branch exists. Defaulting to project base branch: ${defaultBranch}.`;
        }
      } else {
        // AC#3: Multiple Dependencies
        selectedBranch = defaultBranch;
        strategy = BranchSelectionStrategy.MERGE_MAIN;
        reasoning = `Multiple dependencies found (${dependencyIds.length}). Selecting ${defaultBranch} as base with merge strategy.`;

        // AC#3: Initiate merge strategy (Implementation Detail for Story 12.5)
        // In Story 12.5, this will trigger the MergeOrchestrator to pull in dependent branches.
        this.logger.debug(
          `[AC#3] Multi-dependency merge strategy initiated for ticket ${ticketId}`,
        );
      }

      // AC#4: AI Reasoning & Audit
      await this.aiDecisionLogger.logDecision({
        agentName: 'BranchStrategistService',
        action: 'branch_selection',
        reasoning,
        ticketId,
        inputData: { dependencyIds, dependencyCount: dependencyIds.length },
        outputData: { selectedBranch, strategy },
        confidence: 1.0,
      });

      // Update the execution record if it exists for this ticket
      // Note: In Story 12.5, we will ensure an execution exists before calling this
      await this.updateExecutionBranchLog(ticketId, selectedBranch, reasoning);

      // AC#5: Track selection types via metrics
      this.metrics.incrementCounter('branch_selection_total', { strategy });

      const duration = Date.now() - startTime;
      this.logger.log(
        `Branch selected for ticket ${ticketId}: ${selectedBranch} (Strategy: ${strategy}, ${duration}ms)`,
      );

      return selectedBranch;
    } catch (error) {
      this.logger.error(
        `Error selecting base branch for ticket ${ticketId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Finds the most recent feature branch for a dependency
   */
  private async getDependencyBranch(dependencyId: string): Promise<string | null> {
    // First, find all execution IDs associated with the dependency ticket
    // Note: Using two queries because schema is missing formal relation between Execution and GitHubPush
    const dependencyExecutions = await this.prisma.execution.findMany({
      where: {
        ticket_id: dependencyId,
      },
      select: {
        id: true,
      },
    });

    const executionIds = dependencyExecutions.map((exec) => exec.id);

    if (executionIds.length === 0) {
      return null; // No executions found for this dependency
    }

    const push = await this.prisma.gitHubPush.findFirst({
      where: {
        execution_id: {
          in: executionIds,
        },
        push_status: {
          in: [GitHubStatus.BRANCH_CREATED, GitHubStatus.COMMITTED, GitHubStatus.PR_CREATED],
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      select: {
        branch_name: true,
      },
    });

    return push?.branch_name || null;
  }

  /**
   * Updates the latest execution with the selected branch and log
   */
  private async updateExecutionBranchLog(
    ticketId: string,
    baseBranch: string,
    log: string,
  ): Promise<void> {
    const latestExecution = await this.prisma.execution.findFirst({
      where: { ticket_id: ticketId },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });

    if (latestExecution) {
      await this.prisma.execution.update({
        where: { id: latestExecution.id },
        data: {
          base_branch: baseBranch,
          branch_selection_log: log,
        },
      });
    }
  }
}
