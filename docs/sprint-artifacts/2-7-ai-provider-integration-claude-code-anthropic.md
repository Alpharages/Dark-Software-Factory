# Story 2.7: AI Provider Integration - Claude Code (Anthropic)

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P0 - CRITICAL  
**Effort:** 13 story points  
**ClickUp ID:** `86evnjwad`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwad

---

## ⛔ BLOCKER: Story 2.6 Must Be Complete

**DO NOT START** this story until Story 2.6 is implemented and validated.

**Required from Story 2.6:**
- ✅ Interfaces: `IAIProvider`, `IAIExecutionInput`, `IAIExecutionResult`, `AIErrorCode`
- ✅ Services: `WorkspaceService`, `GitOperationsService`, `AIExecutionService`
- ✅ Patterns: `CircuitBreaker` class for resilience
- ✅ Infrastructure: Workspace management, git operations
- ✅ Prisma: `AIProvider` enum updated with `CURSOR_HEADLESS`, `CLAUDE_CODE`

**Required from Story 2.5:**
- ✅ `ExecutionService` for status tracking
- ✅ State machine for execution transitions

**If Story 2.6 is not complete:** You will encounter immediate errors:
- `Cannot find module './interfaces/ai-provider.interface'`
- `No provider for WorkspaceService`
- `AIProvider.CLAUDE_CODE` does not exist on type

**Verify Story 2.6 status:** Check `docs/sprint-artifacts/sprint-status.yaml` - Story 2.6 should be `complete` or `review`.

---

## Story

