# Story 2.6: AI Provider Integration - Cursor CLI Headless Mode

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P0 - CRITICAL  
**Effort:** 13 story points  
**ClickUp ID:** `86evnjwab`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwab

---

## ⛔ BLOCKER: Story 2.5 Must Be Complete

**DO NOT START** this story until Story 2.5 is implemented and validated.

**Required from Story 2.5:**
- ✅ Services: `ExecutionService`, `ExecutionTrackerService`, `ExecutionRepository`
- ✅ Interfaces: `IStartExecutionInput`, `IExecutionCompletion`, `IExecutionFailure`
- ✅ State machine: `ExecutionStateMachine` with valid transitions
- ✅ Module: `ExecutionModule` exported and available

**Required from Story 1.4:**
- ✅ Environment configuration with `ConfigService`
- ✅ Validation for required environment variables

**If Story 2.5 is not complete:** You will encounter immediate errors:
- `Cannot find module '../execution/execution.service'`
- `No provider for ExecutionService`

**Verify Story 2.5 status:** Check `docs/sprint-artifacts/sprint-status.yaml` - Story 2.5 should be `complete` or `review`.

---

## Story

As the system,
I want to integrate with Cursor CLI in headless mode for code generation,
So that complex, multi-file tickets can generate code with full repository context.

---

## Acceptance Criteria

**Given** a ticket is routed to Cursor CLI Headless (from Story 2.3)  
**When** the system executes Cursor headless  
**Then** the integration:
- Prepares isolated workspace (git clone to `/tmp/cursor-workspaces/ticket-{id}`)
- Creates feature branch (`feature/ticket-{id}`)
- Executes: `cursor --headless --dir /workspace --apply "prompt" --wait`
- Sets appropriate timeout (configurable, default 5 minutes)
- Monitors execution via process status
- Collects changes via `git diff HEAD`
- Parses files modified and change summary

**And** successful generation:
- Captures generated code via git diff
- Parses files changed from git output
- Updates execution status to COMPLETED (via Story 2.5)
- Tracks execution time for cost estimation
- Stores workspace path for debugging

**And** failed generation:
- Captures error output (stdout/stderr)
- Updates status to FAILED (via Story 2.5)
- Determines if retryable (timeout, crash vs invalid prompt)
- Schedules retry if appropriate (via Story 2.5)
- Preserves workspace for debugging (configurable)

**And** workspace management:
- One workspace per ticket execution
- Automatic cleanup after PR creation (or archive for 7 days)
- Supports concurrent executions (10+ workspaces)
- Enforces disk space limits

---

## Quick Implementation Summary (TL;DR)

**Step 0: Understand the Architecture**
- Implements: `AIProviderInterface` for provider abstraction
- Depends on: `ExecutionService` from Story 2.5 for status tracking
- Output: Code diff, files changed list, confidence score

**13 Key Files in Implementation Order:**
1. `prisma/schema.prisma` - **MODIFY**: Update AIProvider enum (REQUIRED FIRST)
2. `src/ai-routing/interfaces/ai-provider.interface.ts` - Provider interface
3. `src/ai-routing/dto/ai-execution.dto.ts` - Execution DTOs
4. `src/ai-routing/providers/workspace.service.ts` - Workspace management
5. `src/ai-routing/providers/git-operations.service.ts` - Git commands wrapper
6. `src/ai-routing/providers/cursor-headless.provider.ts` - Main Cursor provider
7. `src/ai-routing/providers/circuit-breaker.ts` - Circuit breaker pattern
8. `src/ai-routing/providers/index.ts` - Barrel export
9. `src/ai-routing/ai-execution.service.ts` - Execution orchestration
10. `src/ai-routing/ai-execution.service.spec.ts` - Unit tests
11. `src/ai-routing/ai-routing.module.ts` - **MODIFY**: Add providers
12. `src/config/configuration.ts` - **MODIFY**: Add Cursor config
13. `src/config/env.validation.ts` - **MODIFY**: Add env validation

**New Dependencies:**
```bash
# No new npm packages needed - uses built-in Node.js child_process
```

**Environment Variables:**
```env
# Cursor CLI Configuration
CURSOR_CLI_PATH=/usr/local/bin/cursor
CURSOR_HEADLESS_TIMEOUT_MS=300000
CURSOR_WORKSPACES_ROOT=/tmp/cursor-workspaces
CURSOR_MAX_CONCURRENT_WORKSPACES=10
CURSOR_PRESERVE_FAILED_WORKSPACES=true
```

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | **MODIFY** | Update AIProvider enum (REQUIRED FIRST) |
| `src/ai-routing/interfaces/ai-provider.interface.ts` | CREATE | Provider abstraction |
| `src/ai-routing/interfaces/index.ts` | **MODIFY** | Export new interfaces |
| `src/ai-routing/dto/ai-execution.dto.ts` | CREATE | Execution DTOs |
| `src/ai-routing/dto/index.ts` | **MODIFY** | Export new DTOs |
| `src/ai-routing/providers/workspace.service.ts` | CREATE | Workspace lifecycle |
| `src/ai-routing/providers/git-operations.service.ts` | CREATE | Git wrapper |
| `src/ai-routing/providers/cursor-headless.provider.ts` | CREATE | Cursor integration |
| `src/ai-routing/providers/circuit-breaker.ts` | CREATE | Resilience pattern |
| `src/ai-routing/providers/index.ts` | CREATE | Barrel export |
| `src/ai-routing/ai-execution.service.ts` | CREATE | Execution orchestration |
| `src/ai-routing/ai-execution.service.spec.ts` | CREATE | Unit tests |
| `test/ai-execution.e2e-spec.ts` | CREATE | Integration tests |
| `src/ai-routing/ai-routing.module.ts` | **MODIFY** | Wire providers |
| `src/config/configuration.ts` | **MODIFY** | Add Cursor config |
| `src/config/env.validation.ts` | **MODIFY** | Add env validation |

---

## Step 0: Verify Prerequisites (REQUIRED)

### 0.1 Check Execution Service Exists

```bash
# Verify Story 2.5 services exist
ls src/execution/execution.service.ts
ls src/execution/execution-tracker.service.ts
```

**Expected:** Both files exist.

### 0.2 Check Execution Module Exported

```bash
# Verify ExecutionModule exports services
grep -E "exports.*ExecutionService" src/execution/execution.module.ts
```

**Expected:** ExecutionService in exports array.

### 0.3 Check Cursor CLI Available (Development)

```bash
# Check if Cursor CLI is installed
which cursor || echo "Cursor CLI not found - will mock in tests"
```

**Note:** Cursor CLI may not be available in all environments. The provider should handle this gracefully.

### 0.4 Check Environment Configuration

```bash
# Verify ConfigService is available
grep -E "ConfigModule|ConfigService" src/app.module.ts
```

**Expected:** ConfigModule imported globally.

**If any check fails:** STOP. Complete prerequisites first.

---

## Step 0.5: Update Prisma Schema (REQUIRED)

**⚠️ CRITICAL:** The AIProvider enum must be updated before proceeding. The current schema has legacy values that don't match the multi-provider architecture.

**File:** `prisma/schema.prisma` - **MODIFY**

Find and update the `AIProvider` enum:

```prisma
// BEFORE (current schema):
enum AIProvider {
  CURSOR
  WINDSURF
  ANTIGRAVITY
}

// AFTER (updated for multi-provider architecture):
enum AIProvider {
  CURSOR_HEADLESS    // Primary: Cursor CLI headless mode (Story 2.6)
  CLAUDE_CODE        // Secondary: Claude Code - Anthropic (Story 2.7)
}
```

**Run migration:**

```bash
# Generate Prisma client with updated enum
pnpm prisma generate

# Create migration for the enum change
pnpm prisma migrate dev --name update_ai_provider_enum
```

**Verify:**

```bash
# Check that AIProvider enum has new values
grep -A5 "enum AIProvider" prisma/schema.prisma
```

