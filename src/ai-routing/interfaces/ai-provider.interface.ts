/**
 * AI Provider Interface
 * FR65: Execute AI code generation
 * Architecture Reference: ADR-003 (Cursor CLI Headless Mode)
 *
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 */

import { AIProvider } from '@/prisma/client';

/**
 * Input for AI code generation
 */
export interface IAIExecutionInput {
  /** Correlation ID for request tracing */
  correlationId: string;

  /** Execution record ID from Story 2.5 */
  executionId: string;

  /** Ticket ID */
  ticketId: string;

  /** Generated prompt from Story 2.4 */
  prompt: string;

  /** Repository URL to clone */
  repositoryUrl: string;

  /** Target branch (default: main) */
  baseBranch?: string;

  /** Files to focus on (optional hint to AI) */
  targetFiles?: string[];

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Story 13.3: Model override from CostOptimizerService */
  selectedModel?: string;
}

/**
 * Per-attempt QA result captured during sandbox self-healing loop (WR-6.1)
 */
export interface QAAttempt {
  /** 1-based attempt number */
  attemptNumber: number;
  /**
   * Lint check outcome for this attempt.
   * - 'passed'  — lint ran and found no errors
   * - 'failed'  — lint ran and found errors (see lintErrors)
   * - 'skipped' — lint is disabled for this project or unavailable in sandbox
   */
  lintStatus: 'passed' | 'failed' | 'skipped';
  /** Lint failure details — present only when lintStatus is 'failed' */
  lintErrors?: { count: number; details: unknown[] };
  /**
   * Test run outcome for this attempt.
   * - 'passed'  — all tests passed
   * - 'failed'  — one or more tests failed (see testResults)
   * - 'skipped' — tests are disabled for this project or sandbox lacks required environment (e.g. DB connection)
   */
  testStatus: 'passed' | 'failed' | 'skipped';
  /** Test run details — present only when testStatus is 'failed' */
  testResults?: { passed: number; failed: number; details: unknown[] };
  /** Duration of this QA attempt in milliseconds */
  durationMs: number;
}

/**
 * Output from AI code generation
 */
export interface IAIExecutionResult {
  /** Whether generation succeeded */
  success: boolean;

  /** Generated code diff (git diff format) */
  codeDiff: string | null;

  /** List of files modified */
  filesChanged: string[];

  /** Confidence score (0.0-1.0) */
  confidenceScore: number;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Tokens used in input */
  tokensInput?: number;

  /** Model used for generation */
  model?: string;

  /** Tokens used in output */
  tokensOutput?: number;

  /** Workspace path (for debugging, optional in WR-1.1) */
  workspacePath?: string;

  /** Error details if failed */
  error?: IAIExecutionError;

  /** PR URL opened by sandbox agent (populated by WR-2.3/2.4 providers) */
  prUrl?: string;

  /** Git commit SHA produced by sandbox agent */
  commitSha?: string;

  /** Feature branch name pushed by sandbox agent */
  branchName?: string;

  /**
   * QA outcome from sandbox execution.
   * - 'passed'      — QA passed on first attempt
   * - 'self_healed' — QA passed after one or more retries
   * - 'failed'      — All retries exhausted; branch pushed but no PR
   * - 'skipped'     — Provider does not run in-sandbox QA (legacy/non-sandbox providers)
   */
  qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';

  /**
   * Number of QA self-healing retries that occurred.
   * 0 means QA passed first time or was skipped.
   */
  qaRetryCount?: number;

  /**
   * Per-attempt QA history from the sandbox self-healing loop.
   * Populated by providers in WR-6.2. Optional — absent when QA was skipped or
   * the provider does not yet emit qa_attempt markers.
   */
  qaAttempts?: QAAttempt[];
}

/**
 * AI execution error details
 */
export interface IAIExecutionError {
  /** Error code for categorization */
  code: AIErrorCode;

  /** Human-readable error message */
  message: string;

  /** Whether this error is retryable */
  isRetryable: boolean;

  /** Raw output (stdout/stderr) */
  rawOutput?: string;

  /** Exit code from CLI */
  exitCode?: number;
}

/**
 * Error codes for AI execution
 */
export enum AIErrorCode {
  /** CLI command timed out */
  TIMEOUT = 'TIMEOUT',

  /** CLI process crashed */
  PROCESS_CRASH = 'PROCESS_CRASH',

  /** Invalid prompt format */
  INVALID_PROMPT = 'INVALID_PROMPT',

  /** Repository clone failed */
  CLONE_FAILED = 'CLONE_FAILED',

  /** Git operations failed */
  GIT_ERROR = 'GIT_ERROR',

  /** No changes generated */
  NO_CHANGES = 'NO_CHANGES',

  /** Workspace limit exceeded */
  WORKSPACE_LIMIT = 'WORKSPACE_LIMIT',

  /** Disk space exhausted */
  DISK_SPACE = 'DISK_SPACE',

  /** CLI not available */
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',

  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Provider health status with circuit breaker state
 * Extended version for AI execution tracking
 */
export interface IProviderHealthStatus {
  /** Provider identifier */
  provider: AIProvider;

  /** Whether provider is healthy */
  isHealthy: boolean;

  /** Last successful execution timestamp */
  lastSuccessAt: Date | null;

  /** Last failure timestamp */
  lastFailureAt: Date | null;

  /** Consecutive failure count */
  consecutiveFailures: number;

  /** Circuit breaker state */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';

  /** Active execution count */
  activeExecutions: number;
}

/**
 * AI Provider Interface
 * All providers (Cursor, Claude) must implement this interface
 */
export interface IAIProvider {
  /** Provider identifier */
  readonly provider: AIProvider;

  /** Maximum concurrent executions */
  readonly maxConcurrent: number;

  /** Default timeout in milliseconds */
  readonly defaultTimeoutMs: number;

  /**
   * Execute AI code generation
   * @param input Execution parameters
   * @returns Execution result with generated code
   */
  execute(input: IAIExecutionInput): Promise<IAIExecutionResult>;

  /**
   * Check provider health/availability
   */
  checkHealth(): Promise<IProviderHealthStatus>;

  /**
   * Cancel an ongoing execution
   * @param executionId Execution to cancel
   */
  cancel(executionId: string): Promise<void>;
}

/**
 * Workspace information
 */
export interface IWorkspaceInfo {
  /** Unique workspace ID */
  id: string;

  /** Filesystem path */
  path: string;

  /** Ticket ID */
  ticketId: string;

  /** Execution ID */
  executionId: string;

  /** Repository URL */
  repositoryUrl: string;

  /** Feature branch name */
  branchName: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Current status */
  status: 'CREATING' | 'READY' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CLEANING';
}
