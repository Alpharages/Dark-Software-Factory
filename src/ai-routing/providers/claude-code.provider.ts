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
import { ContainerOutputParser, ContainerActivity } from './container-output-parser';

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
  private timeoutMs: number = 300_000;
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
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

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
      // Use --output-format stream-json for real-time streaming (NDJSON)
      // --print mode buffers ALL output and only dumps at the end, giving zero visibility.
      // stream-json streams JSON events as they happen (thinking, tool calls, file ops).
      const claudeArgs = [
        'claude',
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        this.model,
        '--dangerously-skip-permissions',
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
      const logsRoot = this.config.get<string>('sandbox.logsRoot') || '/tmp/dsf-agent-logs';
      const hostLogDir = `${logsRoot}/${executionId}`;
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

      // Monitor output in real-time with rich activity detection
      const outputChunks: string[] = [];
      let spawnError: Error | undefined;
      let hasEmittedOutputProgress = false;
      let lastKnownStage = 'Starting';
      const outputParser = new ContainerOutputParser();
      let lastOutputTime = Date.now();

      // ── Heartbeat Timer ──────────────────────────────────
      // Claude CLI (especially in --print mode) can be silent for minutes.
      // Emit synthetic "AI is working" events every 15s so the PM dashboard
      // shows that the container is alive and processing.
      const HEARTBEAT_INTERVAL_MS = 15_000;
      let heartbeatCount = 0;
      const heartbeatMessages = [
        'AI is analyzing the codebase...',
        'AI is planning changes...',
        'AI is reading project files...',
        'AI is reasoning about the task...',
        'AI is evaluating approaches...',
        'AI is working on implementation...',
      ];
      heartbeatTimer = setInterval(() => {
        const silentDurationSec = Math.floor((Date.now() - lastOutputTime) / 1000);
        const msg = heartbeatMessages[heartbeatCount % heartbeatMessages.length];
        heartbeatCount++;

        this.executionTracker
          .emitActivity(
            executionId,
            ticketId,
            msg,
            'AI_THINKING',
            'brain',
            `Running for ${silentDurationSec}s`,
          )
          .catch(() => {});

        // Advance progress slowly during silent periods (25% → 55% over ~5min)
        const heartbeatPercent = Math.min(55, 25 + heartbeatCount * 2);
        this.executionTracker
          .emitProgress(executionId, ticketId, null, msg, heartbeatPercent)
          .catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);

      output$.subscribe({
        next: (chunk) => {
          outputChunks.push(chunk);
          // Stream output to logs for real-time visibility (AC #4)
          if (chunk.trim()) {
            const cleanChunk = chunk.trim();
            lastOutputTime = Date.now();
            this.logger.log(`[${executionId}] Container Output: ${cleanChunk}`);

            // ── Try stream-json parsing first ───────────────
            // With --output-format stream-json, each line is a JSON event
            const streamActivity = this.parseStreamJsonLine(cleanChunk);
            // Fall back to regex-based detection for plain text output
            const activity = streamActivity ?? outputParser.parse(cleanChunk);

            if (activity) {
              lastKnownStage = activity.activity;

              // Emit structured activity event for PM dashboard timeline
              this.executionTracker
                .emitActivity(
                  executionId,
                  ticketId,
                  activity.activity,
                  activity.category,
                  activity.icon,
                  activity.detail,
                  activity.suggestedPercent,
                  activity.rawContent,
                )
                .catch(() => {});

              // Also update the legacy progress event for the progress bar
              if (activity.suggestedPercent !== undefined) {
                this.executionTracker
                  .emitProgress(
                    executionId,
                    ticketId,
                    null,
                    activity.activity,
                    activity.suggestedPercent,
                  )
                  .catch(() => {});
              }

              // Map to legacy ExecutionStage for backward compatibility
              this.emitLegacyStageIfApplicable(executionId, ticketId, activity.category);
            }

            if (!hasEmittedOutputProgress) {
              hasEmittedOutputProgress = true;
              this.executionTracker
                .emitProgress(executionId, ticketId, null, 'Container started — processing...', 5)
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
        clearInterval(heartbeatTimer);
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

      // ── Stop heartbeat on exit ─────────────────────────
      clearInterval(heartbeatTimer);

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

      // Emit final progress so dashboard reaches 100%
      await this.executionTracker.emitProgress(
        executionId,
        ticketId,
        null,
        'Execution complete',
        100,
      );

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

      const errorMessage =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? (error as { message: string }).message
            : String(error);
      this.logger.error(`[${correlationId}] Claude execution failed: ${errorMessage}`);
      this.workspace.updateWorkspaceStatus(executionId, 'FAILED');

      // Cleanup process if it's still running (e.g. timeout)
      const pid = this.activeExecutions.get(executionId);
      if (pid) {
        this.ptyService.kill(pid);
      }

      return this.createFailedResult(startTime, workspacePath, this.parseError(error));
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
      AIProvider.CLAUDE_CODE,
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
   * Execute standalone AI prompt on an existing workspace.
   *
   * Spawns Claude CLI in a Docker container with the workspace mounted,
   * using text output for simple prompt → response flow.
   *
   * Use cases:
   * - Commit message generation
   * - PR description generation
   * - Code review comments
   * - Any AI task on existing code
   */
  async executePrompt(input: IAIPromptExecutionInput): Promise<IAIPromptExecutionResult> {
    const { workspacePath, prompt, timeoutMs, contextFiles } = input;
    const timeout = timeoutMs || this.timeoutMs;
    const startTime = Date.now();

    this.logger.log(`Executing standalone prompt on workspace: ${workspacePath}`);

    // Check if provider is configured
    if (!this.isConfigured) {
      this.logger.warn('Claude provider not configured - cannot execute standalone prompt');
      return {
        success: false,
        response: 'Claude provider not configured',
        durationMs: 0,
        error: {
          code: AIErrorCode.CLI_NOT_FOUND,
          message: 'Claude provider not configured - Missing ANTHROPIC_API_KEY or BASE_URL',
          isRetryable: false,
        },
      };
    }

    try {
      // Build scoped prompt with optional context files
      let scopedPrompt = prompt;
      if (contextFiles && contextFiles.length > 0) {
        scopedPrompt = `Context files to consider:\n${contextFiles.map((f) => `- ${f}`).join('\n')}\n\n${prompt}`;
      }

      // Build Claude CLI args for text output (simpler than full execution's stream-json)
      // Run claude directly (not through shell) to avoid escaping issues with complex prompts
      const command = 'claude';
      const args = [
        '--print',
        '--model',
        this.model,
        '--dangerously-skip-permissions',
        scopedPrompt,
      ];

      this.logger.debug(`Spawning Claude for standalone prompt in container`);

      // Environment variables for the container
      const env: Record<string, string> = {
        ANTHROPIC_API_KEY: this.apiKey || '',
        ANTHROPIC_BASE_URL: this.baseURL || '',
        CLAUDE_CODE_REMOTE: 'false',
        NODE_OPTIONS: '--max-old-space-size=2048',
      };

      if (this.baseURL && this.baseURL.includes('localhost')) {
        env.ANTHROPIC_AUTH_TOKEN = 'ollama';
      }

      // Spawn in container with existing workspace
      const containerResult = await this.ptyService.spawnInContainer(command, args, {
        executionId: `prompt-${Date.now()}`,
        cols: 120,
        rows: 40,
        env,
        workspacePath,
      });

      const { pid, output$, exit$, containerId } = containerResult;

      // Check if spawn failed immediately
      if (pid === -1) {
        return {
          success: false,
          response: '',
          durationMs: Date.now() - startTime,
          error: {
            code: AIErrorCode.CLI_NOT_FOUND,
            message: "'claude' CLI not found in container for standalone prompt execution",
            isRetryable: false,
          },
        };
      }

      this.logger.log(`Standalone prompt container spawned: ${containerId} (pseudo-PID ${pid})`);

      // Collect output
      const outputChunks: string[] = [];
      let spawnError: Error | undefined;

      output$.subscribe({
        next: (chunk) => {
          outputChunks.push(chunk);
          if (chunk.trim()) {
            this.logger.debug(`[prompt] Container Output: ${chunk.trim().substring(0, 200)}`);
          }
        },
        error: (err: Error) => {
          spawnError = err;
          this.logger.error(`[prompt] Container Error: ${err.message}`);
        },
      });

      // Wait for exit with timeout
      const exitPromise = lastValueFrom(exit$);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Standalone prompt execution timed out after ${timeout}ms`)),
          timeout,
        );
      });

      let exitResult: { exitCode: number; signal?: number };
      try {
        exitResult = (await Promise.race([exitPromise, timeoutPromise])) as {
          exitCode: number;
          signal?: number;
        };
      } catch (raceError) {
        if (spawnError) throw spawnError;
        throw raceError;
      }

      if (spawnError) throw spawnError;

      const fullOutput = outputChunks.join('');
      const durationMs = Date.now() - startTime;

      if (exitResult.exitCode !== 0) {
        this.logger.warn(
          `Standalone prompt CLI exited with code ${exitResult.exitCode}. Output: ${fullOutput.substring(fullOutput.length - 300)}`,
        );
        return {
          success: false,
          response: fullOutput,
          durationMs,
          error: {
            code: AIErrorCode.PROCESS_CRASH,
            message: `Claude CLI exited with code ${exitResult.exitCode} during standalone prompt`,
            isRetryable: exitResult.exitCode !== 127,
          },
        };
      }

      this.logger.log(`Standalone prompt execution completed in ${durationMs}ms`);

      return {
        success: true,
        response: fullOutput.trim(),
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Standalone prompt execution failed: ${errorMessage}`);

      return {
        success: false,
        response: '',
        durationMs,
        error: this.parseError(error),
      };
    }
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

  /**
   * Parse a line of stream-json output from Claude CLI.
   * Claude's --output-format stream-json produces NDJSON like:
   *   {"type":"assistant","subtype":"thinking","content":"..."}
   *   {"type":"tool_use","name":"Read","input":{"file_path":"..."}}
   *   {"type":"tool_result","name":"Read","content":"..."}
   *   {"type":"result","subtype":"success","cost_usd":0.05,...}
   *
   * Returns a ContainerActivity if meaningful, or null to fall through
   * to the regex-based parser.
   */
  private parseStreamJsonLine(line: string): ContainerActivity | null {
    // Only parse lines that look like JSON objects
    if (!line.startsWith('{')) return null;

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const type = event['type'] as string | undefined;
      const subtype = event['subtype'] as string | undefined;

      if (!type) return null;

      switch (type) {
        case 'system':
          return {
            activity: 'AI session initialized',
            category: 'SETUP',
            icon: 'settings',
            rawContent: line,
            suggestedPercent: 28,
          };

        case 'assistant':
          if (subtype === 'thinking') {
            const content = (event['content'] as string) ?? '';
            return {
              activity: 'AI is thinking',
              detail: content.substring(0, 100) || undefined,
              rawContent: content || line,
              category: 'AI_THINKING',
              icon: 'brain',
              suggestedPercent: 35,
            };
          }
          if (subtype === 'text') {
            const textContent = (event['content'] as string) ?? '';
            return {
              activity: 'AI is writing response',
              detail: textContent.substring(0, 100) || undefined,
              rawContent: textContent || line,
              category: 'AI_CODING',
              icon: 'code',
              suggestedPercent: 50,
            };
          }
          return null;

        case 'tool_use': {
          const toolName = (event['name'] as string) ?? '';
          const input = (event['input'] as Record<string, unknown>) ?? {};
          const toolActivity = this.toolUseToActivity(toolName, input);
          // Attach the full JSON line as rawContent for drill-down
          toolActivity.rawContent = line;
          return toolActivity;
        }

        case 'tool_result': {
          const resultToolName = (event['name'] as string) ?? '';
          const resultContent = (event['content'] as string) ?? '';
          if (resultToolName === 'Bash') {
            // Check for npm/git/build patterns in bash output
            const lower = resultContent.toLowerCase();
            if (lower.includes('added') && lower.includes('packages')) {
              const pkgs = resultContent.match(/added\s+(\d+)\s+packages?/i);
              return {
                activity: 'Dependencies installed',
                detail: pkgs ? `${pkgs[1]} packages` : undefined,
                rawContent: resultContent || line,
                category: 'DEPENDENCY',
                icon: 'package',
                suggestedPercent: 20,
              };
            }
          }
          // Capture all tool_result events (not just Bash) for drill-down visibility
          if (resultContent || event['error']) {
            const isError = !!event['error'] || resultContent.toLowerCase().includes('error');
            return {
              activity: isError
                ? 'Error encountered'
                : `Tool result: ${resultToolName || 'unknown'}`,
              detail:
                (resultContent || String(event['error'] ?? '')).substring(0, 120) || undefined,
              rawContent: line,
              category: isError ? 'ERROR' : 'SYSTEM',
              icon: isError ? 'alert-triangle' : 'terminal',
            };
          }
          return null;
        }

        case 'result':
          return {
            activity: subtype === 'success' ? 'AI completed task' : 'AI execution finished',
            detail: event['cost_usd'] ? `Cost: $${event['cost_usd']}` : undefined,
            rawContent: line,
            category: 'SYSTEM',
            icon: 'check-circle',
            suggestedPercent: 95,
          };

        default:
          return null;
      }
    } catch {
      // Not valid JSON — fall through to regex parser
      return null;
    }
  }

  /**
   * Convert a Claude tool_use event into a PM-friendly activity
   */
  private toolUseToActivity(toolName: string, input: Record<string, unknown>): ContainerActivity {
    switch (toolName) {
      case 'Read':
        return {
          activity: 'AI is reading file',
          detail: (input['file_path'] as string) ?? undefined,
          category: 'AI_THINKING',
          icon: 'file-edit',
          suggestedPercent: 40,
        };

      case 'Write':
        return {
          activity: 'AI is writing file',
          detail: (input['file_path'] as string) ?? undefined,
          category: 'AI_CODING',
          icon: 'code',
          suggestedPercent: 55,
        };

      case 'Edit':
        return {
          activity: 'AI is editing file',
          detail: (input['file_path'] as string) ?? undefined,
          category: 'AI_CODING',
          icon: 'file-edit',
          suggestedPercent: 55,
        };

      case 'Bash': {
        const cmd = (input['command'] as string) ?? '';
        const shortCmd = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
        // Categorize common bash commands
        if (/npm\s+(install|i|ci)\b/.test(cmd) || /pnpm\s+(install|i|add)\b/.test(cmd)) {
          return {
            activity: 'Installing dependencies',
            detail: shortCmd,
            category: 'DEPENDENCY',
            icon: 'package',
            suggestedPercent: 18,
          };
        }
        if (/git\s+(commit|push|pull|clone|checkout)\b/.test(cmd)) {
          return {
            activity: 'Running git command',
            detail: shortCmd,
            category: 'GIT',
            icon: 'git-branch',
            suggestedPercent: 80,
          };
        }
        if (/\b(jest|vitest|mocha|pytest|cargo\s+test)\b/.test(cmd)) {
          return {
            activity: 'Running tests',
            detail: shortCmd,
            category: 'TEST',
            icon: 'test-tube-2',
            suggestedPercent: 75,
          };
        }
        if (/\b(eslint|prettier|biome|lint)\b/.test(cmd)) {
          return {
            activity: 'Running linter',
            detail: shortCmd,
            category: 'LINT',
            icon: 'check-circle',
            suggestedPercent: 70,
          };
        }
        if (/\b(tsc|webpack|vite|rollup|esbuild|next\s+build|prisma\s+generate)\b/.test(cmd)) {
          return {
            activity: 'Building project',
            detail: shortCmd,
            category: 'BUILD',
            icon: 'hammer',
            suggestedPercent: 65,
          };
        }
        return {
          activity: 'Running command',
          detail: shortCmd,
          category: 'SYSTEM',
          icon: 'terminal',
          suggestedPercent: 60,
        };
      }

      case 'MultiEdit':
        return {
          activity: 'AI is editing multiple files',
          category: 'AI_CODING',
          icon: 'code',
          suggestedPercent: 55,
        };

      case 'TodoRead':
      case 'TodoWrite':
        return {
          activity: 'AI is managing task list',
          category: 'AI_THINKING',
          icon: 'brain',
        };

      default:
        return {
          activity: `AI is using tool: ${toolName}`,
          category: 'AI_CODING',
          icon: 'code',
          suggestedPercent: 45,
        };
    }
  }

  /**
   * Map rich activity categories to legacy ExecutionStage enums
   * for backward compatibility with existing progress listeners
   */
  private emitLegacyStageIfApplicable(
    executionId: string,
    ticketId: string,
    category: string,
  ): void {
    const categoryToStage: Record<string, ExecutionStage> = {
      AI_THINKING: ExecutionStage.AI_PLANNING,
      AI_CODING: ExecutionStage.AI_WRITING_CODE,
      TEST: ExecutionStage.AI_VERIFICATION,
      LINT: ExecutionStage.AI_VERIFICATION,
    };

    const stage = Object.prototype.hasOwnProperty.call(categoryToStage, category)
      ? categoryToStage[category as keyof typeof categoryToStage]
      : undefined;
    if (stage) {
      this.emitStageProgress(executionId, ticketId, stage).catch(() => {});
    }
  }

  private parseError(error: unknown): IAIExecutionError {
    // If error is already an IAIExecutionError object (e.g., thrown by WorkspaceService.createError),
    // return it directly instead of serializing to "[object Object]"
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      'code' in error &&
      typeof (error as IAIExecutionError).message === 'string'
    ) {
      return error as IAIExecutionError;
    }

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
