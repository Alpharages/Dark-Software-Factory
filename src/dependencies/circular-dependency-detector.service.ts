import { Injectable, Logger } from '@nestjs/common';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import {
  DependencyGraph,
  CircularDependencyResult,
  ClickUpTask,
} from './interfaces/dependency-graph.interface';
import { CircularDependencyAlertDto } from './dto/circular-dependency-alert.dto';

/**
 * Circular Dependency Detector Service
 * Story 12.1: Detects circular dependencies in ClickUp task chains using DFS
 *
 * Responsibilities:
 * - DFS-based cycle detection in dependency graphs
 * - PM alerting with cycle visualization
 * - ClickUp status updates for blocked tickets
 * - AI decision audit logging
 * - Prometheus metrics tracking
 */
@Injectable()
export class CircularDependencyDetectorService {
  private readonly logger = new Logger(CircularDependencyDetectorService.name);

  /** Confidence score for detected cycles (95% certainty due to potential edge cases) */
  private readonly CYCLE_DETECTED_CONFIDENCE = 0.95;
  /** Confidence score when no cycle detected (100% certainty) */
  private readonly NO_CYCLE_CONFIDENCE = 1.0;
  /** Pre-detection confidence for AI logging (80% - analysis in progress) */
  private readonly PRE_DETECTION_CONFIDENCE = 0.8;