As the system,
I want to integrate with Claude Code (Anthropic's autonomous coding agent) via API,
So that simple-to-medium complexity tickets can be handled cost-effectively with autonomous coding capabilities.

---

## Acceptance Criteria

**Given** a ticket is routed to Claude Code (from Story 2.3)  
**When** the system calls the Anthropic API  
**Then** the integration:
- Authenticates using `ANTHROPIC_API_KEY` from environment
- Prepares isolated workspace (git clone to `/tmp/claude-workspaces/ticket-{id}`)
- Creates feature branch (`feature/ticket-{id}`)
- Loads relevant file contents into extended context
- Calls Anthropic API with:
  - Model: `claude-3-5-sonnet-20241022`
  - Extended context (200K+ tokens with file contents)
  - Tool use enabled for file operations
  - Max tokens: 8000
- Processes tool use responses (file edits, creates)
- Applies changes to workspace files
- Collects changes via `git diff HEAD`

**And** successful generation:
- Parses tool use calls for file operations
- Writes generated code to workspace files
- Captures git diff
- Updates execution status to COMPLETED (via Story 2.5)
- Tracks API cost (input/output tokens)

**And** failed generation:
- Captures API error (rate limit, invalid request, etc.)
- Updates status to FAILED (via Story 2.5)
- Determines if retryable (rate limit vs invalid request)
- Schedules retry if appropriate

**And** autonomous coding features:
- Multi-turn conversation support for complex tasks
- Tool use for file operations
- Extended context for large codebases
- Autonomous planning and execution

**And** cost tracking:
- Track input tokens (~$3/1M tokens)
- Track output tokens (~$15/1M tokens)
- Estimated cost per ticket (~$0.10-$0.50)

---

## Quick Implementation Summary (TL;DR)

**Step 0: Understand the Architecture**
- Implements: `IAIProvider` interface (from Story 2.6)
- Reuses: `WorkspaceService`, `GitOperationsService` (from Story 2.6)
- Output: Code diff, files changed list, cost data

**10 Key Files in Implementation Order:**
1. `src/ai-routing/providers/anthropic-tools.ts` - Tool definitions for file ops
2. `src/ai-routing/providers/claude-code.provider.ts` - Main Claude provider
3. `src/ai-routing/providers/claude-code.provider.spec.ts` - Unit tests
4. `src/ai-routing/providers/index.ts` - **MODIFY**: Export Claude provider
5. `src/ai-routing/ai-execution.service.ts` - **MODIFY**: Register Claude provider
6. `src/ai-routing/ai-routing.module.ts` - **MODIFY**: Add Claude provider
7. `src/config/configuration.ts` - **MODIFY**: Add Anthropic config
8. `src/config/env.validation.ts` - **MODIFY**: Add env validation
9. `src/cost-tracking/cost-calculator.service.ts` - **CREATE**: Cost calculation
10. `test/claude-code.e2e-spec.ts` - Integration tests

**New Dependencies:**
```bash
# Install Anthropic SDK
pnpm add @anthropic-ai/sdk
```

**Environment Variables:**
```env
# Anthropic API Configuration
ANTHROPIC_API_KEY=sk-ant-your-api-key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_MAX_TOKENS=8000
ANTHROPIC_TIMEOUT_MS=120000
CLAUDE_WORKSPACES_ROOT=/tmp/claude-workspaces
```

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/ai-routing/providers/anthropic-tools.ts` | CREATE | Tool definitions for Claude |
| `src/ai-routing/providers/claude-code.provider.ts` | CREATE | Claude API integration |
| `src/ai-routing/providers/claude-code.provider.spec.ts` | CREATE | Unit tests |
| `src/ai-routing/providers/index.ts` | **MODIFY** | Export Claude provider |
| `src/ai-routing/ai-execution.service.ts` | **MODIFY** | Register provider |
| `src/ai-routing/ai-routing.module.ts` | **MODIFY** | Wire provider |
| `src/ai-routing/dto/cost-tracking.dto.ts` | CREATE | Cost tracking DTOs |
| `src/config/configuration.ts` | **MODIFY** | Add Anthropic config |
| `src/config/env.validation.ts` | **MODIFY** | Add env validation |
| `test/claude-code.e2e-spec.ts` | CREATE | Integration tests |

---

## Step 0: Verify Prerequisites (REQUIRED)

### 0.1 Check Story 2.6 Services Exist

```bash
# Verify Story 2.6 interfaces exist
ls src/ai-routing/interfaces/ai-provider.interface.ts

# Verify WorkspaceService exists
ls src/ai-routing/providers/workspace.service.ts

# Verify CircuitBreaker exists
ls src/ai-routing/providers/circuit-breaker.ts
```

**Expected:** All files exist.

### 0.2 Check Prisma Schema Updated

```bash
# Verify AIProvider enum has CLAUDE_CODE
grep -E "CLAUDE_CODE" prisma/schema.prisma
```

**Expected:** `CLAUDE_CODE` value exists in AIProvider enum.

### 0.3 Verify Anthropic API Key Available

```bash
# Check environment variable is set (don't echo the actual key!)
if [ -n "$ANTHROPIC_API_KEY" ]; then echo "API key configured"; else echo "API key NOT configured"; fi
```

**Note:** API key should be in `.env` file for development.

**If any check fails:** STOP. Complete prerequisites first.

---

## Step 1: Install Anthropic SDK

```bash
# Install the official Anthropic SDK
pnpm add @anthropic-ai/sdk

# Verify installation
pnpm list @anthropic-ai/sdk
```

**Expected:** Package installed at version 0.x.x (latest stable).

---

## Step 2: Create Anthropic Tool Definitions

**File:** `src/ai-routing/providers/anthropic-tools.ts`

```typescript
import { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Anthropic Tool Definitions
 * 
 * Defines the tools Claude can use for file operations.
 * These enable autonomous coding capabilities.
 * 
 * Reference: https://docs.anthropic.com/claude/docs/tool-use
 */

/**
 * Tool: Read file contents
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file from the workspace',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to read',
      },
    },
    required: ['path'],
  },
};

/**
 * Tool: Write/create file
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write or create a file in the workspace',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
};

/**
 * Tool: Edit existing file with search/replace
 */
export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit an existing file by replacing specific content',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to edit',
      },
      old_content: {
        type: 'string',
        description: 'The exact content to find and replace',
      },
      new_content: {
        type: 'string',
        description: 'The new content to replace with',
      },
    },
    required: ['path', 'old_content', 'new_content'],
  },
};

