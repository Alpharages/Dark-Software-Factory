/**
 * Cursor CLI Headless Provider
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * PRIMARY AI provider for complex, multi-file code generation.
 * Uses Cursor's official CLI with --headless flag for server-side execution.
 *
 * Architecture Reference: ADR-003 (Cursor CLI Headless Mode)
 * FR65: Execute AI code generation
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealthStatus,
  AIErrorCode,
  IAIExecutionError,
} from '../interfaces';
import { WorkspaceService } from './workspace.service';
import { CircuitBreaker, CircuitState } from './circuit-breaker';

const execFileAsync = promisify(execFile);

@Injectable()
export class CursorHeadlessProvider implements IAIProvider, OnModuleInit {
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
    this.cliPath = this.config.get<string>('cursor.cliPath', 'cursor');
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
      const workspaceInfo = await this.workspace.createWorkspace(
        executionId,
        ticketId,
        repositoryUrl,
        baseBranch,
      );
      workspacePath = workspaceInfo.path;

      // 2. Update workspace status
      this.workspace.updateWorkspaceStatus(executionId, 'EXECUTING');
      this.activeGauge.inc();

      // 3. Execute Cursor CLI
      const cliResult = await this.executeCursorCli(
        executionId,
        workspacePath,
        prompt,
        targetFiles,
        timeout,
      );

      // 4. Extract changes
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);

      // 5. Calculate confidence score
      const confidenceScore = this.calculateConfidence(filesChanged, diff);

      // 6. Check if any changes were made
      if (filesChanged.length === 0) {
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

    // Cleanup workspace
    await this.workspace.cleanupWorkspace(executionId, true);
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
    // Build args array (safe from injection when using spawn)
    const args = ['--headless', '--dir', workspacePath, '--apply', prompt, '--wait'];

    if (targetFiles && targetFiles.length > 0) {
      args.push('--files', targetFiles.join(','));
    }

    this.logger.debug(`[${executionId}] Executing: ${this.cliPath} --headless ...`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const childProcess = spawn(this.cliPath, args, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Store process reference for cancellation
      this.activeExecutions.set(executionId, childProcess);

      // Set timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        childProcess.kill('SIGTERM');
      }, timeout);

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Prevent memory overflow
        if (stdout.length > 50 * 1024 * 1024) {
          childProcess.kill('SIGTERM');
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code, signal) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          reject({
            code: AIErrorCode.TIMEOUT,
            message: `Cursor CLI timed out after ${timeout}ms`,
            isRetryable: true,
            exitCode: code,
          });
        } else if (code !== 0) {
          reject({
            code: AIErrorCode.PROCESS_CRASH,
            message: `Cursor CLI exited with code ${code}`,
            isRetryable: this.isRetryableExit(code ?? undefined),
            exitCode: code,
            rawOutput: stderr || stdout,
          });
        } else {
          resolve({ stdout, stderr });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        reject({
          code: AIErrorCode.PROCESS_CRASH,
          message: error.message,
          isRetryable: true,
          rawOutput: stderr,
        });
      });
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

    const errorMessage = error instanceof Error ? error.message : String(error);
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