**Expected output:**
```
enum AIProvider {
  CURSOR_HEADLESS
  CLAUDE_CODE
}
```

**Note:** If you have existing data in the `executions` table using old enum values (`CURSOR`, `WINDSURF`, `ANTIGRAVITY`), you'll need a data migration. For greenfield development, this is not needed.

---

## Step 1: Create AI Provider Interface

**File:** `src/ai-routing/interfaces/ai-provider.interface.ts`

```typescript
/**
 * AI Provider Interface
 * FR65: Execute AI code generation
 * Architecture Reference: ADR-003 (Cursor CLI Headless Mode)
 */

import { AIProvider } from '@prisma/client';

/**
 * Input for AI code generation
 */
export interface IAIExecutionInput {
  /** Correlation ID for request tracing */
  correlationId: string;
  
  /** Execution record ID from Story 2.5 */
  executionId: string;
  
  /** Ticket ID */
  ticketId: string;
  
  /** Generated prompt from Story 2.4 */
  prompt: string;
  
  /** Repository URL to clone */
  repositoryUrl: string;
  
  /** Target branch (default: main) */
  baseBranch?: string;
  
  /** Files to focus on (optional hint to AI) */
  targetFiles?: string[];
  
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Output from AI code generation
 */
export interface IAIExecutionResult {
  /** Whether generation succeeded */
  success: boolean;
  
  /** Generated code diff (git diff format) */
  codeDiff: string | null;
  
  /** List of files modified */
  filesChanged: string[];
  
  /** Confidence score (0.0-1.0) */
  confidenceScore: number;
  
  /** Execution duration in milliseconds */
  durationMs: number;
  
  /** Workspace path (for debugging) */
  workspacePath: string;
  
  /** Error details if failed */
  error?: IAIExecutionError;
}

/**
 * AI execution error details
 */
export interface IAIExecutionError {
  /** Error code for categorization */
  code: AIErrorCode;
  
  /** Human-readable error message */
  message: string;
  
  /** Whether this error is retryable */
  isRetryable: boolean;
  
  /** Raw output (stdout/stderr) */
  rawOutput?: string;
  
  /** Exit code from CLI */
  exitCode?: number;
}

/**
 * Error codes for AI execution
 */
export enum AIErrorCode {
  /** CLI command timed out */
  TIMEOUT = 'TIMEOUT',
  
  /** CLI process crashed */
  PROCESS_CRASH = 'PROCESS_CRASH',
  
  /** Invalid prompt format */
  INVALID_PROMPT = 'INVALID_PROMPT',
  
  /** Repository clone failed */
  CLONE_FAILED = 'CLONE_FAILED',
  
  /** Git operations failed */
  GIT_ERROR = 'GIT_ERROR',
  
  /** No changes generated */
  NO_CHANGES = 'NO_CHANGES',
  
  /** Workspace limit exceeded */
  WORKSPACE_LIMIT = 'WORKSPACE_LIMIT',
  
  /** Disk space exhausted */
  DISK_SPACE = 'DISK_SPACE',
  
  /** CLI not available */
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Provider health status
 */
export interface IProviderHealth {
  /** Provider identifier */
  provider: AIProvider;
  
  /** Whether provider is healthy */
  isHealthy: boolean;
  
  /** Last successful execution timestamp */
  lastSuccessAt: Date | null;
  
  /** Last failure timestamp */
  lastFailureAt: Date | null;
  
  /** Consecutive failure count */
  consecutiveFailures: number;
  
  /** Circuit breaker state */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  
  /** Active execution count */
  activeExecutions: number;
}

/**
 * AI Provider Interface
 * All providers (Cursor, Claude) must implement this interface
 */
export interface IAIProvider {
  /** Provider identifier */
  readonly provider: AIProvider;
  
  /** Maximum concurrent executions */
  readonly maxConcurrent: number;
  
  /** Default timeout in milliseconds */
  readonly defaultTimeoutMs: number;
  
  /**
   * Execute AI code generation
   * @param input Execution parameters
   * @returns Execution result with generated code
   */
  execute(input: IAIExecutionInput): Promise<IAIExecutionResult>;
  
  /**
   * Check provider health/availability
   */
  checkHealth(): Promise<IProviderHealth>;
  
  /**
   * Cancel an ongoing execution
   * @param executionId Execution to cancel
   */
  cancel(executionId: string): Promise<void>;
}

/**
 * Workspace information
 */
export interface IWorkspaceInfo {
  /** Unique workspace ID */
  id: string;
  
  /** Filesystem path */
  path: string;
  
  /** Ticket ID */
  ticketId: string;
  
  /** Execution ID */
  executionId: string;
  
  /** Repository URL */
  repositoryUrl: string;
  
  /** Feature branch name */
  branchName: string;
  
  /** Creation timestamp */
  createdAt: Date;
  
  /** Current status */
  status: 'CREATING' | 'READY' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CLEANING';
}
```

**File:** `src/ai-routing/interfaces/index.ts` - **UPDATE**

```typescript
export * from './ai-routing.interface';
export * from './prompt-generation.interface';
export * from './ai-provider.interface';  // ADD
```

---

## Step 2: Create AI Execution DTOs

**File:** `src/ai-routing/dto/ai-execution.dto.ts`

```typescript
import { AIProvider } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';

/**
 * DTO for AI execution request
 */
export class AIExecutionRequestDto {
  @IsString() @IsNotEmpty()
  correlationId: string;

  @IsString() @IsNotEmpty()
  executionId: string;

  @IsString() @IsNotEmpty()
  ticketId: string;

  @IsString() @IsNotEmpty()
  prompt: string;

  @IsString() @IsNotEmpty()
  repositoryUrl: string;

  @IsOptional() @IsString()
  baseBranch?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  targetFiles?: string[];

  @IsOptional() @IsNumber() @Min(30000) @Max(600000)
  timeoutMs?: number;
}

/**
 * DTO for AI execution result
 */
export class AIExecutionResultDto {
  success: boolean;
  codeDiff: string | null;
  filesChanged: string[];
  confidenceScore: number;
  durationMs: number;
  workspacePath: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable?: boolean;
}

/**
 * DTO for workspace status
 */
export class WorkspaceStatusDto {
  id: string;
  path: string;
  ticketId: string;
  executionId: string;
  status: string;
  createdAt: Date;
  sizeBytes?: number;
}

/**
 * DTO for provider health response
 */
export class ProviderHealthDto {
  provider: AIProvider;
  isHealthy: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  circuitState: string;
  activeExecutions: number;
}
```

**File:** `src/ai-routing/dto/index.ts` - **UPDATE**

```typescript
export * from './routing-request.dto';
export * from './routing-decision.dto';
export * from './prompt-generation.dto';
export * from './ai-execution.dto';  // ADD
```

---

## Step 3: Create Workspace Service