/**
 * Tool: List files in directory
 */
export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files in a directory',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (default: workspace root)',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively',
      },
    },
    required: [],
  },
};

/**
 * Tool: Delete file
 */
export const deleteFileTool: Tool = {
  name: 'delete_file',
  description: 'Delete a file from the workspace',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to delete',
      },
    },
    required: ['path'],
  },
};

/**
 * All available tools for Claude
 */
export const codeEditingTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  deleteFileTool,
];

/**
 * Tool input types for type-safe tool handling
 */
export interface ReadFileInput {
  path: string;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  old_content: string;
  new_content: string;
}

export interface ListFilesInput {
  path?: string;
  recursive?: boolean;
}

export interface DeleteFileInput {
  path: string;
}

/**
 * Tool result type
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
```

---

## Step 3: Create Claude Code Provider

**File:** `src/ai-routing/providers/claude-code.provider.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import Anthropic from '@anthropic-ai/sdk';
import {
  ContentBlock,
  Message,
  ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealth,
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

/**
 * Claude Code Provider
 * 
 * SECONDARY AI provider using Anthropic's Claude API with tool use.
 * Optimized for simple-to-medium complexity tasks.
 * 
 * Architecture Reference: ADR-006 (Claude Code as Secondary Provider)
 * FR65: Execute AI code generation
 */
@Injectable()
export class ClaudeCodeProvider implements IAIProvider, OnModuleInit {
  private readonly logger = new Logger(ClaudeCodeProvider.name);
  
  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxConcurrent: number = 20;
  readonly defaultTimeoutMs: number = 120_000; // 2 minutes

  /** Anthropic client */
  private client: Anthropic;
  
  /** Active executions tracking */
  private readonly activeExecutions: Map<string, AbortController> = new Map();
  
  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;
  