  constructor(
    private readonly clickUpService: ClickUpService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metricsService: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Detect circular dependencies starting from a given ticket
   * AC#1: DFS algorithm detects cycles in dependency graph
   * AC#4: AI decision logged with full dependency graph
   *
   * @param ticketId - Starting ticket ID for cycle detection
   * @returns Result with cycle information
   */
  async detectCircularDependencies(ticketId: string): Promise<CircularDependencyResult> {
    const startTime = Date.now();

    try {
      // Build dependency graph from ClickUp
      const graph = await this.buildDependencyGraph(ticketId);

      // Log AI decision BEFORE detection (intake phase - no execution yet)
      await this.aiDecisionLogger.logDecision({
        agentName: 'Circular Dependency Detector',
        action: 'circular_dependency_check',
        ticketId,
        executionId: undefined,
        inputData: {
          ticketId,
          graphSize: graph.nodes.size,
          edgeCount: Array.from(graph.edges.values()).flat().length,
        },
        outputData: {},
        reasoning: `Analyzing dependency graph for ticket ${ticketId} with ${graph.nodes.size} nodes`,
        confidence: this.PRE_DETECTION_CONFIDENCE,
      });

      // Record graph size metric
      this.metricsService.setGauge('dependency_graph_size', graph.nodes.size);

      // Run DFS detection
      const result = this.runDFSDetection(graph, ticketId);

      // Record detection duration
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordHistogram('circular_dependency_detection_duration_seconds', duration);

      // Record cycle detected metric
      if (result.hasCycle) {
        this.metricsService.incrementCounter('circular_dependencies_detected_total', {
          cycle_length: result.cycle.length.toString(),
        });
      }

      // Log AI decision AFTER detection
      await this.aiDecisionLogger.logDecision({
        agentName: 'Circular Dependency Detector',
        action: result.hasCycle ? 'circular_dependency_detected' : 'no_circular_dependency',
        ticketId,
        executionId: undefined, // Intake phase - no execution yet
        inputData: {
          ticketId,
          graphSize: graph.nodes.size,
        },
        outputData: {
          hasCycle: result.hasCycle,
          cycle: result.cycle,
          affectedTickets: result.affectedTickets,
        },
        reasoning: result.hasCycle
          ? `Circular dependency detected: ${result.cycle.join(' → ')}`
          : `No circular dependencies found in graph of ${graph.nodes.size} nodes`,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to detect circular dependencies for ${ticketId}`, {
        error: err.message,
        stack: err.stack,
        ticketId,
      });
      throw error;
    }
  }

  /**
   * Build dependency graph from ClickUp API using BFS traversal
   * AC#1: Fetch task dependencies from ClickUp
   *
   * @param ticketId - Starting ticket ID
   * @returns Dependency graph with nodes and edges
   */
  async buildDependencyGraph(ticketId: string): Promise<DependencyGraph> {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: new Map(),
    };

    const visited = new Set<string>();
    const queue: string[] = [ticketId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      try {
        // Fetch task from ClickUp API (returns basic task info + description)
        const task = await this.clickUpService.getTask(currentId);
        
        // ClickUp tasks include dependencies in the API response
        // Cast to ClickUpTask to access dependencies field
        const fullTask = task as any;
        const clickUpTask: ClickUpTask = {
          id: task.id,
          name: task.name,
          status: task.status,
          dependencies: fullTask.dependencies || [],
        };
        
        graph.nodes.set(currentId, clickUpTask);

        // Extract dependencies from task
        const dependencies = clickUpTask.dependencies?.map((d: any) => d.task_id) || [];
        graph.edges.set(currentId, dependencies);

        // Add dependencies to queue for BFS traversal
        queue.push(...dependencies);
      } catch (error) {
        const err = error as Error;
        this.logger.warn(`Failed to fetch task ${currentId}`, {
          error: err.message,
          stack: err.stack,
          taskId: currentId,
        });
        // Continue with partial graph (don't fail entire detection)
      }
    }

    return graph;
  }

  /**
   * Run DFS cycle detection algorithm
   * Uses recursion stack to detect back edges (cycles)
   *
   * @param graph - Dependency graph
   * @param startNode - Starting node for DFS
   * @returns Detection result
   */
  private runDFSDetection(graph: DependencyGraph, startNode: string): CircularDependencyResult {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    let cycle: string[] = [];

    const dfs = (node: string, path: string[]): boolean => {
      // Cycle detected - node is already in recursion stack
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycle = [...path.slice(cycleStart), node];
        return true;
      }

      // Already visited in different path - no cycle here
      if (visited.has(node)) return false;

      visited.add(node);
      recursionStack.add(node);

      const dependencies = graph.edges.get(node) || [];
      for (const dep of dependencies) {
        if (dfs(dep, [...path, node])) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    const hasCycle = dfs(startNode, []);

    return {
      hasCycle,
      cycle,
      affectedTickets: [...new Set(cycle)],
      confidence: hasCycle ? this.CYCLE_DETECTED_CONFIDENCE : this.NO_CYCLE_CONFIDENCE,
    };
  }

  /**
   * Visualize cycle path as human-readable markdown
   * AC#2: Cycle path visualization
   *
   * @param cycle - Array of ticket IDs forming the cycle
   * @param graph - Dependency graph with task details
   * @returns Markdown-formatted alert message
   */
  visualizeCycle(cycle: string[], graph: DependencyGraph): string {
    const timestamp = new Date().toISOString();

    // Build cycle path with task names
    const cyclePath = cycle
      .map((ticketId) => {
        const task = graph.nodes.get(ticketId);
        return `Task ${task?.name || ticketId} (#${ticketId})`;
      })
      .join(' → ');

    // Build affected tickets list (unique tickets only)
    const uniqueTickets = [...new Set(cycle)];
    const affectedTickets = uniqueTickets
      .map((ticketId) => {
        const task = graph.nodes.get(ticketId);
        return `- [${task?.name || ticketId}](#${ticketId})`;
      })
      .join('\n');

    return `🚨 **CIRCULAR DEPENDENCY DETECTED**

**Cycle Path:**
${cyclePath}

**Affected Tickets:**
${affectedTickets}

**Resolution Steps:**
1. Review dependency chain and identify which dependency can be removed
2. Update ClickUp task dependencies to break the cycle
3. Re-trigger ticket intake after fixing dependencies

**System Action:**
All tickets in this cycle have been marked as "Blocked - Circular Dependency" and removed from the processing queue.

---
*Detected by: AI Dependency Analyzer*
*Detection Time: ${timestamp}*`;
  }

  /**
   * Alert PM with cycle visualization
   * AC#2: PM alerts with dependency chain visualization
   *
   * @param cycle - Cycle of ticket IDs
   * @param graph - Dependency graph
   * @returns Alert DTO with structured data
   */
  async alertPM(cycle: string[], graph: DependencyGraph): Promise<CircularDependencyAlertDto> {
    // Validation: ensure cycle is not empty
    if (!cycle || cycle.length === 0) {
      const error = new Error('Cannot send alert for empty cycle');
      this.logger.error('alertPM called with empty cycle', { cycle, error: error.message });
      throw error;
    }

    const alertMessage = this.visualizeCycle(cycle, graph);
    const cyclePath = cycle
      .map((id) => graph.nodes.get(id)?.name || id)
      .join(' → ');

    try {
      // Post detailed alert to first ticket in cycle
      const primaryTicketId = cycle[0];
      await this.clickUpService.addComment(primaryTicketId, alertMessage);

      // Post shorter alerts to other tickets in cycle
      for (const ticketId of cycle.slice(1)) {
        const shortMessage = `⚠️ This ticket is part of a circular dependency. See [Task ${cycle[0]}] for details.`;
        await this.clickUpService.addComment(ticketId, shortMessage);
      }

      // Record metric
      this.metricsService.incrementCounter('circular_dependency_alerts_sent_total');

      this.logger.log(`PM alerts sent for circular dependency involving ${cycle.length} tickets`);

      // Return structured DTO
      return new CircularDependencyAlertDto(
        alertMessage,
        cyclePath,
        [...new Set(cycle)],
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to send PM alerts`, {
        error: err.message,
        stack: err.stack,
        cycle,
      });
      throw error;
    }
  }

  /**
   * Mark all tickets in cycle as blocked
   * AC#3: Update tickets to "Blocked - Circular Dependency" status
   *
   * @param ticketIds - Array of ticket IDs to mark as blocked
   * @returns Object with success/failure counts
   */
  async markTicketsAsCircular(ticketIds: string[]): Promise<{ success: number; failed: number }> {
    const updatePromises = ticketIds.map(async (ticketId) => {
      try {
        // Update ClickUp status
        await this.clickUpService.updateStatus(ticketId, 'Blocked - Circular Dependency');

        // Update database record
        await this.prisma.ticketDependency.updateMany({
          where: { ticket_id: ticketId },
          data: {
            status: 'BLOCKED',
            circular_detected: true,
          },
        });

        this.logger.debug(`Marked ticket ${ticketId} as circular dependency`);
        return { ticketId, success: true };
      } catch (error) {
        const err = error as Error;
        this.logger.error(`Failed to update ticket ${ticketId}`, {
          error: err.message,
          stack: err.stack,
          ticketId,
        });
        return { ticketId, success: false, error: err.message };
      }
    });

    const results = await Promise.allSettled(updatePromises);

    // Count successes and failures
    let successCount = 0;
    let failedCount = 0;

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        failedCount++;
      }
    });

    this.logger.log(
      `Marked ${successCount}/${ticketIds.length} tickets as circular dependencies (${failedCount} failed)`,
    );

    return { success: successCount, failed: failedCount };
  }
}

