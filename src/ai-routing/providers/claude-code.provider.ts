/**
 * Claude Code Provider
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 *
 * SECONDARY AI provider using Anthropic's Claude API with tool use.
 * Optimized for simple-to-medium complexity tasks.
 *
 * Architecture Reference: ADR-006 (Claude Code as Secondary Provider)
 * FR65: Execute AI code generation
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import Anthropic from '@anthropic-ai/sdk';
import {
  ContentBlock,
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import * as fs from 'fs/promises';
import * as path from 'path';
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
import {
  codeEditingTools,
  ReadFileInput,
  WriteFileInput,
  EditFileInput,
  ListFilesInput,
  DeleteFileInput,
  ToolResult,
} from './anthropic-tools';

@Injectable()
export class ClaudeCodeProvider implements IAIProvider, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaudeCodeProvider.name);

  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxConcurrent: number = 20;
  readonly defaultTimeoutMs: number = 120_000; // 2 minutes

  /** Anthropic client */
  private client: Anthropic | null = null;

  /** Active executions tracking */
  private readonly activeExecutions: Map<string, AbortController> = new Map();

  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;

  /** Configuration */
  private model: string = 'claude-sonnet-4-20250514';
  private maxTokens: number = 8000;
  private timeoutMs: number = 120_000;
  private isConfigured: boolean = false;

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
      resetTimeoutMs: 60_000, // 1 minute (longer for API)
      successThreshold: 2,
    });
  }

  async onModuleInit(): Promise<void> {
    const apiKey = this.config.get<string>('anthropic.apiKey');
    this.model = this.config.get<string>('anthropic.model') || 'claude-sonnet-4-20250514';
    this.maxTokens = this.config.get<number>('anthropic.maxTokens') || 8000;
    this.timeoutMs = this.config.get<number>('anthropic.timeoutMs') || 120_000;

    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured - Claude provider disabled');
      this.isConfigured = false;
      return;
    }

    try {
      this.client = new Anthropic({ apiKey });
      this.isConfigured = true;

      this.logger.log(
        `Claude Code Provider initialized: model=${this.model}, ` +
          `maxTokens=${this.maxTokens}, timeout=${this.timeoutMs}ms`,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize Anthropic client: ${errorMessage}`);
      this.isConfigured = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Cancel all active executions on shutdown
    for (const [executionId, controller] of this.activeExecutions) {
      this.logger.log(`Cancelling execution ${executionId} on module destroy`);
      controller.abort();
    }
    this.activeExecutions.clear();
  }

  /**
   * Execute AI code generation using Claude API
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

    const timeout = timeoutMs || this.timeoutMs;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] Starting Claude execution for ticket ${ticketId}`);

    // Check if provider is configured
    if (!this.isConfigured || !this.client) {
      return this.createFailedResult(startTime, '', {
        code: AIErrorCode.CLI_NOT_FOUND,
        message: 'Claude provider not configured - ANTHROPIC_API_KEY missing',
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
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    try {
      // 1. Create workspace (reuse from Story 2.6)
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

      // 3. Load context files
      const contextContent = await this.loadContextFiles(workspacePath, targetFiles);

      // 4. Build the prompt with context
      const fullPrompt = this.buildPrompt(prompt, contextContent);

      // 5. Execute Claude API with tool use loop
      const result = await this.executeWithTools(
        workspacePath,
        fullPrompt,
        timeout,
        abortController.signal,
      );

      // 6. Extract changes from workspace
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);

      // 7. Calculate confidence score
      const confidenceScore = this.calculateConfidence(filesChanged, result.toolCalls);

      // 8. Check if any changes were made
      if (filesChanged.length === 0) {
        this.circuitBreaker.recordFailure();
        return this.createFailedResult(startTime, workspacePath, {
          code: AIErrorCode.NO_CHANGES,
          message: 'Claude completed but no changes were generated',
          isRetryable: true,
          rawOutput: result.finalResponse,
        });
      }

      // Success!
      this.circuitBreaker.recordSuccess();
      this.executionsCounter.inc({ status: 'success' });
      this.workspace.updateWorkspaceStatus(executionId, 'COMPLETED');

      // Track costs
      this.trackCost(result.inputTokens, result.outputTokens);

      const durationMs = Date.now() - startTime;
      this.durationHistogram.observe({ status: 'success' }, durationMs / 1000);

      this.logger.log(
        `[${correlationId}] Claude execution completed: ${filesChanged.length} files, ` +
          `${result.inputTokens} input tokens, ${result.outputTokens} output tokens, ${durationMs}ms`,
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
      this.logger.error(`[${correlationId}] Claude execution failed: ${errorMessage}`);

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
      isHealthy: this.isConfigured && circuitStatus.state === CircuitState.CLOSED,
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
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      this.logger.log(`[${executionId}] Execution cancelled`);
    }

    // Cleanup workspace
    await this.workspace.cleanupWorkspace(executionId, true);
  }

  /**
   * Execute Claude with tool use loop
   */
  private async executeWithTools(
    workspacePath: string,
    prompt: string,
    timeout: number,
    signal: AbortSignal,
  ): Promise<{
    finalResponse: string;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCalls = 0;
    let finalResponse = '';
    const maxIterations = 10; // Prevent infinite loops

    // Create timeout with cleanup to prevent memory leak
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timed out')), timeout);
    });

    try {
    for (let i = 0; i < maxIterations; i++) {
      // Check for cancellation
      if (signal.aborted) {
        throw new Error('Execution cancelled');
      }

      // Call Claude API with timeout
      const response = await Promise.race([
        this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          tools: codeEditingTools,
          messages,
        }),
        timeoutPromise,
      ]);

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        // Claude is done - extract text response
        finalResponse = this.extractTextContent(response.content);
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolResults: ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolCalls++;
            const result = await this.executeToolCall(workspacePath, block as ToolUseBlock);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.output,
              is_error: !result.success,
            });
          }
        }

        // Add assistant response and tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return {
      finalResponse,
      toolCalls,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Execute a single tool call with path traversal protection
   */
  private async executeToolCall(workspacePath: string, block: ToolUseBlock): Promise<ToolResult> {
    const { name, input } = block;

    try {
      switch (name) {
        case 'read_file': {
          const { path: filePath } = input as ReadFileInput;
          const fullPath = this.resolveSafePath(workspacePath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          return { success: true, output: content };
        }

        case 'write_file': {
          const { path: filePath, content } = input as WriteFileInput;
          const fullPath = this.resolveSafePath(workspacePath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf-8');
          return { success: true, output: `File written: ${filePath}` };
        }

        case 'edit_file': {
          const { path: filePath, old_content, new_content } = input as EditFileInput;
          const fullPath = this.resolveSafePath(workspacePath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          if (!content.includes(old_content)) {
            return {
              success: false,
              output: `Content not found in ${filePath}`,
              error: 'Content to replace not found',
            };
          }
          const newContent = content.replace(old_content, new_content);
          await fs.writeFile(fullPath, newContent, 'utf-8');
          return { success: true, output: `File edited: ${filePath}` };
        }

        case 'list_files': {
          const { path: dirPath = '.', recursive = false } = input as ListFilesInput;
          const fullPath = this.resolveSafePath(workspacePath, dirPath);
          const files = await this.listDirectory(fullPath, recursive);
          return { success: true, output: files.join('\n') };
        }

        case 'delete_file': {
          const { path: filePath } = input as DeleteFileInput;
          const fullPath = this.resolveSafePath(workspacePath, filePath);
          await fs.unlink(fullPath);
          return { success: true, output: `File deleted: ${filePath}` };
        }

        default:
          return {
            success: false,
            output: `Unknown tool: ${name}`,
            error: 'Tool not found',
          };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: `Error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Resolve and validate path to prevent path traversal attacks
   */
  private resolveSafePath(workspacePath: string, relativePath: string): string {
    // Normalize and resolve the path
    const resolved = path.resolve(workspacePath, relativePath);

    // Ensure the resolved path is within the workspace
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }

    return resolved;
  }

  /**
   * List directory contents
   */
  private async listDirectory(dirPath: string, recursive: boolean): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          recursive &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          entry.name !== 'dist'
        ) {
          const subFiles = await this.listDirectory(fullPath, true);
          files.push(...subFiles.map((f) => path.join(entry.name, f)));
        }
      } else {
        files.push(entry.name);
      }
    }

    return files;
  }

  /**
   * Load context files for the prompt
   */
  private async loadContextFiles(workspacePath: string, targetFiles?: string[]): Promise<string> {
    const files = targetFiles || [];
    const contextParts: string[] = [];

    // If no target files, try to find key files
    if (files.length === 0) {
      const keyFiles = ['package.json', 'tsconfig.json', 'README.md'];
      for (const file of keyFiles) {
        try {
          const content = await fs.readFile(path.join(workspacePath, file), 'utf-8');
          contextParts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          // File doesn't exist, skip
        }
      }
    } else {
      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(workspacePath, file), 'utf-8');
          contextParts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          contextParts.push(`### ${file}\n(File not found)`);
        }
      }
    }

    return contextParts.join('\n\n');
  }

  /**
   * Build the full prompt with context
   */
  private buildPrompt(taskPrompt: string, context: string): string {
    return `You are an expert software developer. Complete the following task by using the provided tools to read, create, and edit files.

## Workspace Context

${context}

## Task

${taskPrompt}

## Instructions

1. First, use read_file or list_files to understand the codebase structure
2. Plan your changes carefully
3. Use write_file to create new files
4. Use edit_file to modify existing files (provide exact content to replace)
5. Make all necessary changes to complete the task
6. Ensure code follows existing patterns and conventions`;
  }

  /**
   * Extract text content from Claude response
   */
  private extractTextContent(content: ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * Calculate confidence score based on execution metrics
   */
  private calculateConfidence(filesChanged: string[], toolCalls: number): number {
    let confidence = 0.5;

    // More tool calls = more thorough = higher confidence
    if (toolCalls > 0 && toolCalls <= 10) {
      confidence += 0.05 * toolCalls;
    } else if (toolCalls > 10) {
      confidence += 0.4;
    }

    // Files changed factor
    if (filesChanged.length > 0 && filesChanged.length <= 5) {
      confidence += 0.05 * filesChanged.length;
    }

    // Cap at 0.90 (Claude is secondary provider)
    return Math.min(confidence, 0.9);
  }

  /** Cumulative cost tracking */
  private cumulativeCostCents: number = 0;

  /**
   * Track cost in metrics
   */
  private trackCost(inputTokens: number, outputTokens: number): void {
    this.tokensCounter.inc({ type: 'input' }, inputTokens);
    this.tokensCounter.inc({ type: 'output' }, outputTokens);

    // Cost calculation: ~$3/1M input, ~$15/1M output
    const inputCost = (inputTokens / 1_000_000) * 300; // cents
    const outputCost = (outputTokens / 1_000_000) * 1500; // cents
    const executionCost = inputCost + outputCost;

    // Track cumulative cost (persists across executions)
    this.cumulativeCostCents += executionCost;

    // Set gauge to cumulative total for monitoring
    this.costGauge.set(this.cumulativeCostCents);
  }

  /**
   * Parse error into structured format
   */
  private parseError(error: unknown): IAIExecutionError {
    // Check for Anthropic-specific errors
    const apiError = error as { status?: number; message?: string };

    if (apiError.status === 429) {
      return {
        code: AIErrorCode.TIMEOUT,
        message: 'Rate limit exceeded - too many requests',
        isRetryable: true,
      };
    }

    if (apiError.status === 400) {
      return {
        code: AIErrorCode.INVALID_PROMPT,
        message: apiError.message || 'Invalid request',
        isRetryable: false,
      };
    }

    if (apiError.status === 401 || apiError.status === 403) {
      return {
        code: AIErrorCode.CLI_NOT_FOUND,
        message: 'Authentication failed - check API key',
        isRetryable: false,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      code: AIErrorCode.UNKNOWN,
      message: errorMessage,
      isRetryable: true,
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