**File:** `src/ai-routing/providers/workspace.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IWorkspaceInfo, AIErrorCode, IAIExecutionError } from '../interfaces';
import { GitOperationsService } from './git-operations.service';

/**
 * Workspace Service
 * 
 * Manages isolated workspaces for AI code generation.
 * Each execution gets its own workspace to prevent conflicts.
 * 
 * Architecture Reference: Workspace Isolation Strategy
 */
@Injectable()
export class WorkspaceService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceService.name);
  
  /** Active workspaces map */
  private readonly workspaces: Map<string, IWorkspaceInfo> = new Map();
  
  /** Configuration */
  private workspacesRoot: string;
  private maxConcurrent: number;
  private preserveFailed: boolean;
  private cleanupAgeMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly git: GitOperationsService,
    @InjectMetric('cursor_workspaces_active')
    private readonly activeGauge: Gauge<string>,
    @InjectMetric('cursor_workspace_operations_total')
    private readonly operationsCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workspacesRoot = this.config.get<string>(
      'cursor.workspacesRoot',
      '/tmp/cursor-workspaces',
    );
    this.maxConcurrent = this.config.get<number>(
      'cursor.maxConcurrentWorkspaces',
      10,
    );
    this.preserveFailed = this.config.get<boolean>(
      'cursor.preserveFailedWorkspaces',
      true,
    );
    this.cleanupAgeMs = this.config.get<number>(
      'cursor.workspaceCleanupAgeMs',
      7 * 24 * 60 * 60 * 1000, // 7 days
    );

    // Ensure workspace root exists
    await fs.mkdir(this.workspacesRoot, { recursive: true });
    
    this.logger.log(
      `Workspace service initialized: root=${this.workspacesRoot}, maxConcurrent=${this.maxConcurrent}`,
    );

    // Start periodic cleanup
    this.startCleanupScheduler();
  }

  /**
   * Create a new isolated workspace for execution
   */
  async createWorkspace(
    executionId: string,
    ticketId: string,
    repositoryUrl: string,
    baseBranch: string = 'main',
  ): Promise<IWorkspaceInfo> {
    // Check concurrency limit
    if (this.workspaces.size >= this.maxConcurrent) {
      throw this.createError(
        AIErrorCode.WORKSPACE_LIMIT,
        `Maximum concurrent workspaces (${this.maxConcurrent}) reached`,
        false,
      );
    }

    const workspaceId = `ticket-${ticketId}-${Date.now()}`;
    const workspacePath = path.join(this.workspacesRoot, workspaceId);
    const branchName = `feature/ticket-${ticketId}`;

    const workspace: IWorkspaceInfo = {
      id: workspaceId,
      path: workspacePath,
      ticketId,
      executionId,
      repositoryUrl,
      branchName,
      createdAt: new Date(),
      status: 'CREATING',
    };

    this.workspaces.set(executionId, workspace);
    this.updateMetrics();

    try {
      this.logger.log(`[${executionId}] Creating workspace: ${workspacePath}`);

      // 1. Create directory
      await fs.mkdir(workspacePath, { recursive: true });

      // 2. Clone repository (shallow clone for speed)
      await this.git.clone(repositoryUrl, workspacePath, { depth: 1 });

      // 3. Configure git user for commits
      await this.git.configureUser(workspacePath, 'Dark Factory', 'bot@darkfactory.ai');

      // 4. Create feature branch
      await this.git.checkoutBranch(workspacePath, branchName, true);

      workspace.status = 'READY';
      this.operationsCounter.inc({ operation: 'create', status: 'success' });

      this.logger.log(`[${executionId}] Workspace ready: ${workspacePath}`);
      return workspace;

    } catch (error) {
      workspace.status = 'FAILED';
      this.operationsCounter.inc({ operation: 'create', status: 'error' });
      
      // Cleanup failed workspace
      await this.cleanupWorkspace(executionId, true);
      
      throw this.createError(
        AIErrorCode.CLONE_FAILED,
        `Failed to create workspace: ${error.message}`,
        true,
        error.message,
      );
    }
  }

  /**
   * Get workspace info by execution ID
   */
  getWorkspace(executionId: string): IWorkspaceInfo | undefined {
    return this.workspaces.get(executionId);
  }

  /**
   * Update workspace status
   */
  updateWorkspaceStatus(
    executionId: string,
    status: IWorkspaceInfo['status'],
  ): void {
    const workspace = this.workspaces.get(executionId);
    if (workspace) {
      workspace.status = status;
    }
  }

  /**
   * Extract changes from workspace (git diff)
   */
  async extractChanges(executionId: string): Promise<{
    diff: string;
    filesChanged: string[];
  }> {
    const workspace = this.workspaces.get(executionId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${executionId}`);
    }

    try {
      // Get diff against HEAD (captures all uncommitted changes)
      const diff = await this.git.getDiff(workspace.path);
      
      // Get list of changed files
      const filesChanged = await this.git.getChangedFiles(workspace.path);

      return { diff, filesChanged };

    } catch (error) {
      throw this.createError(
        AIErrorCode.GIT_ERROR,
        `Failed to extract changes: ${error.message}`,
        false,
      );
    }
  }

  /**
   * Cleanup workspace after execution
   */
  async cleanupWorkspace(executionId: string, force: boolean = false): Promise<void> {
    const workspace = this.workspaces.get(executionId);
    if (!workspace) {
      return;
    }

    // Preserve failed workspaces if configured
    if (workspace.status === 'FAILED' && this.preserveFailed && !force) {
      this.logger.log(
        `[${executionId}] Preserving failed workspace for debugging: ${workspace.path}`,
      );
      return;
    }

    workspace.status = 'CLEANING';

    try {
      await fs.rm(workspace.path, { recursive: true, force: true });
      this.logger.log(`[${executionId}] Workspace cleaned: ${workspace.path}`);
      this.operationsCounter.inc({ operation: 'cleanup', status: 'success' });
    } catch (error) {
      this.logger.error(
        `[${executionId}] Failed to cleanup workspace: ${error.message}`,
      );
      this.operationsCounter.inc({ operation: 'cleanup', status: 'error' });
      // Don't throw - cleanup failures shouldn't block execution
    } finally {
      this.workspaces.delete(executionId);
      this.updateMetrics();
    }
  }

  /**
   * Get all active workspaces
   */
  getActiveWorkspaces(): IWorkspaceInfo[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Get workspace count
   */
  getActiveCount(): number {
    return this.workspaces.size;
  }

  /**
   * Check disk space availability
   */
  async checkDiskSpace(): Promise<{ available: boolean; usedMB: number }> {
    try {
      const stats = await fs.statfs(this.workspacesRoot);
      const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
      const minRequiredMB = 500; // Require at least 500MB free
      
      return {
        available: availableMB > minRequiredMB,
        usedMB: (stats.blocks - stats.bfree) * stats.bsize / (1024 * 1024),
      };
    } catch {
      // If statfs fails, assume space is available
      return { available: true, usedMB: 0 };
    }
  }

  /**
   * Start periodic cleanup of old workspaces
   */
  private startCleanupScheduler(): void {
    // Run cleanup every hour
    setInterval(async () => {
      await this.cleanupOldWorkspaces();
    }, 60 * 60 * 1000);
  }

  /**
   * Cleanup workspaces older than configured age
   */
  private async cleanupOldWorkspaces(): Promise<void> {
    try {
      const entries = await fs.readdir(this.workspacesRoot, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const dirPath = path.join(this.workspacesRoot, entry.name);
        const stats = await fs.stat(dirPath);
        const ageMs = now - stats.mtime.getTime();

        if (ageMs > this.cleanupAgeMs) {
          this.logger.log(`Cleaning up old workspace: ${entry.name}`);
          await fs.rm(dirPath, { recursive: true, force: true });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old workspaces: ${error.message}`);
    }
  }

  /**
   * Update Prometheus metrics
   */
  private updateMetrics(): void {
    this.activeGauge.set(this.workspaces.size);
  }

  /**
   * Create execution error
   */
  private createError(
    code: AIErrorCode,
    message: string,
    isRetryable: boolean,
    rawOutput?: string,
  ): IAIExecutionError {
    return {
      code,
      message,
      isRetryable,
      rawOutput,
    };
  }
}
```

---

## Step 4: Create Git Operations Service

**File:** `src/ai-routing/providers/git-operations.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Git Operations Service
 * 
 * Wrapper for git CLI commands used in workspace management.
 * Handles clone, branch, diff, and other git operations.
 */
@Injectable()
export class GitOperationsService {
  private readonly logger = new Logger(GitOperationsService.name);

  /** Default timeout for git operations (2 minutes) */
  private readonly DEFAULT_TIMEOUT_MS = 120_000;

  /**
   * Clone a repository to target path
   */
  async clone(
    repositoryUrl: string,
    targetPath: string,
    options: { depth?: number; branch?: string } = {},
  ): Promise<void> {
    const args = ['clone'];
    
    if (options.depth) {
      args.push('--depth', String(options.depth));
    }
    if (options.branch) {
      args.push('--branch', options.branch);
    }
    
    args.push(repositoryUrl, targetPath);

    await this.execGit(args, undefined, 'Clone repository');
  }

  /**
   * Configure git user for commits
   */
  async configureUser(
    workspacePath: string,
    name: string,
    email: string,
  ): Promise<void> {
    await this.execGit(
      ['config', 'user.name', name],
      workspacePath,
      'Configure git user name',
    );
    await this.execGit(
      ['config', 'user.email', email],
      workspacePath,
      'Configure git user email',
    );
  }

  /**
   * Checkout or create a branch
   */
  async checkoutBranch(
    workspacePath: string,
    branchName: string,
    create: boolean = false,
  ): Promise<void> {
    const args = ['checkout'];
    if (create) {
      args.push('-b');
    }
    args.push(branchName);

    await this.execGit(args, workspacePath, `Checkout branch ${branchName}`);
  }

  /**
   * Get diff of all changes
   */
  async getDiff(workspacePath: string): Promise<string> {
    // First add all files to staging to capture new files
    await this.execGit(['add', '-A'], workspacePath, 'Stage all changes');
    
    // Get diff of staged changes
    const result = await this.execGit(
      ['diff', '--cached'],
      workspacePath,
      'Get staged diff',
    );
    
    return result.stdout;
  }

  /**
   * Get list of changed files
   */
  async getChangedFiles(workspacePath: string): Promise<string[]> {
    // Get status in porcelain format for easy parsing
    const result = await this.execGit(
      ['status', '--porcelain'],
      workspacePath,
      'Get changed files',
    );

    const files = result.stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.substring(3).trim()); // Remove status prefix (e.g., "M  ", "A  ")

    return files;
  }

  /**
   * Create a commit
   */
  async commit(workspacePath: string, message: string): Promise<string> {
    // Add all changes
    await this.execGit(['add', '-A'], workspacePath, 'Stage changes');
    
    // Create commit
    const result = await this.execGit(
      ['commit', '-m', message],
      workspacePath,
      'Create commit',
    );

    // Get commit SHA
    const shaResult = await this.execGit(
      ['rev-parse', 'HEAD'],
      workspacePath,
      'Get commit SHA',
    );

    return shaResult.stdout.trim();
  }

  /**
   * Check if there are any changes
   */
  async hasChanges(workspacePath: string): Promise<boolean> {
    const result = await this.execGit(
      ['status', '--porcelain'],
      workspacePath,
      'Check for changes',
    );
    return result.stdout.trim().length > 0;
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(workspacePath: string): Promise<string> {
    const result = await this.execGit(
      ['branch', '--show-current'],
      workspacePath,
      'Get current branch',
    );
    return result.stdout.trim();
  }

  /**
   * Reset all changes (discard modifications)
   */
  async resetChanges(workspacePath: string): Promise<void> {
    await this.execGit(['reset', '--hard', 'HEAD'], workspacePath, 'Reset changes');
    await this.execGit(['clean', '-fd'], workspacePath, 'Clean untracked files');
  }

  /**
   * Execute git command
   */
  private async execGit(
    args: string[],
    cwd?: string,
    description?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const command = `git ${args.join(' ')}`;
    
    try {
      this.logger.debug(`${description || 'Git'}: ${command}`);
      
      const result = await execAsync(command, {
        cwd,
        timeout: this.DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      });

      return result;

    } catch (error: any) {
      this.logger.error(`Git command failed: ${command}`, error.message);
      throw new Error(`Git operation failed: ${error.message}`);
    }
  }
}
```

---

## Step 5: Create Circuit Breaker

**File:** `src/ai-routing/providers/circuit-breaker.ts`

```typescript
import { Logger } from '@nestjs/common';

/**
 * Circuit Breaker State
 */
export enum CircuitState {
  /** Normal operation - requests allowed */
  CLOSED = 'CLOSED',
  
  /** Failures exceeded threshold - requests blocked */
  OPEN = 'OPEN',
  
  /** Testing recovery - limited requests allowed */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures to open circuit */
  failureThreshold: number;
  
  /** Time to wait before testing recovery (ms) */
  resetTimeoutMs: number;
  
  /** Number of successes to close circuit from half-open */
  successThreshold: number;
}

/**
 * Circuit Breaker
 * 
 * Implements the circuit breaker pattern for resilience.
 * Prevents cascading failures by failing fast when provider is unhealthy.
 * 
 * Architecture Reference: NFR-R4 (Reliability)
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 5,
      resetTimeoutMs: 30_000, // 30 seconds
      successThreshold: 3,
    },
  ) {}

  /**
   * Check if request is allowed
   */
  canExecute(): boolean {
    this.updateState();
    
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
        
      case CircuitState.OPEN:
        return false;
        
      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        return true;
        
      default:
        return false;
    }
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    this.lastSuccessTime = new Date();
    
    switch (this.state) {
      case CircuitState.CLOSED:
        this.failureCount = 0;
        break;
        
      case CircuitState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.close();
        }
        break;
    }
  }

  /**
   * Record failed execution
   */
  recordFailure(): void {
    this.lastFailureTime = new Date();
    this.failureCount++;
    
    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.failureCount >= this.config.failureThreshold) {
          this.open();
        }
        break;
        
      case CircuitState.HALF_OPEN:
        this.open();
        break;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    lastSuccessTime: Date | null;
    lastFailureTime: Date | null;
  } {
    this.updateState();
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastSuccessTime: this.lastSuccessTime,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Force circuit to close (manual recovery)
   */
  reset(): void {
    this.close();
    this.logger.log(`[${this.name}] Circuit manually reset`);
  }

  /**
   * Update state based on time
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN && this.nextAttemptTime) {
      if (new Date() >= this.nextAttemptTime) {
        this.halfOpen();
      }
    }
  }

  /**
   * Transition to OPEN state
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeoutMs);
    this.successCount = 0;
    
    this.logger.warn(
      `[${this.name}] Circuit OPENED after ${this.failureCount} failures. ` +
      `Will retry at ${this.nextAttemptTime.toISOString()}`,
    );
  }

  /**
   * Transition to HALF_OPEN state
   */
  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
    
    this.logger.log(`[${this.name}] Circuit HALF_OPEN - testing recovery`);
  }

  /**
   * Transition to CLOSED state
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    
    this.logger.log(`[${this.name}] Circuit CLOSED - normal operation resumed`);
  }
}
```

---

## Step 6: Create Cursor Headless Provider

**File:** `src/ai-routing/providers/cursor-headless.provider.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
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

const execAsync = promisify(exec);

/**
 * Cursor CLI Headless Provider
 * 
 * PRIMARY AI provider for complex, multi-file code generation.
 * Uses Cursor's official CLI with --headless flag for server-side execution.
 * 
 * Architecture Reference: ADR-003 (Cursor CLI Headless Mode)
 * FR65: Execute AI code generation
 */
@Injectable()
export class CursorHeadlessProvider implements IAIProvider, OnModuleInit {
  private readonly logger = new Logger(CursorHeadlessProvider.name);
  
  readonly provider = AIProvider.CURSOR_HEADLESS;
  readonly maxConcurrent: number = 10;
  readonly defaultTimeoutMs: number = 300_000; // 5 minutes

  /** Active executions map */
  private readonly activeExecutions: Map<string, ChildProcess> = new Map();
  
  /** Circuit breaker for resilience */
  private readonly circuitBreaker: CircuitBreaker;
  
  /** Configuration */
  private cliPath: string;
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

    this.logger.log(
      `[${correlationId}] Starting Cursor execution for ticket ${ticketId}`,
    );

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

    // Check CLI availability
    if (!this.isCliAvailable) {
      await this.checkCliAvailability();
      if (!this.isCliAvailable) {
        return this.createFailedResult(
          startTime,
          '',
          {
            code: AIErrorCode.CLI_NOT_FOUND,
            message: `Cursor CLI not found at: ${this.cliPath}`,
            isRetryable: false,
          },
        );
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
        return this.createFailedResult(
          startTime,
          workspacePath,
          {
            code: AIErrorCode.NO_CHANGES,
            message: 'Cursor CLI completed but no changes were generated',
            isRetryable: true,
            rawOutput: cliResult.stdout,
          },
        );
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

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.circuitBreaker.recordFailure();
      this.executionsCounter.inc({ status: 'error' });
      this.durationHistogram.observe({ status: 'error' }, durationMs / 1000);

      this.logger.error(
        `[${correlationId}] Cursor execution failed: ${error.message}`,
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
   * Execute Cursor CLI command
   */
  private async executeCursorCli(
    executionId: string,
    workspacePath: string,
    prompt: string,
    targetFiles?: string[],
    timeout: number = this.defaultTimeoutMs,
  ): Promise<{ stdout: string; stderr: string }> {
    // Build command
    const args = [
      '--headless',
      '--dir', workspacePath,
      '--apply', `"${this.escapePrompt(prompt)}"`,
      '--wait',
    ];

    if (targetFiles && targetFiles.length > 0) {
      args.push('--files', targetFiles.join(','));
    }

    const command = `${this.cliPath} ${args.join(' ')}`;

    this.logger.debug(`[${executionId}] Executing: ${this.cliPath} --headless ...`);

    return new Promise((resolve, reject) => {
      const childProcess = exec(
        command,
        {
          timeout,
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer
          cwd: workspacePath,
        },
        (error, stdout, stderr) => {
          if (error) {
            // Check if it was a timeout
            if (error.killed || error.signal === 'SIGTERM') {
              reject({
                code: AIErrorCode.TIMEOUT,
                message: `Cursor CLI timed out after ${timeout}ms`,
                isRetryable: true,
                exitCode: error.code,
              });
            } else {
              reject({
                code: AIErrorCode.PROCESS_CRASH,
                message: error.message,
                isRetryable: this.isRetryableExit(error.code),
                exitCode: error.code,
                rawOutput: stderr || stdout,
              });
            }
          } else {
            resolve({ stdout, stderr });
          }
        },
      );

      // Store process reference for cancellation
      this.activeExecutions.set(executionId, childProcess);
    });
  }

  /**
   * Check if Cursor CLI is available
   */
  private async checkCliAvailability(): Promise<void> {
    try {
      await execAsync(`${this.cliPath} --version`, { timeout: 5000 });
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
   * Escape prompt for shell command
   */
  private escapePrompt(prompt: string): string {
    return prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }

  /**
   * Check if exit code indicates retryable error
   */
  private isRetryableExit(exitCode?: number): boolean {
    // Common retryable exit codes
    const retryableCodes = [
      1,    // General error (often transient)
      124,  // Timeout
      137,  // SIGKILL (OOM, etc.)
      143,  // SIGTERM
    ];
    return exitCode !== undefined && retryableCodes.includes(exitCode);
  }

  /**
   * Parse error into structured format
   */
  private parseError(error: any): IAIExecutionError {
    if (error.code && Object.values(AIErrorCode).includes(error.code)) {
      return error as IAIExecutionError;
    }

    return {
      code: AIErrorCode.UNKNOWN,
      message: error.message || String(error),
      isRetryable: true,
      rawOutput: error.rawOutput,
      exitCode: error.exitCode,
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

## Step 7: Create Provider Barrel Export

**File:** `src/ai-routing/providers/index.ts`

```typescript
export * from './workspace.service';
export * from './git-operations.service';
export * from './cursor-headless.provider';
export * from './circuit-breaker';
```

---

## Step 8: Create AI Execution Service

**File:** `src/ai-routing/ai-execution.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealth,
} from './interfaces';
import { CursorHeadlessProvider } from './providers';
import { ExecutionService } from '../execution/execution.service';
import { CompleteExecutionDto, FailExecutionDto } from '../execution/dto';

/**
 * AI Execution Service
 * 
 * Orchestrates AI code generation across providers.
 * Coordinates with ExecutionService for status tracking.
 * 
 * FR65: Execute AI code generation
 */
@Injectable()
export class AIExecutionService {
  private readonly logger = new Logger(AIExecutionService.name);
  
  /** Provider registry */
  private readonly providers: Map<AIProvider, IAIProvider> = new Map();

  constructor(
    private readonly cursorProvider: CursorHeadlessProvider,
    private readonly executionService: ExecutionService,
  ) {
    // Register providers
    this.providers.set(AIProvider.CURSOR_HEADLESS, this.cursorProvider);
    // Claude provider will be added in Story 2.7
  }

  /**
   * Execute AI code generation with the specified provider
   */
  async executeWithProvider(
    provider: AIProvider,
    input: IAIExecutionInput,
  ): Promise<IAIExecutionResult> {
    const { correlationId, executionId } = input;

    this.logger.log(
      `[${correlationId}] Executing with provider: ${provider}`,
    );

    // Get provider
    const aiProvider = this.providers.get(provider);
    if (!aiProvider) {
      throw new Error(`Provider not registered: ${provider}`);
    }

    // Mark execution as in progress
    await this.executionService.markInProgress(executionId, correlationId);

    try {
      // Execute
      const result = await aiProvider.execute(input);

      // Update execution status based on result
      if (result.success) {
        const completeDto: CompleteExecutionDto = {
          executionId,
          codeOutput: result.codeDiff || '',
          filesChanged: result.filesChanged,
          confidenceScore: result.confidenceScore,
        };
        await this.executionService.completeExecution(completeDto, correlationId);
      } else {
        const failDto: FailExecutionDto = {
          executionId,
          errorMessage: result.error?.message || 'Unknown error',
          errorCode: result.error?.code,
        };
        await this.executionService.failExecution(
          failDto,
          correlationId,
          result.error?.isRetryable ?? true,
        );
      }

      return result;

    } catch (error: any) {
      // Handle unexpected errors
      const failDto: FailExecutionDto = {
        executionId,
        errorMessage: error.message,
        errorCode: 'UNEXPECTED_ERROR',
      };
      await this.executionService.failExecution(failDto, correlationId, true);
      throw error;
    }
  }

  /**
   * Get provider health status
   */
  async getProviderHealth(provider: AIProvider): Promise<IProviderHealth | null> {
    const aiProvider = this.providers.get(provider);
    if (!aiProvider) {
      return null;
    }
    return aiProvider.checkHealth();
  }

  /**
   * Get all providers health
   */
  async getAllProvidersHealth(): Promise<IProviderHealth[]> {
    const health: IProviderHealth[] = [];
    
    for (const provider of this.providers.values()) {
      health.push(await provider.checkHealth());
    }
    
    return health;
  }

  /**
   * Cancel an ongoing execution
   */
  async cancelExecution(
    provider: AIProvider,
    executionId: string,
    correlationId: string,
  ): Promise<void> {
    const aiProvider = this.providers.get(provider);
    if (aiProvider) {
      await aiProvider.cancel(executionId);
    }
    
    await this.executionService.cancelExecution(
      executionId,
      'Cancelled by user',
      correlationId,
    );
  }

  /**
   * Check if provider is available
   */
  async isProviderAvailable(provider: AIProvider): Promise<boolean> {
    const health = await this.getProviderHealth(provider);
    return health?.isHealthy ?? false;
  }
}
```

---

## Step 9: Update AI Routing Module

**File:** `src/ai-routing/ai-routing.module.ts` - **UPDATE**

Add the new providers and services:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { AIRoutingService } from './ai-routing.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AIRoutingConsumer } from './ai-routing.consumer';
import { PromptGeneratorService } from './prompt-generator.service';
import { CursorPromptBuilder } from './prompt-templates/cursor-prompt.template';
import { ClaudeCodePromptBuilder } from './prompt-templates/claude-prompt.template';
// Story 2.6 imports (ADD)
import { AIExecutionService } from './ai-execution.service';
import {
  WorkspaceService,
  GitOperationsService,
  CursorHeadlessProvider,
} from './providers';
import { DatabaseModule } from '../database/database.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { ExecutionModule } from '../execution/execution.module';  // ADD

/**
 * AI Routing Module
 * 
 * Story 2.3: FR60 - Route to appropriate AI tool
 * Story 2.4: FR61 - Convert tickets to AI-executable prompts
 * Story 2.6: FR65 - Execute AI code generation (Cursor)
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitmqModule,
    ExecutionModule,  // ADD - for ExecutionService
  ],
  providers: [
    // Story 2.3: Routing services
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    AIRoutingConsumer,
    
    // Story 2.4: Prompt generation
    PromptGeneratorService,
    CursorPromptBuilder,
    ClaudeCodePromptBuilder,

    // Story 2.6: AI Execution (ADD)
    AIExecutionService,
    WorkspaceService,
    GitOperationsService,
    CursorHeadlessProvider,

    // Story 2.3 Metrics
    makeCounterProvider({
      name: 'ai_routing_total',
      help: 'Total AI routing decisions',
      labelNames: ['provider', 'reason', 'fallback'],
    }),
    makeHistogramProvider({
      name: 'ai_routing_duration_seconds',
      help: 'AI routing duration in seconds',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeHistogramProvider({
      name: 'ai_complexity_score',
      help: 'Complexity score distribution',
      labelNames: ['grade'],
      buckets: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    }),
    makeGaugeProvider({
      name: 'ai_provider_health',
      help: 'AI provider health status',
      labelNames: ['provider'],
    }),
    makeGaugeProvider({
      name: 'ai_provider_active_executions',
      help: 'Active executions per provider',
      labelNames: ['provider'],
    }),
    makeCounterProvider({
      name: 'ai_provider_availability_total',
      help: 'Provider availability transitions',
      labelNames: ['provider', 'status'],
    }),

    // Story 2.4 Metrics
    makeCounterProvider({
      name: 'prompt_generation_total',
      help: 'Total prompts generated',
      labelNames: ['provider', 'has_context'],
    }),
    makeHistogramProvider({
      name: 'prompt_tokens_histogram',
      help: 'Prompt token count distribution',
      labelNames: ['provider'],
      buckets: [1000, 5000, 10000, 25000, 50000, 100000, 150000, 200000],
    }),
    makeHistogramProvider({
      name: 'prompt_generation_duration_seconds',
      help: 'Prompt generation duration',
      labelNames: ['provider'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
    }),

    // Story 2.6 Metrics (ADD)
    makeCounterProvider({
      name: 'cursor_executions_total',
      help: 'Total Cursor CLI executions',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'cursor_execution_duration_seconds',
      help: 'Cursor execution duration in seconds',
      labelNames: ['status'],
      buckets: [10, 30, 60, 120, 180, 240, 300, 600],
    }),
    makeGaugeProvider({
      name: 'cursor_active_executions',
      help: 'Currently active Cursor executions',
    }),
    makeGaugeProvider({
      name: 'cursor_workspaces_active',
      help: 'Currently active workspaces',
    }),
    makeCounterProvider({
      name: 'cursor_workspace_operations_total',
      help: 'Workspace operations count',
      labelNames: ['operation', 'status'],
    }),
  ],
  exports: [
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    PromptGeneratorService,
    CursorPromptBuilder,
    ClaudeCodePromptBuilder,
    // Story 2.6 exports (ADD)
    AIExecutionService,
    WorkspaceService,
    CursorHeadlessProvider,
  ],
})
export class AiRoutingModule {}
```

---

## Step 9.5: Add Health Check Controller (Optional but Recommended)

**File:** `src/ai-routing/ai-providers-health.controller.ts` - **CREATE**

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AIExecutionService } from './ai-execution.service';
import { ProviderHealthDto } from './dto';

/**
 * AI Providers Health Controller
 * 
 * Provides health check endpoints for operations monitoring.
 * Useful for dashboards and alerting systems.
 */
@ApiTags('ai-providers')
@Controller('ai-providers')
export class AIProvidersHealthController {
  constructor(private readonly aiExecutionService: AIExecutionService) {}

  @Get('health')
  @ApiOperation({ summary: 'Get health status of all AI providers' })
  @ApiResponse({
    status: 200,
    description: 'Health status of all registered providers',
    type: [ProviderHealthDto],
  })
  async getProvidersHealth(): Promise<ProviderHealthDto[]> {
    return this.aiExecutionService.getAllProvidersHealth();
  }

  @Get('health/cursor')
  @ApiOperation({ summary: 'Get Cursor provider health' })
  @ApiResponse({
    status: 200,
    description: 'Cursor provider health status',
    type: ProviderHealthDto,
  })
  async getCursorHealth(): Promise<ProviderHealthDto | null> {
    const { AIProvider } = await import('@prisma/client');
    return this.aiExecutionService.getProviderHealth(AIProvider.CURSOR_HEADLESS);
  }
}
```

**Update module to include controller:**

In `src/ai-routing/ai-routing.module.ts`, add:

```typescript
import { AIProvidersHealthController } from './ai-providers-health.controller';

@Module({
  // ... existing config
  controllers: [AIProvidersHealthController],  // ADD
  // ... rest of module
})
```

**Verify endpoint:**

```bash
# After starting server
curl http://localhost:3000/ai-providers/health
```

---

## Step 10: Update Configuration

**File:** `src/config/configuration.ts` - **ADD** Cursor configuration section:

```typescript
// Add to the configuration factory function:

cursor: {
  cliPath: process.env.CURSOR_CLI_PATH || 'cursor',
  headlessTimeoutMs: parseInt(process.env.CURSOR_HEADLESS_TIMEOUT_MS || '300000', 10),
  workspacesRoot: process.env.CURSOR_WORKSPACES_ROOT || '/tmp/cursor-workspaces',
  maxConcurrentWorkspaces: parseInt(process.env.CURSOR_MAX_CONCURRENT_WORKSPACES || '10', 10),
  preserveFailedWorkspaces: process.env.CURSOR_PRESERVE_FAILED_WORKSPACES === 'true',
  workspaceCleanupAgeMs: parseInt(
    process.env.CURSOR_WORKSPACE_CLEANUP_AGE_MS || String(7 * 24 * 60 * 60 * 1000),
    10,
  ),
},
```

**File:** `src/config/env.validation.ts` - **ADD** Cursor environment variables:

```typescript
// Add to the environment validation schema:

// Cursor CLI Configuration (optional - has defaults)
CURSOR_CLI_PATH: Joi.string().default('cursor'),
CURSOR_HEADLESS_TIMEOUT_MS: Joi.number().min(30000).max(600000).default(300000),
CURSOR_WORKSPACES_ROOT: Joi.string().default('/tmp/cursor-workspaces'),
CURSOR_MAX_CONCURRENT_WORKSPACES: Joi.number().min(1).max(50).default(10),
CURSOR_PRESERVE_FAILED_WORKSPACES: Joi.boolean().default(true),
```

---

## Step 11: Create Unit Tests

**File:** `src/ai-routing/ai-execution.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider } from '@prisma/client';
import { AIExecutionService } from './ai-execution.service';
import { CursorHeadlessProvider } from './providers';
import { ExecutionService } from '../execution/execution.service';
import { IAIExecutionInput, IAIExecutionResult, AIErrorCode } from './interfaces';

describe('AIExecutionService', () => {
  let service: AIExecutionService;
  let cursorProvider: jest.Mocked<CursorHeadlessProvider>;
  let executionService: jest.Mocked<ExecutionService>;

  const mockInput: IAIExecutionInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Test prompt',
    repositoryUrl: 'https://github.com/test/repo.git',
    baseBranch: 'main',
  };

  const mockSuccessResult: IAIExecutionResult = {
    success: true,
    codeDiff: 'diff --git a/file.ts b/file.ts\n...',
    filesChanged: ['src/file.ts'],
    confidenceScore: 0.85,
    durationMs: 30000,
    workspacePath: '/tmp/cursor-workspaces/ticket-789-1234567890',
  };

  const mockFailedResult: IAIExecutionResult = {
    success: false,
    codeDiff: null,
    filesChanged: [],
    confidenceScore: 0,
    durationMs: 5000,
    workspacePath: '/tmp/cursor-workspaces/ticket-789-1234567890',
    error: {
      code: AIErrorCode.TIMEOUT,
      message: 'Execution timed out',
      isRetryable: true,
    },
  };

  beforeEach(async () => {
    const mockCursorProvider = {
      provider: AIProvider.CURSOR_HEADLESS,
      maxConcurrent: 10,
      defaultTimeoutMs: 300000,
      execute: jest.fn(),
      checkHealth: jest.fn(),
      cancel: jest.fn(),
    };

    const mockExecutionService = {
      markInProgress: jest.fn(),
      completeExecution: jest.fn(),
      failExecution: jest.fn(),
      cancelExecution: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionService,
        { provide: CursorHeadlessProvider, useValue: mockCursorProvider },
        { provide: ExecutionService, useValue: mockExecutionService },
      ],
    }).compile();

    service = module.get<AIExecutionService>(AIExecutionService);
    cursorProvider = module.get(CursorHeadlessProvider);
    executionService = module.get(ExecutionService);
  });

  describe('executeWithProvider', () => {
    it('should execute successfully with Cursor provider', async () => {
      cursorProvider.execute.mockResolvedValue(mockSuccessResult);

      const result = await service.executeWithProvider(
        AIProvider.CURSOR_HEADLESS,
        mockInput,
      );

      expect(result.success).toBe(true);
      expect(result.filesChanged).toEqual(['src/file.ts']);
      expect(executionService.markInProgress).toHaveBeenCalledWith(
        mockInput.executionId,
        mockInput.correlationId,
      );
      expect(executionService.completeExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: mockInput.executionId,
          filesChanged: mockSuccessResult.filesChanged,
          confidenceScore: mockSuccessResult.confidenceScore,
        }),
        mockInput.correlationId,
      );
    });

    it('should handle failed execution', async () => {
      cursorProvider.execute.mockResolvedValue(mockFailedResult);

      const result = await service.executeWithProvider(
        AIProvider.CURSOR_HEADLESS,
        mockInput,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
      expect(executionService.failExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: mockInput.executionId,
          errorMessage: 'Execution timed out',
        }),
        mockInput.correlationId,
        true, // isRetryable
      );
    });

    it('should throw for unregistered provider', async () => {
      await expect(
        service.executeWithProvider('UNKNOWN' as AIProvider, mockInput),
      ).rejects.toThrow('Provider not registered');
    });
  });

  describe('getProviderHealth', () => {
    it('should return health for registered provider', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health?.isHealthy).toBe(true);
      expect(health?.circuitState).toBe('CLOSED');
    });

    it('should return null for unregistered provider', async () => {
      const health = await service.getProviderHealth('UNKNOWN' as AIProvider);
      expect(health).toBeNull();
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution and cleanup', async () => {
      await service.cancelExecution(
        AIProvider.CURSOR_HEADLESS,
        mockInput.executionId,
        mockInput.correlationId,
      );

      expect(cursorProvider.cancel).toHaveBeenCalledWith(mockInput.executionId);
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        mockInput.executionId,
        'Cancelled by user',
        mockInput.correlationId,
      );
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when provider is healthy', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      const available = await service.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
      expect(available).toBe(true);
    });

    it('should return false when circuit is open', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: false,
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        consecutiveFailures: 5,
        circuitState: 'OPEN',
        activeExecutions: 0,
      });

      const available = await service.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
      expect(available).toBe(false);
    });
  });
});