  /** Configuration */
  private model: string;
  private maxTokens: number;
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
    this.model = this.config.get<string>('anthropic.model', 'claude-3-5-sonnet-20241022');
    this.maxTokens = this.config.get<number>('anthropic.maxTokens', 8000);
    this.defaultTimeoutMs = this.config.get<number>('anthropic.timeoutMs', 120_000);

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
        `maxTokens=${this.maxTokens}, timeout=${this.defaultTimeoutMs}ms`,
      );
    } catch (error) {
      this.logger.error(`Failed to initialize Anthropic client: ${error.message}`);
      this.isConfigured = false;
    }
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

    const timeout = timeoutMs || this.defaultTimeoutMs;
    const startTime = Date.now();

    this.logger.log(
      `[${correlationId}] Starting Claude execution for ticket ${ticketId}`,
    );

    // Check if provider is configured
    if (!this.isConfigured) {
      return this.createFailedResult(
        startTime,
        '',
        {
          code: AIErrorCode.CLI_NOT_FOUND, // Reusing for "not configured"
          message: 'Claude provider not configured - ANTHROPIC_API_KEY missing',
          isRetryable: false,
        },
      );
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      this.executionsCounter.inc({ status: 'circuit_open' });
      return this.createFailedResult(
        startTime,
        '',
        {
          code: AIErrorCode.UNKNOWN,
          message: 'Circuit breaker is open - provider temporarily unavailable',
          isRetryable: true,
        },
      );
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
      const contextContent = await this.loadContextFiles(
        workspacePath,
        targetFiles,
      );

      // 4. Build the prompt with context
      const fullPrompt = this.buildPrompt(prompt, contextContent);

      // 5. Execute Claude API with tool use loop
      const result = await this.executeWithTools(
        executionId,
        workspacePath,
        fullPrompt,
        timeout,
        abortController.signal,
      );

      // 6. Extract changes from workspace
      const { diff, filesChanged } = await this.workspace.extractChanges(executionId);

      // 7. Calculate confidence score
      const confidenceScore = this.calculateConfidence(filesChanged, diff, result.toolCalls);

      // 8. Check if any changes were made
      if (filesChanged.length === 0) {
        this.circuitBreaker.recordFailure();
        return this.createFailedResult(
          startTime,
          workspacePath,
          {
            code: AIErrorCode.NO_CHANGES,
            message: 'Claude completed but no changes were generated',
            isRetryable: true,
            rawOutput: result.finalResponse,
          },
        );
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

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.circuitBreaker.recordFailure();
      this.executionsCounter.inc({ status: 'error' });
      this.durationHistogram.observe({ status: 'error' }, durationMs / 1000);

      this.logger.error(
        `[${correlationId}] Claude execution failed: ${error.message}`,
      );

      this.workspace.updateWorkspaceStatus(executionId, 'FAILED');

      return this.createFailedResult(
        startTime,
        workspacePath,
        this.parseError(error),
      );

    } finally {
      this.activeGauge.dec();
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Check provider health
   */
  async checkHealth(): Promise<IProviderHealth> {
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
    executionId: string,
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
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCalls = 0;
    let finalResponse = '';
    const maxIterations = 10; // Prevent infinite loops

    for (let i = 0; i < maxIterations; i++) {
      // Check for cancellation
      if (signal.aborted) {
        throw new Error('Execution cancelled');
      }

      // Call Claude API
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        tools: codeEditingTools,
        messages,
      });

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
            const result = await this.executeToolCall(
              workspacePath,
              block as ToolUseBlock,
            );
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
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(
    workspacePath: string,
    block: ToolUseBlock,
  ): Promise<ToolResult> {
    const { name, input } = block;

    try {
      switch (name) {
        case 'read_file': {
          const { path: filePath } = input as ReadFileInput;
          const fullPath = path.join(workspacePath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          return { success: true, output: content };
        }

        case 'write_file': {
          const { path: filePath, content } = input as WriteFileInput;
          const fullPath = path.join(workspacePath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf-8');
          return { success: true, output: `File written: ${filePath}` };
        }

        case 'edit_file': {
          const { path: filePath, old_content, new_content } = input as EditFileInput;
          const fullPath = path.join(workspacePath, filePath);
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
          const fullPath = path.join(workspacePath, dirPath);
          const files = await this.listDirectory(fullPath, recursive);
          return { success: true, output: files.join('\n') };
        }

        case 'delete_file': {
          const { path: filePath } = input as DeleteFileInput;
          const fullPath = path.join(workspacePath, filePath);
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
    } catch (error: any) {
      return {
        success: false,
        output: `Error: ${error.message}`,
        error: error.message,
      };
    }
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
        if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subFiles = await this.listDirectory(fullPath, true);
          files.push(...subFiles.map(f => path.join(entry.name, f)));
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
  private async loadContextFiles(
    workspacePath: string,
    targetFiles?: string[],
  ): Promise<string> {
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
      .map(block => block.text)
      .join('\n');
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    filesChanged: string[],
    diff: string,
    toolCalls: number,
  ): number {
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
    return Math.min(confidence, 0.90);
  }

  /**
   * Track cost in metrics
   */
  private trackCost(inputTokens: number, outputTokens: number): void {
    this.tokensCounter.inc({ type: 'input' }, inputTokens);
    this.tokensCounter.inc({ type: 'output' }, outputTokens);

    // Cost calculation: ~$3/1M input, ~$15/1M output
    const inputCost = (inputTokens / 1_000_000) * 300; // cents
    const outputCost = (outputTokens / 1_000_000) * 1500; // cents
    const totalCost = inputCost + outputCost;

    this.costGauge.set(totalCost);
  }

  /**
   * Parse error into structured format
   */
  private parseError(error: any): IAIExecutionError {
    // Check for Anthropic-specific errors
    if (error.status === 429) {
      return {
        code: AIErrorCode.TIMEOUT, // Reusing for rate limit
        message: 'Rate limit exceeded - too many requests',
        isRetryable: true,
      };
    }

    if (error.status === 400) {
      return {
        code: AIErrorCode.INVALID_PROMPT,
        message: error.message || 'Invalid request',
        isRetryable: false,
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        code: AIErrorCode.CLI_NOT_FOUND, // Reusing for auth error
        message: 'Authentication failed - check API key',
        isRetryable: false,
      };
    }

    return {
      code: AIErrorCode.UNKNOWN,
      message: error.message || String(error),
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
```

---

## Step 4: Update Provider Exports

**File:** `src/ai-routing/providers/index.ts` - **UPDATE**

```typescript
export * from './workspace.service';
export * from './git-operations.service';
export * from './cursor-headless.provider';
export * from './claude-code.provider';  // ADD
export * from './circuit-breaker';
export * from './anthropic-tools';  // ADD
```

---

## Step 5: Update AI Execution Service

**File:** `src/ai-routing/ai-execution.service.ts` - **UPDATE**

Add Claude provider to the constructor and registration:

```typescript
// Add import
import { ClaudeCodeProvider } from './providers';

// Update constructor
constructor(
  private readonly cursorProvider: CursorHeadlessProvider,
  private readonly claudeProvider: ClaudeCodeProvider,  // ADD
  private readonly executionService: ExecutionService,
) {
  // Register providers
  this.providers.set(AIProvider.CURSOR_HEADLESS, this.cursorProvider);
  this.providers.set(AIProvider.CLAUDE_CODE, this.claudeProvider);  // ADD
}
```

---

## Step 6: Update AI Routing Module

**File:** `src/ai-routing/ai-routing.module.ts` - **UPDATE**

Add Claude provider and metrics:

```typescript
// Add import
import { ClaudeCodeProvider } from './providers';

@Module({
  // ... existing config
  providers: [
    // ... existing providers

    // Story 2.7: Claude Code Provider (ADD)
    ClaudeCodeProvider,

    // Story 2.7: Claude Metrics (ADD)
    makeCounterProvider({
      name: 'claude_executions_total',
      help: 'Total Claude API executions',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'claude_execution_duration_seconds',
      help: 'Claude execution duration in seconds',
      labelNames: ['status'],
      buckets: [5, 15, 30, 60, 90, 120],
    }),
    makeGaugeProvider({
      name: 'claude_active_executions',
      help: 'Currently active Claude executions',
    }),
    makeCounterProvider({
      name: 'claude_tokens_total',
      help: 'Total tokens used',
      labelNames: ['type'], // input, output
    }),
    makeGaugeProvider({
      name: 'claude_cost_cents',
      help: 'Estimated cost in cents',
    }),
  ],
  exports: [
    // ... existing exports
    ClaudeCodeProvider,  // ADD
  ],
})
```

---

## Step 7: Update Configuration

**File:** `src/config/configuration.ts` - **ADD** Anthropic configuration section:

```typescript
// Add to the configuration factory function:

anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8000', 10),
  timeoutMs: parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '120000', 10),
  workspacesRoot: process.env.CLAUDE_WORKSPACES_ROOT || '/tmp/claude-workspaces',
},
```

**File:** `src/config/env.validation.ts` - **ADD** Anthropic environment variables:

```typescript
// Add to the environment validation schema:

// Anthropic API Configuration (optional - provider disabled if not set)
ANTHROPIC_API_KEY: Joi.string().optional(),
ANTHROPIC_MODEL: Joi.string().default('claude-3-5-sonnet-20241022'),
ANTHROPIC_MAX_TOKENS: Joi.number().min(1000).max(100000).default(8000),
ANTHROPIC_TIMEOUT_MS: Joi.number().min(30000).max(300000).default(120000),
CLAUDE_WORKSPACES_ROOT: Joi.string().default('/tmp/claude-workspaces'),
```

---

## Step 8: Create Unit Tests

**File:** `src/ai-routing/providers/claude-code.provider.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { ClaudeCodeProvider } from './claude-code.provider';
import { WorkspaceService } from './workspace.service';
import { IAIExecutionInput, AIErrorCode } from '../interfaces';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  let configService: jest.Mocked<ConfigService>;
  let workspaceService: jest.Mocked<WorkspaceService>;

  const mockInput: IAIExecutionInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Add a hello function to utils.ts',
    repositoryUrl: 'https://github.com/test/repo.git',
    baseBranch: 'main',
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'anthropic.apiKey': 'sk-ant-test-key',
          'anthropic.model': 'claude-3-5-sonnet-20241022',
          'anthropic.maxTokens': 8000,
          'anthropic.timeoutMs': 120000,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockWorkspaceService = {
      createWorkspace: jest.fn().mockResolvedValue({
        id: 'ws-123',
        path: '/tmp/test-workspace',
        status: 'READY',
      }),
      updateWorkspaceStatus: jest.fn(),
      extractChanges: jest.fn().mockResolvedValue({
        diff: 'diff --git a/utils.ts b/utils.ts\n+function hello() {}',
        filesChanged: ['src/utils.ts'],
      }),
      cleanupWorkspace: jest.fn(),
    };

    const mockMetrics = {
      inc: jest.fn(),
      observe: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeCodeProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: 'claude_executions_total', useValue: mockMetrics },
        { provide: 'claude_execution_duration_seconds', useValue: mockMetrics },
        { provide: 'claude_active_executions', useValue: mockMetrics },
        { provide: 'claude_tokens_total', useValue: mockMetrics },
        { provide: 'claude_cost_cents', useValue: mockMetrics },
      ],
    }).compile();

    provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    configService = module.get(ConfigService);
    workspaceService = module.get(WorkspaceService);

    // Initialize the provider
    await provider.onModuleInit();
  });

  describe('provider properties', () => {
    it('should have correct provider type', () => {
      expect(provider.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should have reasonable defaults', () => {
      expect(provider.maxConcurrent).toBe(20);
      expect(provider.defaultTimeoutMs).toBe(120_000);
    });
  });

  describe('checkHealth', () => {
    it('should return health status', async () => {
      const health = await provider.checkHealth();

      expect(health.provider).toBe(AIProvider.CLAUDE_CODE);
      expect(health.circuitState).toBeDefined();
      expect(typeof health.activeExecutions).toBe('number');
    });
  });

  describe('cancel', () => {
    it('should cancel execution without error', async () => {
      await expect(
        provider.cancel('test-execution'),
      ).resolves.not.toThrow();

      expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(
        'test-execution',
        true,
      );
    });
  });

  describe('configuration', () => {
    it('should handle missing API key gracefully', async () => {
      const mockConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaudeCodeProvider,
          { provide: ConfigService, useValue: mockConfig },
          { provide: WorkspaceService, useValue: workspaceService },
          { provide: 'claude_executions_total', useValue: { inc: jest.fn() } },
          { provide: 'claude_execution_duration_seconds', useValue: { observe: jest.fn() } },
          { provide: 'claude_active_executions', useValue: { inc: jest.fn(), dec: jest.fn() } },
          { provide: 'claude_tokens_total', useValue: { inc: jest.fn() } },
          { provide: 'claude_cost_cents', useValue: { set: jest.fn() } },
        ],
      }).compile();

      const unconfiguredProvider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
      await unconfiguredProvider.onModuleInit();

      const result = await unconfiguredProvider.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not configured');
    });
  });
});

