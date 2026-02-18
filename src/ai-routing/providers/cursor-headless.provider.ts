/**
 * Cursor CLI Headless Provider
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * PRIMARY AI provider for complex, multi-file code generation.
 * Uses Cursor's official Headless CLI (`cursor-agent`) in print mode for server-side execution.
 *
 * Architecture Reference: ADR-003 (Cursor CLI Headless Mode)
 * FR65: Execute AI code generation
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealthStatus,
  AIErrorCode,
  IAIExecutionError,
  IAIPromptExecutor,
  IAIPromptExecutionInput,
  IAIPromptExecutionResult,
} from '../interfaces';
import { PtyExecutionService } from '../services/pty-execution.service';
import { WorkspaceService } from './workspace.service';
import { CircuitBreaker, CircuitState } from './circuit-breaker';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { BaseAIProvider } from './base-ai.provider';

@Injectable()
export class CursorHeadlessProvider
  extends BaseAIProvider
  implements IAIPromptExecutor, OnModuleInit
{
  private readonly logger = new Logger(CursorHeadlessProvider.name);

  readonly provider = AIProvider.CURSOR_HEADLESS;
  maxConcurrent: number = 10;
  defaultTimeoutMs: number = 300_000; // 5 minutes

  /** Active executions map */
  private readonly activeExecutions: Map<string, number> = new Map();

  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;

  /** Configuration */
  private cliPath!: string;
  private isCliAvailable: boolean = false;

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
    private readonly ptyService: PtyExecutionService,
    protected readonly executionTracker: ExecutionTrackerService,
    @InjectMetric('cursor_executions_total')
    private readonly executionsCounter: Counter<string>,
    @InjectMetric('cursor_execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('cursor_active_executions')
    private readonly activeGauge: Gauge<string>,
  ) {
    super();
    this.circuitBreaker = new CircuitBreaker('cursor-headless', {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      successThreshold: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    // Cursor docs: headless automation uses `cursor-agent` (print mode + --force)
    // See: https://cursor.com/docs/cli/headless
    this.cliPath = this.config.get<string>('cursor.cliPath', 'cursor-agent');
    this.maxConcurrent = this.config.get<number>('cursor.maxConcurrentWorkspaces', 10);
    this.defaultTimeoutMs = this.config.get<number>('cursor.headlessTimeoutMs', 300_000);

    // Check if CLI is available
    await this.checkCliAvailability();

    this.logger.log(
      `Cursor Headless Provider initialized: cli=${this.cliPath}, ` +
        `available=${this.isCliAvailable}, timeout=${this.defaultTimeoutMs}ms`,
    );
  }

  /**
   * Execute AI code generation using Cursor CLI
   */
  async execute(input: IAIExecutionInput): Promise<IAIExecutionResult> {
    const {
      correlationId,
      executionId,
      ticketId,
      prompt,
      repositoryUrl,
      baseBranch,
      targetFiles,
      timeoutMs,
    } = input;

    const timeout = timeoutMs || this.defaultTimeoutMs;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] Starting Cursor execution for ticket ${ticketId}`);

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      this.executionsCounter.inc({ status: 'circuit_open' });
      return this.createFailedResult(startTime, '', {
        code: AIErrorCode.UNKNOWN,
        message: 'Circuit breaker is open - provider temporarily unavailable',
        isRetryable: true,
      });
    }

    // Check CLI availability
    if (!this.isCliAvailable) {
      await this.checkCliAvailability();
      if (!this.isCliAvailable) {
        return this.createFailedResult(startTime, '', {
          code: AIErrorCode.CLI_NOT_FOUND,
          message: `Cursor CLI not found at: ${this.cliPath}`,
          isRetryable: false,
        });
      }
    }

    let workspacePath = '';

    try {
      // 1. Create workspace
      const phase1Start = Date.now();
      this.logger.log(`[${correlationId}] 📁 Phase 1/3: Creating workspace for ticket ${ticketId}`);
      const workspaceInfo = await this.workspace.createWorkspace(
        executionId,
        ticketId,
        repositoryUrl,
        baseBranch,
        undefined, // no onProgress callback
        AIProvider.CURSOR_HEADLESS,
      );
      workspacePath = workspaceInfo.path;
      this.logger.log(
        `[${correlationId}]    ✅ Workspace created at: ${workspacePath} (${Date.now() - phase1Start}ms)`,
      );

      // 2. Update workspace status
      this.workspace.updateWorkspaceStatus(executionId, 'EXECUTING');
      this.activeGauge.inc();

      // 3. Execute Cursor CLI
      const phase2Start = Date.now();
      this.logger.log(`[${correlationId}] 🤖 Phase 2/3: Executing Cursor CLI`);
      const cliResult = await this.executeCursorCli(
        executionId,
        workspacePath,
        prompt,
        targetFiles,
        timeout,
      );
      this.logger.log(
        `[${correlationId}]    ✅ CLI execution completed (${Date.now() - phase2Start}ms)`,
      );

      // 4. Extract changes
      const phase3Start = Date.now();
      this.logger.log(`[${correlationId}] 🔍 Phase 3/3: Extracting changes from workspace`);
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);
      this.logger.log(
        `[${correlationId}]    ✅ Found ${filesChanged.length} changed file(s), ${diff.length} bytes diff (${Date.now() - phase3Start}ms)`,
      );

      // 5. Calculate confidence score
      const confidenceScore = this.calculateConfidence(filesChanged, diff);

      // 6. Check if any changes were made
      if (filesChanged.length === 0) {
        this.logger.warn(
          `[${correlationId}] ⚠️  No changes detected - CLI completed but no files modified`,
        );
        this.circuitBreaker.recordFailure();
        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.NO_CHANGES,
          message: 'Cursor CLI completed but no changes were generated',
          isRetryable: true,
          rawOutput: cliResult.stdout,
        });
      }

      // Success!
      this.circuitBreaker.recordSuccess();
      this.executionsCounter.inc({ status: 'success' });
      this.workspace.updateWorkspaceStatus(executionId, 'COMPLETED');

      const durationMs = Date.now() - startTime;
      this.durationHistogram.observe({ status: 'success' }, durationMs / 1000);

      this.logger.log(
        `[${correlationId}] Cursor execution completed: ${filesChanged.length} files, ` +
          `${diff.length} bytes diff, ${durationMs}ms`,
      );

      return {
        success: true,
        codeDiff: diff,
        filesChanged,
        confidenceScore,
        durationMs,
        tokensInput: Math.ceil(prompt.length / 4) + 1000, // Conservative estimate for context
        tokensOutput: Math.ceil(diff.length / 4), // Rough token estimate
        model: 'gpt-4o', // Default model for Cursor
        workspacePath,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      this.circuitBreaker.recordFailure();
      this.executionsCounter.inc({ status: 'error' });
      this.durationHistogram.observe({ status: 'error' }, durationMs / 1000);

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Cursor execution failed: ${errorMessage}`);

      this.workspace.updateWorkspaceStatus(executionId, 'FAILED');

      return this.createFailedResult(startTime, workspacePath, this.parseError(error));
    } finally {
      this.activeGauge.dec();
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Check provider health
   */
  async checkHealth(): Promise<IProviderHealthStatus> {
    const circuitStatus = this.circuitBreaker.getStatus();

    return {
      provider: this.provider,
      isHealthy: this.isCliAvailable && circuitStatus.state === CircuitState.CLOSED,
      lastSuccessAt: circuitStatus.lastSuccessTime,
      lastFailureAt: circuitStatus.lastFailureTime,
      consecutiveFailures: circuitStatus.failureCount,
      circuitState: circuitStatus.state,
      activeExecutions: this.activeExecutions.size,
    };
  }

  /**
   * Cancel an ongoing execution
   */
  async cancel(executionId: string): Promise<void> {
    const pid = this.activeExecutions.get(executionId);
    if (pid) {
      this.ptyService.kill(pid, 'SIGTERM');
      this.activeExecutions.delete(executionId);
      this.logger.log(`[${executionId}] Execution cancelled (killed PID ${pid})`);
    }

    // Workspace cleanup is now handled by GitHubCommitOrchestrator after push
    // This allows QA and commit operations to use the workspace
    // await this.workspace.cleanupWorkspace(executionId, true);
  }

  /**
   * Execute AI prompt on existing workspace (Standalone method)
   * NEW: Implements IAIPromptExecutor interface
   *
   * This method allows any module to execute AI prompts on existing workspaces
   * without managing workspace lifecycle or triggering execution completion.
   *
   * Use cases:
   * - Commit message generation
   * - PR description generation
   * - Code review comments
   * - Documentation generation
   */
  async executePrompt(input: IAIPromptExecutionInput): Promise<IAIPromptExecutionResult> {
    const { workspacePath, prompt, timeoutMs, contextFiles } = input;
    const timeout = timeoutMs || this.defaultTimeoutMs;
    const startTime = Date.now();

    this.logger.log(`Executing standalone prompt on workspace: ${workspacePath}`);

    try {
      // Execute Cursor CLI on existing workspace
      const result = await this.executeCursorCli(
        'prompt-execution',
        workspacePath,
        prompt,
        contextFiles,
        timeout,
      );

      const durationMs = Date.now() - startTime;
      this.logger.log(`Prompt execution completed in ${durationMs}ms`);

      return {
        success: true,
        response: result.stdout,
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const parsedError = this.parseError(error);

      this.logger.error(`Prompt execution failed: ${parsedError.message}`);

      return {
        success: false,
        response: '',
        durationMs,
        error: parsedError,
      };
    }
  }

  /**
   * Execute Cursor CLI command safely using PtyExecutionService in Docker container
   */
  private async executeCursorCli(
    executionId: string,
    workspacePath: string,
    prompt: string,
    targetFiles?: string[],
    timeout: number = this.defaultTimeoutMs,
  ): Promise<{ stdout: string; stderr: string }> {
    // Cursor Headless CLI (docs): `cursor-agent -p --force "<prompt>"`
    // We rely on WorkspaceService extracting changes from the workspace after the CLI finishes.

    const dependencyHint =
      'IMPORTANT: Before making any code changes, check if dependencies are missing (e.g., no node_modules/, vendor/, venv/, etc.). If so, install them using the appropriate package manager for this project.\n\n';

    const scopedPrompt =
      targetFiles && targetFiles.length > 0
        ? `${dependencyHint}Focus changes only in these files if possible:\n${targetFiles.map((f) => `- ${f}`).join('\n')}\n\n${prompt}`
        : `${dependencyHint}${prompt}`;

    this.logger.log(`[${executionId}] 🚀 Starting Cursor CLI execution (Docker Container)`);
    this.logger.log(`[${executionId}]    Command: ${this.cliPath}`);
    this.logger.log(`[${executionId}]    Args: -p --force --output-format text "<prompt>"`);
    this.logger.log(`[${executionId}]    Working dir: ${workspacePath}`);
    this.logger.log(`[${executionId}]    Timeout: ${timeout}ms`);
    this.logger.debug(`[${executionId}]    Prompt preview: ${prompt.substring(0, 100)}...`);

    return new Promise((resolve, reject) => {
      // Build command arguments
      const args = ['-p', '--force', '--output-format', 'text', scopedPrompt];

      this.logger.debug(`[${executionId}] Spawning container...`);

      let stdout = '';
      let timer: NodeJS.Timeout;

      // Spawn in container (async)
      this.ptyService
        .spawnInContainer(this.cliPath, args, {
          executionId,
          cols: 120,
          rows: 40,
          cwd: workspacePath, // Note: Container uses /home/agent/workspace, but we pass for logging
          env: {
            NODE_ENV: process.env.NODE_ENV || 'development',
          },
        })
        .then((containerResult) => {
          const { pid, output$, exit$, containerId } = containerResult;

          this.activeExecutions.set(executionId, pid);
          this.logger.log(
            `[${executionId}]    ✅ Container spawned: ${containerId} (pseudo-PID ${pid})`,
          );

          timer = setTimeout(() => {
            this.logger.error(`[${executionId}] ⏱️  CLI execution timed out after ${timeout}ms`);
            containerResult.kill('SIGTERM');
            // Wait a bit then force kill if needed
            setTimeout(() => containerResult.kill('SIGKILL'), 2000);

            reject({
              code: AIErrorCode.TIMEOUT,
              message: `Cursor CLI timed out after ${timeout}ms`,
              isRetryable: true,
            });
          }, timeout);

          // Declare subscriptions first to avoid TDZ issues

          let outputSub: ReturnType<typeof output$.subscribe>;

          let exitSub: ReturnType<typeof exit$.subscribe>;

          // Subscribe to output
          // eslint-disable-next-line prefer-const
          outputSub = output$.subscribe({
            next: (data) => {
              stdout += data;
              const trimData = data.trim();
              if (trimData) {
                this.logger.debug(`[${executionId}][Container] ${trimData}`);
              }
            },
            error: (err) => {
              this.logger.error(`[${executionId}] Container stream error: ${err}`);
            },
          });

          // Subscribe to exit
          // eslint-disable-next-line prefer-const
          exitSub = exit$.subscribe({
            next: ({ exitCode, signal }) => {
              clearTimeout(timer);
              outputSub.unsubscribe();
              exitSub?.unsubscribe();
              this.activeExecutions.delete(executionId);

              this.logger.log(
                `[${executionId}] 🏁 Container exited with code ${exitCode}, signal ${signal || 'none'}`,
              );
              this.logger.debug(`[${executionId}]    Total output length: ${stdout.length} bytes`);

              if (exitCode !== 0) {
                const mappedCode =
                  exitCode === 127 ? AIErrorCode.CLI_NOT_FOUND : AIErrorCode.PROCESS_CRASH;

                this.logger.error(`[${executionId}] ❌ CLI failed with exit code ${exitCode}`);
                this.logger.error(`[${executionId}]    Error type: ${mappedCode}`);

                reject({
                  code: mappedCode,
                  message: `Cursor CLI exited with code ${exitCode}`,
                  isRetryable:
                    mappedCode !== AIErrorCode.CLI_NOT_FOUND && this.isRetryableExit(exitCode),
                  exitCode,
                  rawOutput: stdout,
                });
              } else {
                this.logger.log(`[${executionId}] ✅ CLI execution completed successfully`);
                resolve({ stdout, stderr: '' });
              }
            },
            error: (err) => {
              this.logger.error(`[${executionId}] Container exit stream error: ${err}`);
              reject(err);
            },
          });
        })
        .catch((error) => {
          this.activeExecutions.delete(executionId);
          this.logger.error(`[${executionId}] Failed to spawn container: ${error}`);
          reject({
            code: AIErrorCode.UNKNOWN,
            message: error instanceof Error ? error.message : String(error),
            isRetryable: true,
          });
        });
    });
  }

  /**
   * Check if Cursor CLI is available using PtyExecutionService in Docker container
   */
  private async checkCliAvailability(): Promise<void> {
    try {
      const containerResult = await this.ptyService.spawnInContainer(this.cliPath, ['--version'], {
        executionId: 'cli-check',
        cols: 80,
        rows: 24,
      });

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          containerResult.kill('SIGKILL');
          reject(new Error('CLI version check timed out'));
        }, 5000);

        containerResult.exit$.subscribe({
          next: ({ exitCode }) => {
            clearTimeout(timeout);
            if (exitCode === 0) {
              this.isCliAvailable = true;
              this.logger.log(`Cursor CLI available at: ${this.cliPath} (in container)`);
              resolve();
            } else {
              this.isCliAvailable = false;
              this.logger.warn(
                `Cursor CLI returned error code ${exitCode} at: ${this.cliPath} (in container)`,
              );
              resolve(); // Don't throw, just mark unavailable
            }
          },
          error: (err) => {
            clearTimeout(timeout);
            this.isCliAvailable = false;
            this.logger.warn(`Cursor CLI availability check failed: ${err}`);
            resolve();
          },
        });
      });
    } catch (error) {
      this.isCliAvailable = false;
      this.logger.warn(`Failed to check Cursor CLI availability: ${error}`);
    }
  }

  /**
   * Calculate confidence score based on changes
   * More robust scoring based on files changed and diff size
   */
  private calculateConfidence(filesChanged: string[], diff: string): number {
    if (filesChanged.length === 0) return 0;

    // Base confidence
    let confidence = 0.4;

    // Reliability of changes (number of files)
    // 1-3 files is sweet spot for focused AI changes
    if (filesChanged.length >= 1 && filesChanged.length <= 3) {
      confidence += 0.3;
    } else if (filesChanged.length > 3 && filesChanged.length <= 8) {
      confidence += 0.2;
    } else {
      confidence += 0.1; // Large changes are riskier/less predictable
    }

    // Entropy of changes (diff size)
    const diffSize = diff.length;
    if (diffSize > 100 && diffSize < 5000) {
      confidence += 0.15;
    } else if (diffSize >= 5000 && diffSize < 20000) {
      confidence += 0.1;
    } else if (diffSize >= 20000) {
      confidence += 0.05; // Very large diffs might include noise
    }

    // Penalty for extremely large changes without many files
    if (diffSize > 30000 && filesChanged.length < 2) {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(confidence, 0.98));
  }

  /**
   * Check if exit code indicates retryable error
   */
  private isRetryableExit(exitCode?: number): boolean {
    // Common retryable exit codes
    const retryableCodes = [
      1, // General error (often transient)
      124, // Timeout
      137, // SIGKILL (OOM, etc.)
      143, // SIGTERM
    ];
    return exitCode !== undefined && retryableCodes.includes(exitCode);
  }

  /**
   * Parse error into structured format
   */
  private parseError(error: unknown): IAIExecutionError {
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      if (err.code && Object.values(AIErrorCode).includes(err.code as AIErrorCode)) {
        return error as IAIExecutionError;
      }
    }

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return String(error);
              }
            })()
          : String(error);
    const errorObj = error as Record<string, unknown>;

    return {
      code: AIErrorCode.UNKNOWN,
      message: errorMessage,
      isRetryable: true,
      rawOutput: errorObj?.rawOutput as string | undefined,
      exitCode: errorObj?.exitCode as number | undefined,
    };
  }

  /**
   * Create failed result
   */
  private createFailedResult(
    startTime: number,
    workspacePath: string,
    error: IAIExecutionError,
  ): IAIExecutionResult {
    return {
      success: false,
      codeDiff: null,
      filesChanged: [],
      confidenceScore: 0,
      durationMs: Date.now() - startTime,
      workspacePath,
      error,
    };
  }
}
