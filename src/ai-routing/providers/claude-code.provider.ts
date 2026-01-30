/**
 * Claude Code Provider
 * Story 19.1: Implement Claude Code CLI Provider
 *
 * SECONDARY AI provider using 'claude' CLI directly.
 * Executed via child_process.spawn with autonomous context management.
 *
 * Architecture Reference: ADR-006 (Claude Code as Secondary Provider)
 * FR65: Execute AI code generation
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { spawn, ChildProcess } from 'child_process';
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

@Injectable()
export class ClaudeCodeProvider
  implements IAIProvider, IAIPromptExecutor, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClaudeCodeProvider.name);

  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxConcurrent: number = 20;
  readonly defaultTimeoutMs: number = 300_000; // 5 minutes

  /** Active executions tracking */
  private readonly activeExecutions: Map<string, ChildProcess> = new Map();

  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;

  /** Configuration */
  private model: string = 'claude-sonnet-4-20250514';
  private timeoutMs: number = 120_000;
  private isConfigured: boolean = false;
  private apiKey: string | undefined;
  private baseURL: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
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

    // Check if configuration exists - either API key or Base URL (for self-hosted/Ollama)

    if (!this.apiKey && !this.baseURL) {
      this.logger.warn('Claude provider not configured - Missing ANTHROPIC_API_KEY or BASE_URL');
      this.isConfigured = false;
      return;
    }

    this.isConfigured = true;
    this.logger.log(
      `Claude Code CLI Provider initialized: model=${this.model}, ` +
        `timeout=${this.timeoutMs}ms, baseURL=${this.baseURL || 'default'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Kill all active processes on shutdown
    for (const [executionId, childProcess] of this.activeExecutions) {
      this.logger.log(`Killing execution process ${executionId} on module destroy`);
      childProcess.kill();
    }
    this.activeExecutions.clear();
    this.activeGauge.set(0);
  }

  /**
   * Execute AI code generation using Claude CLI
   */
  async execute(input: IAIExecutionInput): Promise<IAIExecutionResult> {
    const { correlationId, executionId, ticketId, repositoryUrl, baseBranch, timeoutMs } = input;

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

      // 3. Construct prompt for CLI
      const cliPrompt = this.constructCliPrompt(input);

      // 4. Prepare Environment
      const env = {
        ...process.env,
        ANTHROPIC_API_KEY: this.apiKey || '',
        ANTHROPIC_BASE_URL: this.baseURL || '',
        // Allow overriding headers or other vars if needed
        // NODE_ENV: 'production',
      };

      // If base URL contains 'localhost', assume it might be Ollama simulation or similar
      if (this.baseURL && this.baseURL.includes('localhost')) {
        // Example legacy var support if needed, or based on story 'ANTHROPIC_AUTH_TOKEN=ollama'
        // Assuming this is handled by just passing what we have.
        // Story AC5 example: ANTHROPIC_AUTH_TOKEN=ollama
        // We'll set it if not present, for safety or if config has it.
        Object.assign(env, { ANTHROPIC_AUTH_TOKEN: 'ollama' });
      }

      // 5. Spawn Claude CLI
      // Command: claude --model <model> "<prompt>"
      const args = [
        '--model',
        this.model,
        // '--print', // Removed: We want file generation, not just printed output
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        cliPrompt,
      ];

      this.logger.debug(`Spawning claude with args: ${JSON.stringify(args)} in ${workspacePath}`);

      const child = spawn('claude', args, {
        cwd: workspacePath,
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, pipe stdout/stderr
      });

      this.activeExecutions.set(executionId, child);

      // 6. Handle Process Execution
      const { stdout, stderr } = await this.monitorProcess(child, executionId, timeout);

      // 7. Extract changes
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);

      // 8. Calculate confidence (simplified)
      const confidenceScore = filesChanged.length > 0 ? 0.8 : 0.0;

      // 9. Check results
      if (filesChanged.length === 0) {
        this.circuitBreaker.recordFailure();
        // Log the output to help debugging
        this.logger.warn(
          `[${correlationId}] No changes generated. Output preview:\nSTDOUT: ${stdout.substring(0, 500)}\nSTDERR: ${stderr.substring(0, 500)}`,
        );

        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.NO_CHANGES,
          message: 'Claude CLI completed but no changes were generated',
          isRetryable: true,
          rawOutput: `STDOUT: ${stdout}\nSTDERR: ${stderr}`,
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
        tokensInput: 0, // Not available via CLI easily without parsing logs
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

      return this.createFailedResult(startTime, workspacePath, this.parseError(error));
    } finally {
      this.activeGauge.dec();
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Monitor the spawned process
   */
  private async monitorProcess(
    child: ChildProcess,
    executionId: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdoutData = '';
      let stderrData = '';
      let timedOut = false;

      // Timeout handling
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill(); // Terminate process
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          // Stream to logger
          this.logger.debug(`[Claude CLI stdout] ${text.substring(0, 100)}...`);
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          this.logger.warn(`[Claude CLI stderr] ${text}`);
        });
      }

      child.on('error', (err) => {
        if (!timedOut) {
          clearTimeout(timer);
          reject(err);
        }
      });

      child.on('close', (code) => {
        if (!timedOut) {
          clearTimeout(timer);
          if (code === 0) {
            resolve({ stdout: stdoutData, stderr: stderrData });
          } else {
            const errorMsg = `Claude CLI exited with code ${code}. Stderr: ${stderrData.substring(0, 500)}`;
            reject(new Error(errorMsg));
          }
        }
      });
    });
  }

  /**
   * Construct the prompt for the CLI
   */
  private constructCliPrompt(input: IAIExecutionInput): string {
    // Story 19-2: The prompt is now fully constructed by ClaudeCodePromptBuilder
    // with all necessary context, instructions, and task details.
    // We pass it through directly to avoid redundant wrapping.
    return input.prompt;
  }

  /**
   * Execute prompt (Standalone)
   */
  async executePrompt(_input: IAIPromptExecutionInput): Promise<IAIPromptExecutionResult> {
    // Not strictly required by story tasks but good for interface compliance
    // Implementation would be similar to execute but returning stdout as response
    // For now returning not implemented or simple wrapper
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
    const child = this.activeExecutions.get(executionId);
    if (child) {
      child.kill();
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
    if (errorMessage.includes('ENOENT')) {
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