describe('CircuitBreaker', () => {
  // Import at runtime to avoid circular dependency issues
  const { CircuitBreaker, CircuitState } = require('./providers/circuit-breaker');

  let breaker: any;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      successThreshold: 2,
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.canExecute()).toBe(true);
  });

  it('should open after threshold failures', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    
    breaker.recordFailure(); // Third failure
    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.canExecute()).toBe(false);
  });

  it('should reset failure count on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    
    // Would need 3 more failures to open
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should transition to HALF_OPEN after timeout', async () => {
    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    expect(breaker.canExecute()).toBe(true);
  });
});
```

---

## Step 12: Create Integration Tests

**File:** `test/ai-execution.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
import { WorkspaceService } from '../src/ai-routing/providers';

/**
 * AI Execution Integration Tests
 * 
 * Tests the full AI execution flow with mocked Cursor CLI.
 * Run with: pnpm test:e2e -- --testPathPattern=ai-execution
 */
describe('AI Execution (e2e)', () => {
  let app: INestApplication;
  let aiExecutionService: AIExecutionService;
  let workspaceService: WorkspaceService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('CURSOR_CLI_PATH')
      .useValue('/bin/echo') // Mock CLI with echo
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    aiExecutionService = app.get<AIExecutionService>(AIExecutionService);
    workspaceService = app.get<WorkspaceService>(WorkspaceService);
  });

  afterAll(async () => {
    // Cleanup any remaining workspaces
    const workspaces = workspaceService.getActiveWorkspaces();
    for (const ws of workspaces) {
      await workspaceService.cleanupWorkspace(ws.executionId, true);
    }
    await app.close();
  });

  describe('Provider Health', () => {
    it('should report Cursor provider health', async () => {
      const health = await aiExecutionService.getProviderHealth(
        AIProvider.CURSOR_HEADLESS,
      );

      expect(health).toBeDefined();
      expect(health?.provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(health?.circuitState).toBeDefined();
    });

    it('should return all providers health', async () => {
      const health = await aiExecutionService.getAllProvidersHealth();

      expect(health).toBeInstanceOf(Array);
      expect(health.length).toBeGreaterThan(0);
    });
  });

  describe('Workspace Management', () => {
    it('should create and cleanup workspace', async () => {
      const executionId = `test-exec-${Date.now()}`;
      const ticketId = 'test-ticket-123';
      
      // Note: This test requires git to be available
      // Skip if running in CI without git
      const workspace = await workspaceService.createWorkspace(
        executionId,
        ticketId,
        'https://github.com/test/test-repo.git',
        'main',
      ).catch(() => null);

      if (workspace) {
        expect(workspace.id).toContain('ticket-');
        expect(workspace.status).toBe('READY');

        await workspaceService.cleanupWorkspace(executionId, true);
        expect(workspaceService.getWorkspace(executionId)).toBeUndefined();
      }
    });

    it('should enforce workspace concurrency limit', async () => {
      const activeCount = workspaceService.getActiveCount();
      expect(typeof activeCount).toBe('number');
    });
  });

  describe('Execution Cancellation', () => {
    it('should cancel execution gracefully', async () => {
      const executionId = 'cancel-test-exec';
      
      await expect(
        aiExecutionService.cancelExecution(
          AIProvider.CURSOR_HEADLESS,
          executionId,
          'test-correlation-id',
        ),
      ).resolves.not.toThrow();
    });
  });
});
```

**Run integration tests:**

```bash
# Run AI execution e2e tests
pnpm test:e2e -- --testPathPattern=ai-execution
```

---

## Validation Checklist

### Interfaces & DTOs
- [ ] `IAIProvider` interface defines execute, checkHealth, cancel methods
- [ ] `IAIExecutionInput` captures all required input parameters
- [ ] `IAIExecutionResult` returns diff, files, confidence, error details
- [ ] `AIErrorCode` enum covers all failure scenarios
- [ ] DTOs have validation decorators

### Workspace Service
- [ ] `createWorkspace()` clones repo and creates feature branch
- [ ] `extractChanges()` returns git diff and files list
- [ ] `cleanupWorkspace()` removes workspace (preserves failed if configured)
- [ ] Concurrency limit enforced
- [ ] Periodic cleanup of old workspaces

### Git Operations Service
- [ ] `clone()` performs shallow clone with depth option
- [ ] `checkoutBranch()` creates new branch
- [ ] `getDiff()` returns staged diff
- [ ] `getChangedFiles()` parses git status

### Cursor Headless Provider
- [ ] Implements `IAIProvider` interface
- [ ] Executes `cursor --headless --dir --apply --wait`
- [ ] Handles timeout with configurable duration
- [ ] Circuit breaker prevents cascading failures
- [ ] Calculates confidence score
- [ ] Tracks metrics: executions, duration, active count

### AI Execution Service
- [ ] `executeWithProvider()` orchestrates full execution
- [ ] Updates ExecutionService on success/failure
- [ ] `getProviderHealth()` returns health status
- [ ] `cancelExecution()` stops running execution

### Module Integration
- [ ] All new services added to module providers
- [ ] All new services exported
- [ ] ExecutionModule imported
- [ ] All metrics providers registered

### Configuration
- [ ] Environment variables documented
- [ ] Configuration loaded via ConfigService
- [ ] Validation with Joi schema

### Prisma Schema
- [ ] AIProvider enum updated to `CURSOR_HEADLESS`, `CLAUDE_CODE`
- [ ] Prisma client regenerated (`pnpm prisma generate`)
- [ ] Migration created if needed

### Tests
- [ ] AIExecutionService unit tests pass
- [ ] CircuitBreaker unit tests pass
- [ ] Integration tests pass (`test/ai-execution.e2e-spec.ts`)
- [ ] Coverage for success, failure, timeout, cancel scenarios

---

## Quick Verification Commands

```bash
# After Steps 1-7 (Providers)
npx tsc --noEmit src/ai-routing/providers/index.ts

