/**
 * Dependency Graph Interfaces for Circular Dependency Detection
 *
 * These interfaces define the data structures used by the DFS cycle detection algorithm.
 */

/**
 * ClickUp task with dependency information
 */
export interface ClickUpTask {
  id: string;
  name: string;
  status: {
    status: string;
  };
  dependencies?: Array<{
    task_id: string;
    type: 'waiting_on' | 'blocking';
  }>;
}

/**
 * Dependency graph structure for cycle detection
 */
export interface DependencyGraph {
  /** Map of ticket ID to task details */
  nodes: Map<string, ClickUpTask>;
  /** Map of ticket ID to array of dependent ticket IDs */
  edges: Map<string, string[]>;
}

/**
 * Result of circular dependency detection
 */
export interface CircularDependencyResult {
  /** Whether a cycle was detected */
  hasCycle: boolean;
  /** Ordered list of ticket IDs forming the cycle (empty if no cycle) */
  cycle: string[];
  /** Unique list of all tickets affected by the cycle */
  affectedTickets: string[];
  /** Confidence score: 0.95 for detected cycles, 1.0 for no cycle */
  confidence: number;
}