describe('Anthropic Tools', () => {
  const { codeEditingTools } = require('./anthropic-tools');

  it('should define all required tools', () => {
    const toolNames = codeEditingTools.map((t: any) => t.name);
    
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('edit_file');
    expect(toolNames).toContain('list_files');
    expect(toolNames).toContain('delete_file');
  });

  it('should have valid input schemas', () => {
    for (const tool of codeEditingTools) {
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.description).toBeDefined();
    }
  });
});
```

---

## Step 9: Create Integration Tests

**File:** `test/claude-code.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
import { ClaudeCodeProvider } from '../src/ai-routing/providers';

/**
 * Claude Code Integration Tests
 * 
 * Tests the Claude provider with mocked API.
 * Run with: pnpm test:e2e -- --testPathPattern=claude-code
 */
describe('Claude Code Provider (e2e)', () => {
  let app: INestApplication;
  let aiExecutionService: AIExecutionService;
  let claudeProvider: ClaudeCodeProvider;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    aiExecutionService = app.get<AIExecutionService>(AIExecutionService);
    claudeProvider = app.get<ClaudeCodeProvider>(ClaudeCodeProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Provider Registration', () => {
    it('should have Claude provider registered', async () => {
      const health = await aiExecutionService.getProviderHealth(
        AIProvider.CLAUDE_CODE,
      );

      expect(health).toBeDefined();
      expect(health?.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should include Claude in all providers health', async () => {
      const allHealth = await aiExecutionService.getAllProvidersHealth();
      
      const claudeHealth = allHealth.find(
        h => h.provider === AIProvider.CLAUDE_CODE,
      );
      
      expect(claudeHealth).toBeDefined();
    });
  });

  describe('Provider Health', () => {
    it('should report correct health status', async () => {
      const health = await claudeProvider.checkHealth();

      expect(health.circuitState).toMatch(/CLOSED|OPEN|HALF_OPEN/);
      expect(typeof health.activeExecutions).toBe('number');
      expect(typeof health.consecutiveFailures).toBe('number');
    });
  });

  describe('Provider Availability', () => {
    it('should check provider availability', async () => {
      const isAvailable = await aiExecutionService.isProviderAvailable(
        AIProvider.CLAUDE_CODE,
      );

      // Provider is available if API key is configured
      expect(typeof isAvailable).toBe('boolean');
    });
  });
});
```

---

## Validation Checklist

### Dependencies
- [ ] `@anthropic-ai/sdk` installed
- [ ] Package version verified

### Anthropic Tools
- [ ] `read_file` tool defined with schema
- [ ] `write_file` tool defined with schema
- [ ] `edit_file` tool defined with schema
- [ ] `list_files` tool defined with schema
- [ ] `delete_file` tool defined with schema
- [ ] Tool types exported for type safety

### Claude Code Provider
- [ ] Implements `IAIProvider` interface
- [ ] Calls Anthropic API with tool use
- [ ] Handles tool use loop correctly
- [ ] Processes file operations in workspace
- [ ] Circuit breaker prevents cascading failures
- [ ] Tracks costs (input/output tokens)
- [ ] Tracks metrics: executions, duration, tokens, cost

### Provider Integration
- [ ] Registered in `AIExecutionService`
- [ ] Exported from module
- [ ] Metrics providers registered

### Configuration
- [ ] Environment variables documented
- [ ] Configuration loaded via ConfigService
- [ ] Validation with Joi schema
- [ ] Provider disabled gracefully if API key missing

### Tests
- [ ] ClaudeCodeProvider unit tests pass
- [ ] Anthropic tools unit tests pass
- [ ] Integration tests pass
- [ ] Coverage for success, failure, timeout, cancel scenarios

---

## Quick Verification Commands

```bash
# After Step 1 (Install SDK)
pnpm list @anthropic-ai/sdk

