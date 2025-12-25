/**
 * Self-Healing Orchestration Interfaces
 *
 * Defines types for AI-powered self-healing workflow that attempts
 * to fix QA failures with progress validation and escalation.
 *
 * @module execution/interfaces/self-healing
 */

/**
 * Maximum number of fix attempts before escalating to human
 * @constant
 */
export const MAX_FIX_ATTEMPTS = 2;

/**
 * QA Result type matching Prisma schema
 * Used for type-safe error extraction
 */
export interface QAResult {
  id: string;
  execution_id: string;
  linting_passed: boolean;
  linting_errors: unknown; // JSON
  tests_passed: boolean;
  test_results: unknown; // JSON
  overall_passed: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input parameters for self-healing attempt
 */
export interface ISelfHealingInput {
  /** Unique identifier for the execution */
  executionId: string;

  /** ClickUp ticket ID for escalation comments */
  ticketId: string;

  /** Initial QA result that triggered self-healing */
  qaResult: QAResult;

  /** Number of errors detected before fix attempt */
  previousErrorCount: number;
}

/**
 * Result of self-healing workflow
 */
export interface ISelfHealingResult {
  /** Whether self-healing succeeded in fixing all errors */
  success: boolean;

  /** Outcome classification */
  outcome: 'SUCCESS' | 'ESCALATED' | 'MAX_ATTEMPTS';

  /** Number of fix attempts made (1-2) */
  attemptsMade: number;

  /** Final error count after all attempts */
  finalErrorCount: number;

  /** Reason for escalation (if outcome is ESCALATED or MAX_ATTEMPTS) */
  escalationReason?: string;
}

/**
 * Error counts extracted from QA result
 */
export interface IErrorCounts {
  /** Number of linting errors (ESLint, Prettier, etc.) */
  lintErrors: number;

  /** Number of test failures (unit, integration, E2E) */
  testFailures: number;

  /** Total errors (lint + test) */
  total: number;
}
