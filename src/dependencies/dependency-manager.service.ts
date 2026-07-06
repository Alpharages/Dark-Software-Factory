import { Injectable, Logger } from '@nestjs/common';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { DependencyCheckResult, ETAResult } from './interfaces/dependency-status.interface';
import { ETAReasoningParamsDto } from './dto/eta-calculation.dto';
import { DependencyBlockBehavior, TicketStatus } from '@/prisma/client';
import { TicketDependencyRepository } from './ticket-dependency.repository';

@Injectable()
export class DependencyManagerService {
  private readonly logger = new Logger(DependencyManagerService.name);

  constructor(
    private readonly clickUpService: ClickUpService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metricsService: MetricsService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    private readonly ticketDependencies: TicketDependencyRepository,
  ) {}

  async checkDependencies(ticketId: string): Promise<DependencyCheckResult> {
    const startTime = Date.now();
    try {
      this.logger.log(`Checking dependencies for ticket: ${ticketId}`);

      // Increment dependency check counter
      this.metricsService.incrementCounter('dependency_checks_total', { ticket_id: ticketId });

      const dependencies = await this.ticketDependencies.getBlockers(ticketId);
      const totalCount = dependencies.length;

      if (totalCount === 0) {
        this.logger.log(`No dependencies found for ticket ${ticketId}`);
        return {
          canProceed: true,
          unresolvedDependencies: [],
          resolvedCount: 0,
          totalCount: 0,
          estimatedETA: null,
        };
      }

      const circularDepIds = new Set(
        dependencies.filter((dep) => dep.circular_detected).map((dep) => dep.depends_on),
      );

      // Step 4: Check each dependency's status
      const unresolvedDependencies: string[] = [];
      let resolvedCount = 0;

      for (const dep of dependencies) {
        const depId = dep.depends_on;

        // Check if this dependency is marked as circular
        if (circularDepIds.has(depId)) {
          unresolvedDependencies.push(depId);
          continue;
        }

        try {
          const localTask = await this.prisma.ticket.findUnique({
            where: { clickup_task_id: depId },
            select: { status: true },
          });
          const status =
            localTask?.status ??
            (((await this.clickUpService.getTask(depId)).status as { status?: string } | undefined)
              ?.status as TicketStatus | undefined);
          const isResolved = this.isStatusResolved(status);

          if (isResolved) {
            resolvedCount++;
          } else {
            unresolvedDependencies.push(depId);
          }
        } catch (error: unknown) {
          const err = error as { message?: string };
          // A blocker that no longer exists (deleted) can never reach a done state —
          // treating it as unresolved would deadlock the dependent forever, so resolve it.
          // Transient errors stay unresolved (conservative; clears on the next check).
          if (err.message?.includes('not found') || err.message?.includes('404')) {
            this.logger.warn(`Dependency ${depId} not found (deleted), treating as resolved`);
            resolvedCount++;
          } else {
            this.logger.warn(
              `Dependency ${depId} status unavailable for ${ticketId}, treating as unresolved: ${err.message}`,
            );
            unresolvedDependencies.push(depId);
          }
        }
      }

      // Step 5: Calculate ETA if there are unresolved dependencies
      let estimatedETA: Date | null = null;

      if (unresolvedDependencies.length > 0) {
        // Only calculate ETA if there are no circular dependencies
        const hasCircular = unresolvedDependencies.some((depId) => circularDepIds.has(depId));
        if (!hasCircular) {
          const etaResult = await this.calculateETA(ticketId, unresolvedDependencies);
          estimatedETA = etaResult.estimatedCompletionTime;
        }
      }

      const canProceed = unresolvedDependencies.length === 0;

      this.logger.log(
        `Dependency check for ${ticketId}: ` +
          `${resolvedCount}/${totalCount} resolved, canProceed=${canProceed}`,
      );

      // Record dependency resolution duration
      this.metricsService.recordHistogram(
        'dependency_resolution_duration_seconds',
        (Date.now() - startTime) / 1000,
        {
          can_proceed: canProceed.toString(),
        },
      );

      // Log AI decision for dependency check
      await this.aiDecisionLogger.logDecision({
        agentName: 'DependencyManager',
        action: canProceed ? 'dependency_check_proceed' : 'dependency_check_blocked',
        reasoning: `Checked ${totalCount} dependencies: ${resolvedCount} resolved, ${unresolvedDependencies.length} unresolved`,
        ticketId,
        executionId: undefined,
        inputData: { ticketId, totalDependencies: totalCount },
        outputData: {
          canProceed,
          unresolvedDependencies,
          resolvedCount,
          estimatedETA: estimatedETA?.toISOString() || null,
        },
        confidence: 1.0,
      });

      return {
        canProceed,
        unresolvedDependencies,
        resolvedCount,
        totalCount,
        estimatedETA,
      };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Error checking dependencies for ${ticketId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Helper method to determine if a ClickUp status indicates resolution.
   * Based on Story 12.1's status mapping: completed, deployed, closed, done, archived.
   */
  public isStatusResolved(status: string | undefined): boolean {
    if (!status) return false;

    const resolvedStatuses = ['completed', 'deployed', 'closed', 'done', 'archived'];
    return resolvedStatuses.includes(status.toLowerCase());
  }

  async calculateETA(ticketId: string, unresolvedDependencies: string[]): Promise<ETAResult> {
    this.logger.log(
      `Calculating ETA for ticket: ${ticketId} with ${unresolvedDependencies.length} unresolved dependencies`,
    );

    try {
      // Step 1: Calculate historical average execution time (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const completedExecutions = await this.prisma.execution.findMany({
        where: {
          status: 'COMPLETED',
          completed_at: { gte: thirtyDaysAgo },
        },
        select: {
          started_at: true,
          completed_at: true,
        },
      });

      // Step 2: Estimate complexity for the ticket (for future filtering)
      // Graceful fallback: if ClickUp API unavailable, use default complexity
      let estimatedComplexity = 5;
      try {
        const ticket = await this.clickUpService.getTask(ticketId);
        estimatedComplexity = this.estimateComplexity(
          ticket as { name?: string; description?: string },
        );
      } catch {
        this.logger.warn(
          `Could not fetch task ${ticketId} for ETA complexity estimate, using default`,
        );
      }

      // Step 3: Calculate average execution duration
      let historicalAverage: number | null = null;
      const sampleSize = completedExecutions.length;

      if (sampleSize > 0) {
        const durations = completedExecutions
          .filter((ex) => ex.started_at && ex.completed_at)
          .map((ex) => {
            const start = new Date(ex.started_at!);
            const end = new Date(ex.completed_at!);
            return (end.getTime() - start.getTime()) / 1000 / 60; // Minutes
          });

        if (durations.length > 0) {
          historicalAverage = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        }
      }

      // Step 4: Fallback to default average if no historical data
      if (historicalAverage === null) {
        historicalAverage = this.getDefaultAverageByComplexity(estimatedComplexity);
        this.logger.warn(
          `No historical data for ticket ${ticketId}, using default average: ${historicalAverage} min`,
        );
      }

      // Step 5: no QA queue remains; agent execution is outside DSF.
      const queueDepth = 0;
      const queuePosition = queueDepth;

      // Step 6: Calculate total ETA
      // Formula: ETA = (historical_avg_per_ticket * queue_position) + (unresolved_dep_count * avg_dep_time)
      const avgDepTime = historicalAverage;
      const baseWaitMinutes = queuePosition > 0 ? avgDepTime * queuePosition : avgDepTime;
      const depWaitMinutes = unresolvedDependencies.length * avgDepTime;
      const estimatedWaitMinutes = Math.ceil(baseWaitMinutes + depWaitMinutes);
      const estimatedCompletionTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);

      // Step 7: Calculate confidence score
      const confidence = this.calculateConfidence(sampleSize, queueDepth);

      // Step 8: Generate reasoning
      const reasoning = this.generateETAReasoning({
        historicalAverage: sampleSize > 0 ? historicalAverage : null,
        queuePosition,
        unresolvedDepCount: unresolvedDependencies.length,
        sampleSize,
      });

      // Step 9: Persist ETA to database
      await this.prisma.ticketDependency.updateMany({
        where: { ticket_id: ticketId },
        data: {
          estimated_eta: estimatedCompletionTime,
          eta_calculated_at: new Date(),
        },
      });

      // Step 10: Log AI decision for ETA calculation
      await this.aiDecisionLogger.logDecision({
        agentName: 'DependencyManager',
        action: 'calculate_eta',
        reasoning,
        ticketId,
        executionId: undefined,
        inputData: {
          ticketId,
          unresolvedDependencies,
          historicalSampleSize: sampleSize,
          queueDepth,
        },
        outputData: {
          estimatedCompletionTime: estimatedCompletionTime.toISOString(),
          estimatedWaitMinutes,
          confidence,
        },
        confidence,
      });

      // Record ETA calculation metrics
      this.metricsService.recordHistogram('dependency_eta_seconds', estimatedWaitMinutes * 60, {
        confidence_bucket: confidence > 0.7 ? 'high' : confidence > 0.5 ? 'medium' : 'low',
      });

      this.logger.log(
        `ETA calculated for ${ticketId}: ${estimatedWaitMinutes} min, confidence: ${confidence.toFixed(2)}`,
      );

      return {
        estimatedCompletionTime,
        estimatedWaitMinutes,
        confidence,
        reasoning,
        historicalAverage: sampleSize > 0 ? historicalAverage : null,
        queuePosition,
      };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Error calculating ETA for ${ticketId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  async notifyDependentTickets(completedTicketId: string): Promise<void> {
    this.logger.log(`Notifying dependent tickets for completed ticket: ${completedTicketId}`);

    try {
      // Step 1: Find all tickets waiting on this completed ticket
      const dependentTickets = (
        await this.ticketDependencies.getDependents(completedTicketId)
      ).filter((dep) => ['WAITING', 'BLOCKED'].includes(dep.status));

      if (dependentTickets.length === 0) {
        this.logger.debug(`No dependent tickets for ${completedTicketId}`);
        return;
      }

      this.logger.log(
        `Found ${dependentTickets.length} dependent tickets for ${completedTicketId}`,
      );

      // Step 2: For each dependent ticket, check if ALL dependencies now resolved
      const notifications = await Promise.allSettled(
        dependentTickets.map(async (dep) => {
          const checkResult = await this.checkDependencies(dep.ticket_id);

          if (checkResult.canProceed) {
            // All dependencies resolved! Mark as RESOLVED and re-queue
            try {
              await this.prisma.ticketDependency.updateMany({
                where: { ticket_id: dep.ticket_id },
                data: {
                  status: 'RESOLVED',
                  resolved_at: new Date(),
                },
              });

              const behavior = await this.resolveBlockBehavior(dep.ticket_id);
              if (behavior === DependencyBlockBehavior.auto_resume) {
                await this.rabbitMQPublisher.publishToQueue('ticket-intake-queue', {
                  ticket_id: dep.ticket_id,
                  reason: 'dependencies_resolved',
                  trigger: 'dependency_manager',
                });
              } else {
                await this.prisma.ticket.updateMany({
                  where: { clickup_task_id: dep.ticket_id },
                  data: { status: TicketStatus.AWAITING_DEPENDENCY_RELEASE },
                });
              }

              // Update ClickUp with success message
              await this.clickUpService.addComment(
                dep.ticket_id,
                `✅ **All dependencies resolved!** Your ticket is now ${
                  behavior === DependencyBlockBehavior.auto_resume
                    ? 'queued for processing'
                    : 'awaiting PM release'
                }.\n\n` +
                  `**Blocker completed:** [${completedTicketId}]\n` +
                  `**Estimated start time:** ${new Date(Date.now() + 5 * 60 * 1000).toLocaleString()}\n\n` +
                  `You will receive updates as the AI agent works on your ticket.`,
              );

              // Record requeue metric
              this.metricsService.incrementCounter('dependent_tickets_notified_total', {
                action: 'requeued',
              });

              return {
                ticketId: dep.ticket_id,
                action: behavior === DependencyBlockBehavior.auto_resume ? 'requeued' : 'held',
              };
            } catch (publishError: unknown) {
              // Rollback: Mark dependency as WAITING again if RabbitMQ publish fails
              await this.prisma.ticketDependency.updateMany({
                where: { ticket_id: dep.ticket_id },
                data: { status: 'WAITING' },
              });
              throw publishError; // Re-throw for Promise.allSettled to catch
            }
          } else {
            // Still has unresolved dependencies, recalculate ETA
            const etaResult = await this.calculateETA(
              dep.ticket_id,
              checkResult.unresolvedDependencies,
            );

            // Update ClickUp with ETA update
            await this.clickUpService.addComment(
              dep.ticket_id,
              `ℹ️ **Blocker update:** [${completedTicketId}] has been completed.\n\n` +
                `**Remaining blockers:** ${checkResult.unresolvedDependencies.length}\n` +
                `**Updated ETA:** ${etaResult.estimatedCompletionTime.toLocaleString()} (${etaResult.estimatedWaitMinutes} minutes)\n` +
                `**Reasoning:** ${etaResult.reasoning}`,
            );

            // Record ETA update metric
            this.metricsService.incrementCounter('dependent_tickets_notified_total', {
              action: 'eta_updated',
            });

            return { ticketId: dep.ticket_id, action: 'eta_updated' };
          }
        }),
      );

      // Step 3: Log results
      const successful = notifications.filter((n) => n.status === 'fulfilled').length;
      const failed = notifications.filter((n) => n.status === 'rejected').length;
      this.logger.log(`Notification results: ${successful} successful, ${failed} failed`);

      // Log AI decision for dependency notifications
      await this.aiDecisionLogger.logDecision({
        agentName: 'DependencyManager',
        action: 'notify_dependent_tickets',
        reasoning: `Notified ${successful} dependent tickets after ${completedTicketId} completed (${failed} failed)`,
        ticketId: completedTicketId,
        executionId: undefined,
        inputData: { completedTicketId, dependentTicketsCount: dependentTickets.length },
        outputData: { successful, failed },
        confidence: 1.0,
      });
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error notifying dependent tickets for ${completedTicketId}: ${err.message}`,
        err.stack,
      );
      // Don't re-throw: this is a background notification process
    }
  }

  private async resolveBlockBehavior(ticketId: string): Promise<DependencyBlockBehavior> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { clickup_task_id: ticketId },
      select: {
        dependency_block_behavior: true,
        project: { select: { dependency_block_behavior: true } },
      },
    });

    return (
      ticket?.dependency_block_behavior ??
      ticket?.project.dependency_block_behavior ??
      DependencyBlockBehavior.auto_resume
    );
  }

  /**
   * Estimate ticket complexity based on description length and keywords.
   * Returns a complexity score (1-10).
   */
  private estimateComplexity(ticket: { name?: string; description?: string }): number {
    const description = ticket.description || '';
    const name = ticket.name || '';
    const combinedText = `${name} ${description}`.toLowerCase();

    let complexity = 5; // Base complexity

    // Adjust based on text length
    if (combinedText.length > 500) complexity += 2;
    else if (combinedText.length > 200) complexity += 1;

    // Adjust based on keywords
    const complexKeywords = ['integration', 'migration', 'refactor', 'architecture', 'security'];
    const simpleKeywords = ['fix', 'typo', 'update', 'minor', 'simple'];

    for (const keyword of complexKeywords) {
      if (combinedText.includes(keyword)) complexity += 1;
    }

    for (const keyword of simpleKeywords) {
      if (combinedText.includes(keyword)) complexity -= 1;
    }

    // Clamp to 1-10 range
    return Math.max(1, Math.min(10, complexity));
  }

  /**
   * Get default average execution time based on estimated complexity.
   * Returns time in minutes.
   */
  private getDefaultAverageByComplexity(complexity: number): number {
    // Linear scale: 1 complexity = 10 min, 10 complexity = 30 min
    const baseTime = 10;
    const maxTime = 30;
    const range = maxTime - baseTime;

    return baseTime + (complexity - 1) * (range / 9);
  }

  /**
   * Calculate confidence score based on sample size and queue depth.
   * Returns a value between 0 and 1.
   */
  private calculateConfidence(sampleSize: number, queueDepth: number): number {
    // Confidence increases with more historical samples
    let confidence = Math.min(sampleSize / 10, 1); // Max confidence at 10+ samples

    // Reduce confidence if queue is very deep (unpredictable)
    if (queueDepth > 50) confidence *= 0.7;
    else if (queueDepth > 20) confidence *= 0.85;

    // Minimum confidence floor
    return Math.max(0.3, confidence);
  }

  /**
   * Generate human-readable ETA reasoning.
   */
  private generateETAReasoning(params: ETAReasoningParamsDto): string {
    const { historicalAverage, queuePosition, unresolvedDepCount, sampleSize } = params;

    const parts: string[] = [];

    if (historicalAverage !== null) {
      parts.push(
        `Based on ${sampleSize} historical execution(s), average completion time is ${historicalAverage.toFixed(1)} minutes`,
      );
    } else {
      parts.push(
        'No historical data available, using default average based on estimated complexity',
      );
    }

    if (queuePosition > 0) {
      parts.push(`${queuePosition} ticket(s) in queue ahead`);
    }

    if (unresolvedDepCount > 0) {
      parts.push(
        `${unresolvedDepCount} unresolved dependenc${unresolvedDepCount > 1 ? 'ies' : 'y'}`,
      );
    }

    return parts.join('. ') + '.';
  }
}