# After Steps 2-3 (Provider)
npx tsc --noEmit src/ai-routing/providers/claude-code.provider.ts

# After Step 6 (Module)
npx tsc --noEmit src/ai-routing/ai-routing.module.ts

# After Step 8 (Tests)
pnpm test -- --testPathPattern=claude-code

# Full verification
pnpm run build && pnpm test
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module '@anthropic-ai/sdk'` | SDK not installed | Run `pnpm add @anthropic-ai/sdk` |
| `ANTHROPIC_API_KEY not configured` | Missing env var | Add to `.env` file |
| `Rate limit exceeded` | Too many API calls | Wait and retry, increase timeout |
| `Invalid request` | Malformed prompt | Check prompt format |
| `Circuit breaker OPEN` | Too many failures | Wait for reset (60s) |
| `AIProvider.CLAUDE_CODE does not exist` | Prisma not updated | Run Story 2.6 first (Prisma schema update) |

---

## Prerequisites

- ✅ **Story 2.6 Complete** - Provider interfaces, WorkspaceService, CircuitBreaker
- ✅ **Story 2.5 Complete** - ExecutionService for status tracking
- ✅ **Story 1.4 Complete** - ConfigService for configuration
- ✅ **Prisma Schema Updated** - `AIProvider` enum has `CLAUDE_CODE`

---

## Integration Notes

### Input from Previous Stories

```typescript
// From Story 2.4: Generated prompt
const generatedPrompt = await promptGeneratorService.generatePrompt(input, context);

