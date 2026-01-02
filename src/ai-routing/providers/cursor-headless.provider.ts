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
import { execFile, execSync, ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealthStatus,
  AIErrorCode,
  IAIExecutionError,
  IAIPromptExecutor,
  IAIPromptExecutionInput,
  IAIPromptExecutionResult,
} from '../interfaces';
import { WorkspaceService } from './workspace.service';
import { CircuitBreaker, CircuitState } from './circuit-breaker';

const execFileAsync = promisify(execFile);

@Injectable()
export class CursorHeadlessProvider implements IAIProvider, IAIPromptExecutor, OnModuleInit {
  private readonly logger = new Logger(CursorHeadlessProvider.name);

  readonly provider = AIProvider.CURSOR_HEADLESS;
  maxConcurrent: number = 10;
  defaultTimeoutMs: number = 300_000; // 5 minutes

  /** Active executions map */
  private readonly activeExecutions: Map<string, ChildProcess> = new Map();

  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;

  /** Configuration */
  private cliPath!: string;
  private isCliAvailable: boolean = false;

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
    @InjectMetric('cursor_executions_total')
    private readonly executionsCounter: Counter<string>,
    @InjectMetric('cursor_execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('cursor_active_executions')
    private readonly activeGauge: Gauge<string>,
  ) {
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
    const process = this.activeExecutions.get(executionId);
    if (process) {
      process.kill('SIGTERM');
      this.activeExecutions.delete(executionId);
      this.logger.log(`[${executionId}] Execution cancelled`);
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
   * Execute Cursor CLI command safely using spawn (prevents command injection)
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

    //AI-native dependency installation: Let Cursor CLI detect and install deps automatically
    const dependencyHint = `IMPORTANT: Before making any code changes, check if dependencies are missing (e.g., no node_modules/, vendor/, venv/, etc.). If so, install them using the appropriate package manager for this project.

`;

    const scopedPrompt =
      targetFiles && targetFiles.length > 0
        ? `${dependencyHint}Focus changes only in these files if possible:\n${targetFiles.map((f) => `- ${f}`).join('\n')}\n\n${prompt}`
        : `${dependencyHint}${prompt}`;

    this.logger.log(`[${executionId}] 🚀 Starting Cursor CLI execution`);
    this.logger.log(`[${executionId}]    Command: ${this.cliPath}`);
    this.logger.log(`[${executionId}]    Args: -p --force --output-format text "<prompt>"`);
    this.logger.log(`[${executionId}]    Working dir: ${workspacePath}`);
    this.logger.log(`[${executionId}]    Timeout: ${timeout}ms`);
    this.logger.debug(`[${executionId}]    Prompt preview: ${prompt.substring(0, 100)}...`);

    // Use execSync wrapped in Promise - proven to work (completes in ~15s)
    // execFile was timing out for unknown reasons
    return new Promise((resolve, reject) => {
      // Build command string
      const quotedPrompt = scopedPrompt.replace(/"/g, '\\"');
      const command = `${this.cliPath} -p --force --output-format text "${quotedPrompt}"`;

      this.logger.debug(`[${executionId}] Executing CLI command...`);

      try {
        const stdout = execSync(command, {
          cwd: workspacePath,
          timeout,
          encoding: 'utf8',
          maxBuffer: 50 * 1024 * 1024, // 50MB
          stdio: 'pipe',
        });

        this.logger.log(`[${executionId}] 🏁 CLI process completed`);
        this.logger.debug(`[${executionId}]    stdout length: ${stdout.length} bytes`);
        this.logger.log(`[${executionId}] ✅ CLI execution completed successfully`);
        this.logger.debug(`[${executionId}]    Output preview: ${stdout.substring(0, 200)}...`);

        resolve({ stdout, stderr: '' });
      } catch (_error) {
        this.logger.log(`[${executionId}] 🏁 CLI process completed with error`);

        // Type assertion for execSync error object
        const execError = _error as {
          killed?: boolean;
          signal?: string;
          status?: number;
          stdout?: Buffer;
          stderr?: Buffer;
          message?: string;
        };

        // Check if it's a timeout
        if (execError.killed || execError.signal === 'SIGTERM') {
          this.logger.error(`[${executionId}] ⏱️  CLI execution timed out after ${timeout}ms`);
          reject({
            code: AIErrorCode.TIMEOUT,
            message: `Cursor CLI timed out after ${timeout}ms`,
            isRetryable: true,
            exitCode: execError.status,
          });
          return;
        }

        // Other errors
        const exitCode = execError.status || 0;
        const stdout = execError.stdout?.toString() || '';
        const stderr = execError.stderr?.toString() || '';

        this.logger.debug(`[${executionId}]    stdout length: ${stdout.length} bytes`);
        this.logger.debug(`[${executionId}]    stderr length: ${stderr.length} bytes`);

        if (exitCode !== 0) {
          const mappedCode =
            exitCode === 127 ? AIErrorCode.CLI_NOT_FOUND : AIErrorCode.PROCESS_CRASH;
          this.logger.error(`[${executionId}] ❌ CLI failed with exit code ${exitCode}`);
          this.logger.error(`[${executionId}]    Error type: ${mappedCode}`);
          if (stderr) this.logger.error(`[${executionId}]    stderr: ${stderr.substring(0, 500)}`);
          if (stdout) this.logger.debug(`[${executionId}]    stdout: ${stdout.substring(0, 500)}`);

          reject({
            code: mappedCode,
            message: `Cursor CLI exited with code ${exitCode}`,
            isRetryable: mappedCode !== AIErrorCode.CLI_NOT_FOUND && this.isRetryableExit(exitCode),
            exitCode,
            rawOutput: stderr || stdout,
          });
          return;
        }

        // Shouldn't reach here
        reject({
          code: AIErrorCode.UNKNOWN,
          message: execError.message || 'Unknown error',
          isRetryable: true,
        });
      }
    });
  }

  /**
   * Check if Cursor CLI is available
   */
  private async checkCliAvailability(): Promise<void> {
    try {
      await execFileAsync(this.cliPath, ['--version'], { timeout: 5000 });
      this.isCliAvailable = true;
      this.logger.log(`Cursor CLI available at: ${this.cliPath}`);
    } catch {
      this.isCliAvailable = false;
      this.logger.warn(`Cursor CLI not available at: ${this.cliPath}`);
    }
  }

  /**
   * Calculate confidence score based on changes
   */
  private calculateConfidence(filesChanged: string[], diff: string): number {
    // Base confidence
    let confidence = 0.5;

    // More files = higher confidence (up to a point)
    if (filesChanged.length > 0 && filesChanged.length <= 5) {
      confidence += 0.1 * filesChanged.length;
    } else if (filesChanged.length > 5) {
      confidence += 0.3; // Cap at +0.3 for many files
    }

    // Significant diff = higher confidence
    if (diff.length > 1000) {
      confidence += 0.1;
    }
    if (diff.length > 5000) {
      confidence += 0.1;
    }

    // Cap at 0.95 (never 100% confident)
    return Math.min(confidence, 0.95);
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