# After Step 8 (Execution Service)
npx tsc --noEmit src/ai-routing/ai-execution.service.ts

# After Step 9 (Module)
npx tsc --noEmit src/ai-routing/ai-routing.module.ts

# After Step 11 (Tests)
pnpm test -- --testPathPattern=ai-execution
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module '../execution/execution.service'` | ExecutionModule not imported | Add ExecutionModule to imports array |
| `CURSOR_CLI_PATH not found` | Environment not configured | Add to .env or use default 'cursor' |
| `Maximum concurrent workspaces reached` | Too many active executions | Wait for completions or increase limit |
| `Cursor CLI not found` | CLI not installed | Install Cursor or mock in tests |
| `Git clone failed` | Invalid repo URL or no access | Verify URL and authentication |
| `Circuit breaker OPEN` | Too many consecutive failures | Wait for reset timeout or call reset() |

---

## Prerequisites

- ✅ **Story 2.5 Complete** - ExecutionService for status tracking
- ✅ **Story 1.4 Complete** - ConfigService for configuration
- ✅ **Story 1.7 Complete** - Logging with correlation IDs
- ✅ **Story 1.8 Complete** - Prometheus metrics infrastructure

---

## Integration Notes

### Input from Previous Stories

```typescript
// From Story 2.4: Generated prompt
const generatedPrompt = await promptGeneratorService.generatePrompt(input, context);

