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
import * as fs from 'fs';
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
import { WorkspaceService } from './workspace.service';
import { CircuitBreaker, CircuitState } from './circuit-breaker';
import { PtyExecutionService, PtySpawnError } from '../services/pty-execution.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { BaseAIProvider, ExecutionStage } from './base-ai.provider';

@Injectable()
export class ClaudeCodeProvider
  extends BaseAIProvider
  implements IAIPromptExecutor, OnModuleInit, OnModuleDestroy
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

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
    private readonly ptyService: PtyExecutionService,
    protected readonly executionTracker: ExecutionTrackerService,
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
    super();
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

      // 1.5. Emit specific progress for environment prepared (AC #2)
      await this.executionTracker.emitProgress(
        executionId,
        ticketId,
        null, // projectId is optional/unknown here, let tracker handle it
        'Environment ready',
        10,
      );

      // 2. Update workspace status
      this.workspace.updateWorkspaceStatus(executionId, 'EXECUTING');
      this.activeGauge.inc();

      // 3. Construct prompt for CLI
      const cliPrompt = this.constructCliPrompt(input);

      // 5. Spawn Claude CLI via PTY in Docker Container
      // Command: /bin/sh -c "claude --print --model <model> ... | tee /tmp/logs/execution.log"
      // Note: We use shell redirection via tee to capture logs to the mounted volume while preserving PTY output
      const claudeArgs = [
        'claude',
        '--print',
        '--model',
        this.model,
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        cliPrompt,
      ];

      // Wrap in shell command to enable piping to tee
      // We use 'stdbuf -oL' if available to force line buffering, but standard tee is usually fine
      const command = '/bin/sh';
      // Escape arguments for shell execution
      const escapedArgs = claudeArgs
        .map((arg) => `"${arg.replace(/(["'$`\\])/g, '\\$1')}"`)
        .join(' ');
      const args = ['-c', `${escapedArgs} | tee /tmp/logs/execution.log`];

      this.logger.debug(
        `Spawning claude in container with args: ${JSON.stringify(args)} in ${workspacePath}`,
      );
      this.logger.debug(
        `[${correlationId}] Container Env: NODE_OPTIONS=${env.NODE_OPTIONS}, CLAUDE_CODE_REMOTE=${env.CLAUDE_CODE_REMOTE}`,
      );

      // 4. Emit progress for starting Claude
      await this.executionTracker.emitProgress(
        executionId,
        ticketId,
        null,
        'Starting Claude AI...',
        20,
      );

      // Story 23.3: Enforce minimum memory for Claude CLI (prevent OOM)
      // Claude CLI requires at least 4GB to start reliably (2GB V8 heap + OS/container overhead)
      // This allows users to set custom Memory/Swap limits in .env that are respected
      const configuredLimit = this.config.get<number>(
        'sandbox.resourceLimits.defaultMemoryLimitMB',
        512,
      );

      const CLAUDE_MIN_MEMORY_MB = 4096; // 4GB minimum for Claude CLI
      let memoryLimitBytes: number | undefined;
      let claudeMemoryLimitMB: number;

      if (configuredLimit < CLAUDE_MIN_MEMORY_MB) {
        this.logger.debug(
          `[${correlationId}] Enforcing minimum ${CLAUDE_MIN_MEMORY_MB}MB memory for Claude (configured: ${configuredLimit}MB)`,
        );
        memoryLimitBytes = CLAUDE_MIN_MEMORY_MB * 1024 * 1024;
        claudeMemoryLimitMB = CLAUDE_MIN_MEMORY_MB;
      } else {
        this.logger.debug(
          `[${correlationId}] Using configured memory limit for Claude: ${configuredLimit}MB`,
        );
        claudeMemoryLimitMB = configuredLimit;
        memoryLimitBytes = configuredLimit * 1024 * 1024;
      }

      // Ensure host log directory exists
      const hostLogDir = `/tmp/dsf-agent-logs/${executionId}`;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(hostLogDir, { recursive: true });

      // 5. Spawn container and run Claude
      this.logger.log(
        `[CONTAINER_SPAWN] Spawning container for execution ${executionId} with memory limit ${claudeMemoryLimitMB}MB`,
      );
      // Emit progress: Container spawn (25%)
      await this.emitStageProgress(executionId, ticketId, ExecutionStage.CONTAINER_SPAWN);

      const containerResult = await this.ptyService.spawnInContainer(command, args, {
        executionId,
        ticketId,
        cols: 120,
        rows: 40,
        env: env,
        workspacePath: workspacePath,
        memoryLimit: memoryLimitBytes, // Undefined = use config
        extraBinds: [`${hostLogDir}:/tmp/logs:rw`], // Mount log directory
      });

      const { pid, output$, exit$, containerId } = containerResult;

      // Check if spawn failed immediately (pid === -1 indicates pre-spawn validation failure)
      if (pid === -1) {
        this.logger.error(`[${correlationId}] Failed to spawn Claude CLI - command not found`);
        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.CLI_NOT_FOUND,
          message:
            "'claude' CLI not found in container. Please ensure it's installed in dsf-agent-base image.",
          isRetryable: false,
        });
      }

      this.activeExecutions.set(executionId, pid);
      this.logger.log(`[${correlationId}] Container spawned: ${containerId} (pseudo-PID ${pid})`);

      // 6. Monitor Execution
      let exitPromise: Promise<{ exitCode: number; signal?: number }>;
      try {
        exitPromise = lastValueFrom(exit$);
      } catch (err) {
        // Handle case where exit$ immediately errors
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[${correlationId}] Container exit observable error: ${errorMsg}`);

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
      let hasEmittedOutputProgress = false;
      let lastKnownStage = 'Starting';

      output$.subscribe({
        next: (chunk) => {
          outputChunks.push(chunk);
          // Stream output to logs for real-time visibility (AC #4)
          if (chunk.trim()) {
            const cleanChunk = chunk.trim();
            // Log output at INFO level temporarily to debug OOM/Stage issues
            this.logger.log(`[${executionId}] Container Output: ${cleanChunk}`);

            const lowerChunk = cleanChunk.toLowerCase();

            // Stage Detection Logic
            if (lowerChunk.includes('cloning')) {
              lastKnownStage = 'Cloning repository';
              this.executionTracker
                .emitProgress(executionId, ticketId, null, 'Cloning repository...', 30)
                .catch(() => {});
            } else if (lowerChunk.includes('planning') || lowerChunk.includes('thinking')) {
              lastKnownStage = 'AI Planning';
              this.emitStageProgress(executionId, ticketId, ExecutionStage.AI_PLANNING).catch(
                () => {},
              );
            } else if (lowerChunk.includes('writing') || lowerChunk.includes('editing')) {
              lastKnownStage = 'Writing code';
              this.emitStageProgress(executionId, ticketId, ExecutionStage.AI_WRITING_CODE).catch(
                () => {},
              );
            } else if (
              lowerChunk.includes('running') ||
              lowerChunk.includes('verifying') ||
              lowerChunk.includes('test')
            ) {
              lastKnownStage = 'Running verification';
              this.emitStageProgress(executionId, ticketId, ExecutionStage.AI_VERIFICATION).catch(
                () => {},
              );
            } else {
              // Log unrecognized chunks to help refine stage detection
              this.logger.log(
                `[${executionId}] Unrecognized stage output: ${cleanChunk.substring(0, 50)}...`,
              );
            }

            if (!hasEmittedOutputProgress) {
              hasEmittedOutputProgress = true;
              this.executionTracker
                .emitProgress(
                  executionId,
                  ticketId,
                  null,
                  'AI is thinking/coding...',
                  25, // Started
                )
                .catch(() => {});
            }
          }
        },
        error: (err: Error) => {
          spawnError = err;
          this.logger.error(`[${executionId}] Container Error: ${err}`);
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
        // Handle specific exit codes
        if (exitCode === 124) {
          // Exit code 124 = container execution timeout (from PtyExecutionService)
          throw new Error(
            `Claude CLI timed out (exit code 124 - Timeout). ` +
              `The container exceeded its execution time limit (DOCKER_CONTAINER_TIMEOUT_MS). ` +
              `Last known stage: ${lastKnownStage}. ` +
              `Increase DOCKER_CONTAINER_TIMEOUT_MS in .env to allow longer executions.`,
          );
        }
        if (exitCode === 137) {
          // Exit code 137 = SIGKILL (128 + 9), typically OOM killer
          throw new Error(
            `Claude CLI was killed (exit code 137 - Out of Memory). ` +
              `The container exceeded its memory allocation. ` +
              `Last known stage: ${lastKnownStage}. ` +
              `If SANDBOX_MEMORY_LIMIT_MB is already high, check your Docker Desktop resource settings (VM Memory/Swap) as the host might be out of resources.`,
          );
        }
        throw new Error(
          `Claude CLI exited with code ${exitCode}. Output: ${fullOutput.substring(fullOutput.length - 500)}`,
        );
      }

      this.logger.debug(`[${correlationId}] CLI Output length: ${fullOutput.length}`);

      // 7. Extract changes
      await this.executionTracker.emitProgress(
        executionId,
        ticketId,
        null,
        'Analyzing changes...',
        90,
      );
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

    // Callback to emit progress during workspace creation
    const onProgress = async (status: string) => {
      await this.executionTracker.emitProgress(executionId, ticketId, null, status, 5);
    };

    // 1. Create Workspace
    const workspaceInfo = await this.workspace.createWorkspace(
      executionId,
      ticketId,
      repositoryUrl,
      baseBranch,
      (status) => {
        onProgress(status).catch((e) => this.logger.warn(`Failed to emit progress: ${e.message}`));
      },
    );

    if (!workspaceInfo.path) {
      throw new Error('Workspace path is missing or invalid');
    }

    // 2. Setup Env Vars
    // Note: Only pass necessary env vars, not process.env
    // Host-specific vars (NODE_OPTIONS, NVM_*, etc.) can conflict with container's Node.js
    const env: { [key: string]: string } = {
      ANTHROPIC_API_KEY: this.apiKey || '',
      ANTHROPIC_BASE_URL: this.baseURL || '',
      // Explicitly disable remote mode to prevent 8GB memory allocation by CLI
      CLAUDE_CODE_REMOTE: 'false',
      // Force V8 heap limit to 2GB (leaving ~2GB for OS/container overhead within 4GB container)
      // Previous value of 3072MB caused OOM kills when container limit was 4GB (heap + overhead > limit)
      NODE_OPTIONS: '--max-old-space-size=2048',
    };

    // If base URL contains 'localhost', assume it might be Ollama simulation or similar
    if (this.baseURL && this.baseURL.includes('localhost')) {
      env.ANTHROPIC_AUTH_TOKEN = 'ollama';
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
      // Note: For container executions, we'd need the container reference
      // For now, this will attempt to kill by PID (which won't work for containers)
      // TODO: Store container references for proper cleanup
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
