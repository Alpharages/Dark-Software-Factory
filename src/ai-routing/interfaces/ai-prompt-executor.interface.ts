/**
 * Standalone AI Prompt Execution Interface
 *
 * Purpose: Enable any module to execute AI prompts on existing workspaces
 * without managing workspace lifecycle or execution tracking.
 *
 * Use cases:
 * - Commit message generation
 * - PR description generation
 * - Code review comments
 * - Documentation generation
 * - Any AI task on existing code
 */

import { IAIExecutionError } from './ai-provider.interface';

/**
 * Input for standalone AI prompt execution
 */
export interface IAIPromptExecutionInput {
  /**
   * Absolute path to existing workspace directory
   */
  workspacePath: string;

  /**
   * AI prompt/instruction to execute
   */
  prompt: string;

  /**
   * Optional timeout in milliseconds
   * @default 300000 (5 minutes)
   */
  timeoutMs?: number;

  /**
   * Optional context files to include in the prompt
   */
  contextFiles?: string[];
}

/**
 * Result from standalone AI prompt execution
 */
export interface IAIPromptExecutionResult {
  /**
   * Whether execution succeeded
   */
  success: boolean;

  /**
   * AI response text
   */
  response: string;

  /**
   * Execution duration in milliseconds
   */
  durationMs: number;

  /**
   * Error details if execution failed
   */
  error?: IAIExecutionError;

  /**
   * Optional confidence score (0-100)
   */
  confidenceScore?: number;
}

/**
 * Interface for AI providers that support standalone prompt execution
 */
export interface IAIPromptExecutor {
  /**
   * Execute AI prompt on existing workspace
   *
   * @param input - Prompt execution input
   * @returns Result containing AI response
   */
  executePrompt(input: IAIPromptExecutionInput): Promise<IAIPromptExecutionResult>;
}
