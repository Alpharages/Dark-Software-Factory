/**
 * AI Routing Interfaces
 * FR60: System routes to appropriate AI tool based on task complexity
 * Architecture Reference: Multi-Provider AI Strategy
 */

import { AIProvider } from '@prisma/client';

/**
 * Routing request from ticket-intake (matches Story 2.2 output)
 */
export interface IRoutingRequest {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  qualityScore: number;
  qualityGrade: 'excellent' | 'good' | 'fair' | 'poor';
  timestamp: string;
}

/**
 * Complexity score breakdown
 * Per architecture: Files, architecture changes, dependencies, LOC estimate, tags
 */
export interface IComplexityBreakdown {
  /** Files to modify count: 0-4 points (1 file=1, 2 files=2, 3+ files=4) */
  fileCount: number;
  fileCountScore: number;

  /** Architecture changes: 0-4 points (no=0, yes=4) */
  architectureChanges: boolean;
  architectureScore: number;

  /** Cross-file dependencies: 0-4 points (low=1, medium=2, high=4) */
  dependencyLevel: 'low' | 'medium' | 'high';
  dependencyScore: number;

  /** Estimated LOC: 0-4 points (<50=1, 50-100=2, 100-200=3, >200=4) */
  estimatedLoc: number;
  locScore: number;

  /** Tags-based: 0-4 points (complex/architecture/refactor=4, simple/bugfix=1) */
  tagComplexity: 'simple' | 'medium' | 'complex';
  tagScore: number;

  /** Total complexity score (sum of above) */
  totalScore: number;
}

/**
 * Routing decision result
 */
export interface IRoutingDecision {
  correlationId: string;
  ticketId: string;
  selectedProvider: AIProvider;
  complexityScore: number;
  complexityBreakdown: IComplexityBreakdown;
  routingReason: RoutingReason;
  fallbackUsed: boolean;
  originalProvider?: AIProvider;
  decisionTimestamp: Date;
}

/**
 * Why a provider was selected
 */
export enum RoutingReason {
  COMPLEXITY_HIGH = 'complexity_high', // Score >= threshold → Cursor
  COMPLEXITY_LOW = 'complexity_low', // Score < threshold → Claude Code
  COST_OPTIMIZATION = 'cost_optimization', // Cheaper provider for simple task
  PRIMARY_UNAVAILABLE = 'primary_unavailable', // Fallback to secondary
  EXPLICIT_OVERRIDE = 'explicit_override', // Manual override via tag
}

/**
 * Provider health status
 */
export interface IProviderHealth {
  provider: AIProvider;
  isHealthy: boolean;
  lastChecked: Date;
  currentLoad: number; // 0-100%
  maxConcurrent: number;
  activeExecutions: number;
  responseTimeMs?: number;
  errorMessage?: string;
}

/**
 * Routing result to pass to next queue (ai-execution)
 */
export interface IRoutingResult {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  complexityScore: number;
  complexityBreakdown: IComplexityBreakdown;
  routingReason: RoutingReason;
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectId: string;
  tags: string[];
  routedAt: string;
}
