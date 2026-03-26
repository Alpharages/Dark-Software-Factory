/**
 * Orchestration Interfaces
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * FR60-65: AI code generation orchestration
 */

import { AIProvider } from '@/prisma/client';
import { IAIExecutionInput, IAIExecutionResult } from './ai-provider.interface';
import { EffectiveAiRoutingConfigDto } from '../dto/ai-routing-config.dto';

/**
 * Provider selection result
 */
export interface IProviderSelection {
  /** Selected primary provider */
  primary: AIProvider;

  /** Fallback provider if primary fails */
  fallback: AIProvider | null;

  /** Selection reason */
  reason: ProviderSelectionReason;

  /** Complexity score that influenced selection */
  complexityScore: number;

  /** Complexity grade */
  complexityGrade: ComplexityGrade;
}

/**
 * Reasons for provider selection
 */
export enum ProviderSelectionReason {
  /** Selected based on complexity score */
  COMPLEXITY = 'COMPLEXITY',

  /** Primary unavailable, using fallback */
  AVAILABILITY = 'AVAILABILITY',

  /** Cost optimization for simple tasks */
  COST_OPTIMIZATION = 'COST_OPTIMIZATION',

  /** Only one provider available */
  SINGLE_PROVIDER = 'SINGLE_PROVIDER',

  /** Manual override */
  OVERRIDE = 'OVERRIDE',
}

/**
 * Complexity grades
 */
export enum ComplexityGrade {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Orchestration execution input
 */
export interface IOrchestrationInput extends IAIExecutionInput {
  /** Optional provider override (bypasses selection) */
  providerOverride?: AIProvider;

  /** Project ID — passed from AIExecutionConsumer for ICodingAgentProvider path */
  projectId?: string;

  /** Complexity score (0-10) — pre-fetched from DB for sandbox resource profile selection */
  complexityScore?: number;

  /** Complexity score (if pre-calculated) */
  preCalculatedComplexity?: number;

  /** Tags from ticket for complexity calculation */
  tags?: string[];

  /** Estimated files to modify */
  estimatedFilesCount?: number;

  /** Accept fallback if primary fails */
  allowFallback?: boolean;

  /** Title from ticket for complexity calculation */
  title?: string;

  /** Acceptance criteria text */
  acceptanceCriteria?: string;

  /** Dynamic Routing Configuration (OS-4.5) */
  routingConfig?: EffectiveAiRoutingConfigDto;
}

/**
 * Orchestration execution result
 */
export interface IOrchestrationResult extends IAIExecutionResult {
  /** Provider that executed successfully */
  executedBy: AIProvider;

  /** Whether fallback was used */
  usedFallback: boolean;

  /** Fallback attempts if any */
  fallbackAttempts: IFallbackAttempt[];

  /** Total execution time including fallbacks */
  totalDurationMs: number;

  /** Cost estimate in cents */
  estimatedCostCents: number;
}

/**
 * Fallback attempt record
 */
export interface IFallbackAttempt {
  /** Provider that was attempted */
  provider: AIProvider;

  /** Error that triggered fallback */
  error: string;

  /** Whether error was retryable */
  wasRetryable: boolean;

  /** Duration of failed attempt */
  durationMs: number;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Provider availability status
 */
export interface IProviderAvailability {
  /** Provider identifier */
  provider: AIProvider;

  /** Whether provider is available */
  isAvailable: boolean;

  /** Reason if unavailable */
  unavailableReason?: string;

  /** Circuit breaker state */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';

  /** Current queue depth */
  queueDepth: number;

  /** Estimated wait time in ms */
  estimatedWaitMs: number;
}

/**
 * Orchestration metrics
 */
export interface IOrchestrationMetrics {
  /** Total executions */
  totalExecutions: number;

  /** Successful executions */
  successfulExecutions: number;

  /** Fallback triggers */
  fallbackTriggers: number;

  /** Fallback success rate */
  fallbackSuccessRate: number;

  /** Provider usage distribution */
  providerUsage: Record<AIProvider, number>;

  /** Average execution time by provider */
  avgExecutionTimeMs: Record<AIProvider, number>;
}

/**
 * Story 5.6: ADR-008 AI Delegation Task Input
 */
export interface ITaskInput {
  correlationId: string;
  ticketId: string;
  prompt: string;
  agentName: string;
  action: string;
  workspacePath?: string;
  contextFiles?: string[];
  providerOverride?: AIProvider;
}

/**
 * Story 5.6: ADR-008 AI Delegation Task Result
 */
export interface ITaskResult {
  success: boolean;
  output: string;
  durationMs: number;
  tokensUsed?: number;
  error?: string;
  metadata?: {
    cost?: number;
    model?: string;
    provider?: string;
  };
}