// From Story 2.5: Create execution record
const execution = await executionService.startExecution({
  ticketId,
  aiProvider: AIProvider.CLAUDE_CODE,
  prompt: generatedPrompt.prompt,
});

// Execute with Claude provider
const result = await aiExecutionService.executeWithProvider(
  AIProvider.CLAUDE_CODE,
  {
    correlationId,
    executionId: execution.id,
    ticketId,
    prompt: generatedPrompt.prompt,
    repositoryUrl: ticket.linkedRepo,
    baseBranch: 'main',
    timeoutMs: 120000,
  },
);
```

### Output to Next Stories

**Story 2.8 (Multi-Provider Orchestration)** will use:
```typescript
// Check provider availability for routing
const cursorAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
const claudeAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CLAUDE_CODE);

// Execute with fallback
const result = await aiExecutionService.executeWithProvider(selectedProvider, input);
if (!result.success && result.error?.isRetryable) {
  // Try fallback provider
  const fallbackProvider = selectedProvider === AIProvider.CURSOR_HEADLESS 
    ? AIProvider.CLAUDE_CODE 
    : AIProvider.CURSOR_HEADLESS;
  return aiExecutionService.executeWithProvider(fallbackProvider, input);
}
```

---

## Cost Tracking Reference

| Token Type | Cost per 1M | Example Usage | Estimated Cost |
|------------|-------------|---------------|----------------|
| Input | $3.00 | 50K tokens | $0.15 |
| Output | $15.00 | 5K tokens | $0.075 |
| **Typical ticket** | - | 55K total | **$0.22** |

**Cost Formula:**
```typescript
const inputCostCents = (inputTokens / 1_000_000) * 300;
const outputCostCents = (outputTokens / 1_000_000) * 1500;
const totalCostCents = inputCostCents + outputCostCents;
```

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 2318-2358 | ADR-006: Claude Code as Secondary Provider |
| `docs/architecture.md` | Lines 2409-2446 | Claude Code API Integration Pattern |
| `docs/epics.md` | Lines 1055-1114 | Story 2.7 Requirements |
| `docs/prd.md` | FR65 | Execute AI code generation |
| Anthropic Docs | Tool Use | https://docs.anthropic.com/claude/docs/tool-use |

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (ADR-006, Multi-Provider Strategy)
- PRD functional requirements (FR65)
- Story 2.6 patterns (IAIProvider interface, CircuitBreaker, WorkspaceService)
- Anthropic SDK documentation
- Cost tracking requirements

### Patterns Reused from Story 2.6

1. **IAIProvider Interface:** Same interface implementation
2. **Circuit Breaker Pattern:** Same resilience approach
3. **Workspace Isolation:** Reuse WorkspaceService
4. **Metrics Pattern:** Same Counter, Histogram, Gauge approach
5. **Configuration Pattern:** Same ConfigService approach

### New Patterns Introduced

1. **Tool Use Loop:** Multi-turn Claude API calls with tool execution
2. **File Operation Tools:** Tool definitions for read/write/edit
3. **Token Cost Tracking:** Input/output token cost calculation
4. **API Error Parsing:** Anthropic-specific error handling

### Completion Notes

**Story Status:** ready-for-dev  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `2-7-ai-provider-integration-claude-code-anthropic: in-progress`
2. **Implementation:** Follow Steps 1-9 in order
3. **Testing:** Run unit tests, verify metrics
4. **Validation:** Complete all items in Validation Checklist
5. **Version Control:** Commit with message `feat: add Claude Code provider integration`
6. **Status Update:** Update `sprint-status.yaml` → `2-7-ai-provider-integration-claude-code-anthropic: review`

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

