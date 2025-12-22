import { Injectable, Logger } from '@nestjs/common';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { DependencyCheckResult, ETAResult } from './interfaces/dependency-status.interface';
import { ETAReasoningParamsDto } from './dto/eta-calculation.dto';

@Injectable()
export class DependencyManagerService {
  private readonly logger = new Logger(DependencyManagerService.name);

  constructor(
    private readonly clickUpService: ClickUpService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metricsService: MetricsService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
  ) {}

  async checkDependencies(ticketId: string): Promise<DependencyCheckResult> {
    const startTime = Date.now();
    try {
      this.logger.log(`Checking dependencies for ticket: ${ticketId}`);
      
      // Increment dependency check counter
      this.metricsService.incrementCounter('dependency_checks_total', { ticket_id: ticketId });

      // Step 1: Fetch task from ClickUp
      const task = await this.clickUpService.getTask(ticketId);

      // Step 2: Extract dependencies from ClickUp task
      // ClickUp API returns dependencies, but base interface doesn't include it
      // Cast to access the field (same pattern as Story 12.1)
      const fullTask = task as any;
      const dependencies = fullTask.dependencies || [];
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

      // Step 3: Check for circular dependencies in Prisma
      const circularDeps = await this.prisma.ticketDependency.findMany({
        where: {
          ticket_id: ticketId,
          circular_detected: true,
        },
      });

      const circularDepIds = new Set(circularDeps.map((d) => d.depends_on));

      // Step 4: Check each dependency's status
      const unresolvedDependencies: string[] = [];
      let resolvedCount = 0;

      for (const dep of dependencies) {
        const depId = dep.task_id;

        // Check if this dependency is marked as circular
        if (circularDepIds.has(depId)) {
          unresolvedDependencies.push(depId);
          continue;
        }

        try {
          const depTask = await this.clickUpService.getTask(depId);
          const isResolved = this.isStatusResolved(depTask.status?.status);

          if (isResolved) {
            resolvedCount++;
          } else {
            unresolvedDependencies.push(depId);
          }
        } catch (error: any) {
          // If dependency task is not found (deleted), treat as resolved
          if (error.message?.includes('not found') || error.message?.includes('404')) {
            this.logger.warn(`Dependency ${depId} not found (deleted), treating as resolved`);
            resolvedCount++;
          } else {
            // For other errors, re-throw
            throw error;
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
      const durationMs = Date.now() - startTime;
      this.metricsService.recordHistogram('dependency_resolution_duration_seconds', durationMs / 1000, {
        can_proceed: canProceed.toString(),
      });

      // Log AI decision for dependency check
      await this.aiDecisionLogger.logDecision({
        agentName: 'DependencyManager',
        action: canProceed ? 'dependency_check_proceed' : 'dependency_check_blocked',
        reasoning: `Checked ${totalCount} dependencies: ${resolvedCount} resolved, ${unresolvedDependencies.length} unresolved`,
        ticketId,
        executionId: undefined,
        inputData: { ticketId, totalDependencies: totalCount },
        outputData: { canProceed, unresolvedDependencies, resolvedCount, estimatedETA: estimatedETA?.toISOString() || null },
        confidence: 1.0,
      });

      return {
        canProceed,
        unresolvedDependencies,
        resolvedCount,
        totalCount,
        estimatedETA,
      };
    } catch (error: any) {
      this.logger.error(`Error checking dependencies for ${ticketId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Helper method to determine if a ClickUp status indicates resolution.
   * Based on Story 12.1's status mapping: completed, deployed, closed, done, archived.
   */
  private isStatusResolved(status: string | undefined): boolean {
    if (!status) return false;

    const resolvedStatuses = ['completed', 'deployed', 'closed', 'done', 'archived'];
    return resolvedStatuses.includes(status.toLowerCase());
  }

  async calculateETA(ticketId: string, unresolvedDependencies: string[]): Promise<ETAResult> {
    const startTime = Date.now();
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
      const ticket = await this.clickUpService.getTask(ticketId);
      const estimatedComplexity = this.estimateComplexity(ticket);

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

      // Step 5: Get current queue depth from RabbitMQ
      const queueDepth = await this.getQueueDepth('ai-execution-queue');
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
      const durationMs = Date.now() - startTime;
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
    } catch (error: any) {
      this.logger.error(`Error calculating ETA for ${ticketId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async notifyDependentTickets(completedTicketId: string): Promise<void> {
    this.logger.log(`Notifying dependent tickets for completed ticket: ${completedTicketId}`);

    try {
      // Step 1: Find all tickets waiting on this completed ticket
      const dependentTickets = await this.prisma.ticketDependency.findMany({
        where: {
          depends_on: completedTicketId,
          status: { in: ['WAITING', 'BLOCKED'] },
        },
      });

      if (dependentTickets.length === 0) {
        this.logger.debug(`No dependent tickets for ${completedTicketId}`);
        return;
      }

      this.logger.log(`Found ${dependentTickets.length} dependent tickets for ${completedTicketId}`);

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

              // Publish to RabbitMQ intake queue for processing
              await this.rabbitMQPublisher.publishToQueue('ticket-intake-queue', {
                ticket_id: dep.ticket_id,
                reason: 'dependencies_resolved',
                trigger: 'dependency_manager',
              });

              // Update ClickUp with success message
              await this.clickUpService.addComment(
                dep.ticket_id,
                `✅ **All dependencies resolved!** Your ticket is now queued for processing.\n\n` +
                  `**Blocker completed:** [${completedTicketId}]\n` +
                  `**Estimated start time:** ${new Date(Date.now() + 5 * 60 * 1000).toLocaleString()}\n\n` +
                  `You will receive updates as the AI agent works on your ticket.`,
              );

              // Record requeue metric
              this.metricsService.incrementCounter('dependent_tickets_notified_total', { action: 'requeued' });

              return { ticketId: dep.ticket_id, action: 'requeued' };
            } catch (publishError: any) {
              // Rollback: Mark dependency as WAITING again if RabbitMQ publish fails
              await this.prisma.ticketDependency.updateMany({
                where: { ticket_id: dep.ticket_id },
                data: { status: 'WAITING' },
              });
              throw publishError; // Re-throw for Promise.allSettled to catch
            }
          } else {
            // Still has unresolved dependencies, recalculate ETA
            const etaResult = await this.calculateETA(dep.ticket_id, checkResult.unresolvedDependencies);

            // Update ClickUp with ETA update
            await this.clickUpService.addComment(
              dep.ticket_id,
              `ℹ️ **Blocker update:** [${completedTicketId}] has been completed.\n\n` +
                `**Remaining blockers:** ${checkResult.unresolvedDependencies.length}\n` +
                `**Updated ETA:** ${etaResult.estimatedCompletionTime.toLocaleString()} (${etaResult.estimatedWaitMinutes} minutes)\n` +
                `**Reasoning:** ${etaResult.reasoning}`,
            );

            // Record ETA update metric
            this.metricsService.incrementCounter('dependent_tickets_notified_total', { action: 'eta_updated' });

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
    } catch (error: any) {
      this.logger.error(`Error notifying dependent tickets for ${completedTicketId}: ${error.message}`, error.stack);
      // Don't re-throw: this is a background notification process
    }
  }

  /**
   * Estimate ticket complexity based on description length and keywords.
   * Returns a complexity score (1-10).
   */
  private estimateComplexity(ticket: any): number {
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
      parts.push('No historical data available, using default average based on estimated complexity');
    }

    if (queuePosition > 0) {
      parts.push(`${queuePosition} ticket(s) in queue ahead`);
    }

    if (unresolvedDepCount > 0) {
      parts.push(`${unresolvedDepCount} unresolved dependenc${unresolvedDepCount > 1 ? 'ies' : 'y'}`);
    }

    return parts.join('. ') + '.';
  }

  /**
   * Get RabbitMQ queue depth for a given queue.
   * Returns 0 on error (graceful fallback).
   */
  private async getQueueDepth(queueName: string): Promise<number> {
    try {
      const queueInfo = await this.rabbitMQService.getQueueStats(queueName);
      return queueInfo.messageCount || 0;
    } catch (error: any) {
      this.logger.error(`Failed to get queue depth for ${queueName}: ${error.message}`, error.stack);
      return 0; // Graceful fallback
    }
  }
}


