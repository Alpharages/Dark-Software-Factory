/**
 * Claude Code Provider
 * Story 19.1: Implement Claude Code CLI Provider
 *
 * SECONDARY AI provider using 'claude' CLI directly.
 * Executed via PtyExecutionService for robust terminal emulation.
 *
 * Architecture Reference: ADR-006 (Claude Code as Secondary Provider)
 * FR65: Execute AI code generation
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { lastValueFrom } from 'rxjs';
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
import { PtyExecutionService, PtySpawnError } from '../services/pty-execution.service';

@Injectable()
export class ClaudeCodeProvider
  implements IAIProvider, IAIPromptExecutor, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClaudeCodeProvider.name);

  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxConcurrent: number = 20;
  readonly defaultTimeoutMs: number = 300_000; // 5 minutes

  /** Active executions tracking (Map<executionId, pid>) */
  private readonly activeExecutions: Map<string, number> = new Map();

  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;

  /** Configuration */
  private model: string = 'claude-sonnet-4-20250514';
  private timeoutMs: number = 120_000;
  private isConfigured: boolean = false;
  private apiKey: string | undefined;
  private baseURL: string | undefined;
  private claudeCliPath: string = 'claude'; // Configurable path to Claude CLI executable

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
    private readonly ptyService: PtyExecutionService,
    @InjectMetric('claude_executions_total')
    private readonly executionsCounter: Counter<string>,
    @InjectMetric('claude_execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('claude_active_executions')
    private readonly activeGauge: Gauge<string>,
    @InjectMetric('claude_tokens_total')
    private readonly tokensCounter: Counter<string>,
    @InjectMetric('claude_cost_cents')
    private readonly costGauge: Gauge<string>,
  ) {
    this.circuitBreaker = new CircuitBreaker('claude-code', {
      failureThreshold: 5,
      resetTimeoutMs: 60_000, // 1 minute
      successThreshold: 2,
    });
  }

  async onModuleInit(): Promise<void> {
    this.apiKey = this.config.get<string>('anthropic.apiKey');
    this.baseURL = this.config.get<string>('anthropic.baseURL');
    this.model = this.config.get<string>('anthropic.model') || 'claude-sonnet-4-20250514';
    this.timeoutMs = this.config.get<number>('anthropic.timeoutMs') || 300_000;
    this.claudeCliPath = this.config.get<string>('anthropic.claudeCliPath') || 'claude';

    // Check if configuration exists - either API key or Base URL (for self-hosted/Ollama)

    if (!this.apiKey && !this.baseURL) {
      this.logger.warn('Claude provider not configured - Missing ANTHROPIC_API_KEY or BASE_URL');
      this.isConfigured = false;
      return;
    }

    this.isConfigured = true;
    this.logger.log(
      `Claude Code CLI Provider initialized: model=${this.model}, ` +
        `timeout=${this.timeoutMs}ms, baseURL=${this.baseURL || 'default'}, ` +
        `cliPath=${this.claudeCliPath}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Kill all active processes on shutdown
    for (const [executionId, pid] of this.activeExecutions) {
      this.logger.log(`Killing execution process ${executionId} (PID: ${pid}) on module destroy`);
      this.ptyService.kill(pid);
    }
    this.activeExecutions.clear();
    this.activeGauge.set(0);
  }

  /**
   * Execute AI code generation using Claude CLI via PTY
   */
  async execute(input: IAIExecutionInput): Promise<IAIExecutionResult> {
    const { correlationId, executionId, ticketId, timeoutMs } = input;

    const timeout = timeoutMs || this.timeoutMs;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] Starting Claude CLI execution for ticket ${ticketId}`);

    // Check if provider is configured
    if (!this.isConfigured) {
      return this.createFailedResult(startTime, '', {
        code: AIErrorCode.CLI_NOT_FOUND,
        message: 'Claude provider not configured',
        isRetryable: false,
      });
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      this.executionsCounter.inc({ status: 'circuit_open' });
      return this.createFailedResult(startTime, '', {
        code: AIErrorCode.UNKNOWN,
        message: 'Circuit breaker is open - provider temporarily unavailable',
        isRetryable: true,
      });
    }

    let workspacePath = '';

    try {
      // 1. Prepare Environment (Create workspace + setup env vars)
      const { workspacePath: path, env } = await this.prepareEnvironment(input);
      workspacePath = path;

      // 2. Update workspace status
      this.workspace.updateWorkspaceStatus(executionId, 'EXECUTING');
      this.activeGauge.inc();

      // 3. Construct prompt for CLI
      const cliPrompt = this.constructCliPrompt(input);

      // 5. Spawn Claude CLI via PTY
      // Command: claude --model <model> "<prompt>"
      const args = [
        '--model',
        this.model,
        // '--print', // Removed: We want file generation, not just printed output - actually story requirement says construct appropriate arguments.
        // Original implementation commented it out. I'll maintain that unless explicitly told otherwise.
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        cliPrompt,
      ];

      this.logger.debug(`Spawning claude with args: ${JSON.stringify(args)} in ${workspacePath}`);

      const { pid, output$, exit$ } = this.ptyService.spawn(this.claudeCliPath, args, {
        cwd: workspacePath,
        env: env,
        name: `claude-${executionId}`,
        cols: 120, // Wider terminal for better output
        rows: 40,
      });

      // Check if spawn failed immediately (pid === -1 indicates pre-spawn validation failure)
      if (pid === -1) {
        this.logger.error(`[${correlationId}] Failed to spawn Claude CLI - command not found`);
        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.CLI_NOT_FOUND,
          message:
            "'claude' CLI not found in PATH. Please install Claude Code CLI: " +
            'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview',
          isRetryable: false,
        });
      }

      this.activeExecutions.set(executionId, pid);

      // 6. Monitor Execution
      let exitPromise: Promise<{ exitCode: number; signal?: number }>;
      try {
        exitPromise = lastValueFrom(exit$);
      } catch (err) {
        // Handle case where exit$ immediately errors
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[${correlationId}] PTY exit observable error: ${errorMsg}`);

        if (err instanceof PtySpawnError) {
          return this.createFailedResult(startTime, workspacePath, {
            code: AIErrorCode.CLI_NOT_FOUND,
            message: err.message,
            isRetryable: false,
          });
        }

        throw err;
      }

      // Monitor output in real-time
      const outputChunks: string[] = [];
      let spawnError: Error | undefined;

      output$.subscribe({
        next: (chunk) => {
          outputChunks.push(chunk);
          // Stream output to logs for real-time visibility (AC #4)
          // We truncate very long chunks to avoid log spam, but ensures activity is visible
          if (chunk.trim()) {
            this.logger.debug(`[${executionId}] PTY: ${chunk.trim()}`);
          }
        },
        error: (err: Error) => {
          spawnError = err;
          this.logger.error(`[${executionId}] PTY Error: ${err}`);
        },
      });

      // Timeout handling
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout);
      });

      // Wait for completion or timeout
      let exitResult: { exitCode: number; signal?: number };
      try {
        exitResult = (await Promise.race([exitPromise, timeoutPromise])) as {
          exitCode: number;
          signal?: number;
        };
      } catch (raceError) {
        // Check if there was a spawn error captured from output$
        if (spawnError) {
          if (spawnError instanceof PtySpawnError) {
            return this.createFailedResult(startTime, workspacePath, {
              code: AIErrorCode.CLI_NOT_FOUND,
              message: spawnError.message,
              isRetryable: false,
            });
          }
          throw spawnError;
        }
        throw raceError;
      }

      // Check if there was a spawn error even if exit succeeded
      if (spawnError) {
        if (spawnError instanceof PtySpawnError) {
          return this.createFailedResult(startTime, workspacePath, {
            code: AIErrorCode.CLI_NOT_FOUND,
            message: spawnError.message,
            isRetryable: false,
          });
        }
        throw spawnError;
      }

      const { exitCode } = exitResult;
      const fullOutput = outputChunks.join('');

      if (exitCode !== 0) {
        throw new Error(
          `Claude CLI exited with code ${exitCode}. Output: ${fullOutput.substring(fullOutput.length - 500)}`,
        );
      }

      this.logger.debug(`[${correlationId}] CLI Output length: ${fullOutput.length}`);

      // 7. Extract changes
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);

      // 8. Calculate confidence (simplified)
      const confidenceScore = filesChanged.length > 0 ? 0.8 : 0.0;

      // 9. Check results
      if (filesChanged.length === 0) {
        this.circuitBreaker.recordFailure();
        // Log the output to help debugging
        this.logger.warn(
          `[${correlationId}] No changes generated. Output preview:\n${fullOutput.substring(0, 500)}`,
        );

        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.NO_CHANGES,
          message: 'Claude CLI completed but no changes were generated',
          isRetryable: true,
          rawOutput: fullOutput,
        });
      }

      // Success
      this.circuitBreaker.recordSuccess();
      this.executionsCounter.inc({ status: 'success' });
      this.workspace.updateWorkspaceStatus(executionId, 'COMPLETED');

      const durationMs = Date.now() - startTime;
      this.durationHistogram.observe({ status: 'success' }, durationMs / 1000);

      this.logger.log(
        `[${correlationId}] Claude execution completed: ${filesChanged.length} files changed, ${durationMs}ms`,
      );

      return {
        success: true,
        codeDiff: diff,
        filesChanged,
        confidenceScore,
        durationMs,
        tokensInput: 0,
        tokensOutput: 0,
        model: this.model,
        workspacePath,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      this.circuitBreaker.recordFailure();
      this.executionsCounter.inc({ status: 'error' });
      this.durationHistogram.observe({ status: 'error' }, durationMs / 1000);

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Claude execution failed: ${errorMessage}`);
      this.workspace.updateWorkspaceStatus(executionId, 'FAILED');

      // Cleanup process if it's still running (e.g. timeout)
      const pid = this.activeExecutions.get(executionId);
      if (pid) {
        this.ptyService.kill(pid);
      }

      return this.createFailedResult(startTime, workspacePath, this.parseError(error));
    } finally {
      this.activeGauge.dec();
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Construct the prompt for the CLI
   */
  private constructCliPrompt(input: IAIExecutionInput): string {
    // Pass prompt through directly
    return input.prompt;
  }

  /**
   * Prepare execution environment (Workspace + Env Vars)
   * Story 19.3: Autonomous Workspace Management
   */
  private async prepareEnvironment(
    input: IAIExecutionInput,
  ): Promise<{ workspacePath: string; env: Record<string, string> }> {
    const { executionId, ticketId, repositoryUrl, baseBranch } = input;

    // 1. Create Workspace
    const workspaceInfo = await this.workspace.createWorkspace(
      executionId,
      ticketId,
      repositoryUrl,
      baseBranch,
    );

    if (!workspaceInfo.path) {
      throw new Error('Workspace path is missing or invalid');
    }

    // 2. Setup Env Vars
    const env: { [key: string]: string } = {
      ...(process.env as { [key: string]: string }),
      ANTHROPIC_API_KEY: this.apiKey || '',
      ANTHROPIC_BASE_URL: this.baseURL || '',
    };

    // If base URL contains 'localhost', assume it might be Ollama simulation or similar
    if (this.baseURL && this.baseURL.includes('localhost')) {
      Object.assign(env, { ANTHROPIC_AUTH_TOKEN: 'ollama' });
    }

    return { workspacePath: workspaceInfo.path, env };
  }

  /**
   * Execute prompt (Standalone)
   */
  async executePrompt(_input: IAIPromptExecutionInput): Promise<IAIPromptExecutionResult> {
    return {
      success: false,
      response:
        'Standalone prompt execution not fully implemented for CLI provider in this iteration',
      durationMs: 0,
    };
  }

  async checkHealth(): Promise<IProviderHealthStatus> {
    const circuitStatus = this.circuitBreaker.getStatus();
    return {
      provider: this.provider,
      isHealthy: this.isConfigured && circuitStatus.state === CircuitState.CLOSED,
      lastSuccessAt: circuitStatus.lastSuccessTime,
      lastFailureAt: circuitStatus.lastFailureTime,
      consecutiveFailures: circuitStatus.failureCount,
      circuitState: circuitStatus.state,
      activeExecutions: this.activeExecutions.size,
    };
  }

  async cancel(executionId: string): Promise<void> {
    const pid = this.activeExecutions.get(executionId);
    if (pid) {
      this.ptyService.kill(pid);
      this.activeExecutions.delete(executionId);
      this.logger.log(`[${executionId}] Execution cancelled`);
    }
  }

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

  private parseError(error: unknown): IAIExecutionError {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Attempt to map common CLI errors
    if (errorMessage.includes('ENOENT') || errorMessage.includes('executable not found')) {
      return {
        code: AIErrorCode.CLI_NOT_FOUND,
        message: "'claude' executable not found in PATH",
        isRetryable: false,
      };
    }
    if (errorMessage.includes('timed out')) {
      return { code: AIErrorCode.TIMEOUT, message: errorMessage, isRetryable: true };
    }

    return {
      code: AIErrorCode.UNKNOWN,
      message: errorMessage,
      isRetryable: true,
    };
  }
}