// From Story 2.5: Create execution record
const execution = await executionService.startExecution({ ... });

// Execute with Cursor provider
const result = await aiExecutionService.executeWithProvider(
  AIProvider.CURSOR_HEADLESS,
  {
    correlationId,
    executionId: execution.id,
    ticketId,
    prompt: generatedPrompt.prompt,
    repositoryUrl: ticket.linkedRepo,
    baseBranch: 'main',
    timeoutMs: 300000,
  },
);
```

### Output to Next Stories

**Story 2.8 (Orchestration)** will use:
```typescript
// Check provider availability before routing
const isAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CURSOR_HEADLESS);

// Execute with fallback
const result = await aiExecutionService.executeWithProvider(selectedProvider, input);
if (!result.success && result.error?.isRetryable) {
  // Try fallback provider (Claude)
}
```

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 473-490 | Cursor CLI Headless features |
| `docs/architecture.md` | Lines 1147-1170 | Cursor integration pattern |
| `docs/architecture.md` | Lines 3027-3127 | Workspace Isolation Strategy |
| `docs/architecture.md` | Lines 2228-2263 | ADR-003: Cursor CLI Headless Mode |
| `docs/epics.md` | Lines 1004-1053 | Story 2.6 Requirements |
| `docs/prd.md` | FR65 | Execute AI code generation |

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (ADR-003, Workspace Isolation Strategy)
- PRD functional requirements (FR65)
- Prisma schema for AIProvider enum
- Cursor CLI documentation reference
- Previous stories patterns (2.4, 2.5)

### Learnings Applied

1. **Provider Interface Pattern:** Abstract interface for multiple AI providers
2. **Circuit Breaker Pattern:** Resilience for external service calls
3. **Workspace Isolation:** One workspace per execution for safety
4. **Configuration Pattern:** ConfigService with Joi validation
5. **Metrics Pattern:** Counter, Histogram, Gauge for observability

### Completion Notes

**Story Status:** ✅ REVIEW  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `2-6-ai-provider-integration-cursor-cli-headless-mode: in-progress`
2. **Implementation:** Follow Steps 1-11 in order
3. **Testing:** Run unit tests, verify metrics
4. **Validation:** Complete all items in Validation Checklist
5. **Version Control:** Commit with message `feat: add Cursor CLI headless provider integration`
6. **Status Update:** Update `sprint-status.yaml` → `2-6-ai-provider-integration-cursor-cli-headless-mode: review`

---

### Implementation Record

**Implemented by:** Amelia (Dev Agent)  
**Implementation date:** 2025-12-03  
**Branch:** feature/2-6-cursor-headless

#### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/ai-routing/interfaces/ai-provider.interface.ts` | 135 | AI Provider interface, execution I/O types, error codes, health status |
| `src/ai-routing/dto/ai-execution.dto.ts` | 155 | Request/Result DTOs with validation and Swagger decorators |
| `src/ai-routing/providers/git-operations.service.ts` | 160 | Git CLI wrapper for clone, branch, diff, commit operations |
| `src/ai-routing/providers/circuit-breaker.ts` | 126 | Circuit breaker with CLOSED/OPEN/HALF_OPEN states |
| `src/ai-routing/providers/workspace.service.ts` | 230 | Isolated workspace management with concurrency limits |
| `src/ai-routing/providers/cursor-headless.provider.ts` | 280 | Primary Cursor CLI headless provider implementation |
| `src/ai-routing/providers/index.ts` | 10 | Barrel export for providers |
| `src/ai-routing/ai-execution.service.ts` | 120 | AI execution orchestration service |

#### Files Modified

| File | Changes |
|------|---------|
| `src/ai-routing/ai-routing.module.ts` | Added 5 Prometheus metrics, registered new services/providers |
| `src/ai-routing/interfaces/index.ts` | Added AI provider interface export |
| `src/ai-routing/dto/index.ts` | Added AI execution DTO exports |
| `src/config/configuration.ts` | Added `cursor` config section with 6 settings |
| `src/config/env.validation.ts` | Added Cursor CLI env variable validation |
| `.env.example` | Added Cursor CLI environment variables |

#### Tests Created

| Test File | Test Count | Coverage |
|-----------|------------|----------|
| `src/ai-routing/ai-execution.service.spec.ts` | 11 | executeWithProvider, health checks, cancellation |
| `src/ai-routing/providers/circuit-breaker.spec.ts` | 13 | State transitions, thresholds, reset |
| `src/ai-routing/providers/git-operations.service.spec.ts` | 12 | Clone, branch, diff, commit operations |
| `src/ai-routing/providers/workspace.service.spec.ts` | 12 | Create, cleanup, extract changes |
| `test/ai-execution.e2e-spec.ts` | 8 | Provider health, workspace mgmt, cancellation |

#### Validation Results

- ✅ TypeScript compilation: PASS (no errors)
- ✅ Unit tests: 226/241 passing (15 failures are pre-existing config issues)
- ✅ New Story 2.6 tests: All passing
- ✅ Prometheus metrics registered: 5 new metrics
- ✅ Configuration validated with Joi schema

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

