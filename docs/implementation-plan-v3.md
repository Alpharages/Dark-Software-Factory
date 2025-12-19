# Implementation Plan: System Flow Diagram v2 → v3 Upgrade

## Executive Summary

This plan outlines the implementation of **11 critical production-ready enhancements** to upgrade the Dark Software Factory from the current v2 flow to the enhanced v3 flow. The v3 architecture introduces intelligent failure handling, dependency management, AI-powered ClickUp integration, and critical safety mechanisms to prevent common failure scenarios.

**Estimated Timeline:** 6-8 weeks
**Team Size:** 3-4 engineers
**Complexity:** High (introduces multiple new AI agents and system components)

---

## User Review Required

> [!IMPORTANT]
> **Breaking Changes & Key Decisions**
>
> 1. **Database Schema Changes:** New tables required for audit logging, file locks, AI cost tracking, and dependency tracking. This requires database migrations.
> 2. ✅ **RESOLVED: Configuration Decisions**
>    - **Cleanup Policy:** Delete failed workspaces (no archiving)
>    - **PR Auto-Merge:** Opt-in (disabled by default, teams can enable per-project)
>    - **AI Cost Budget:** Monthly budget tracking with alerts
>    - **File Lock Timeout:** Default 30 minutes (configurable)
> 3. **AI Provider Selection:** Some v3 agents can use cheaper models (GPT-3.5-turbo) vs. premium (GPT-4). Recommend:
>    - **Simple operations** (status updates, categorization): GPT-3.5-turbo ($0.0005/1K input tokens)
>    - **Complex operations** (code generation, self-heal): GPT-4-turbo ($0.01/1K input tokens)
>    - **Monthly budget:** To be determined based on expected usage
> 4. ✅ **RESOLVED: Storage Infrastructure**
>    - **Storage Location:** Local filesystem only (no cloud upload)
>    - **Compression:** Tar + gzip for space savings
>    - **Retention:** Successful workspaces deleted after 3 days, failed after 7 days
>    - **Disk Monitoring:** Alert at 80% usage, emergency cleanup at 95%

> [!WARNING]
> **Deployment Risk**
>
> This is a **major architectural upgrade** touching every stage of the pipeline. Recommend:
>
> - **Staged rollout:** Deploy to staging → 10% production → 100% over 2 weeks
> - **Feature flags:** All v3 features behind toggles for quick rollback
> - **Parallel run:** Keep v2 logic available as fallback for first 2 weeks

> [!CAUTION]
> **Data Migration Considerations**
>
> Existing in-flight tickets during deployment:
>
> - Need migration strategy for tickets currently in the pipeline
> - File locks don't exist for pre-v3 tickets - how to handle?
> - Audit logs can't be retroactively generated - acceptable?

---

## Proposed Changes

The implementation is organized into **4 phases** with clear dependencies and success criteria.

### Phase 1: Foundation & Safety (Week 1-2)

Core data models, audit infrastructure, and safety mechanisms that other features depend on.

---

#### Database Schema Changes

##### [NEW] [prisma/schema.prisma](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma)

Add new models for v3 features:

```prisma
// AI Decision Audit Logging
model AIDecisionLog {
  id           String   @id @default(uuid())
  timestamp    DateTime @default(now())
  agentName    String   // e.g., "AI ClickUp Agent"
  action       String   // e.g., "status_update"
  reasoning    String   @db.Text
  ticketId     String
  executionId  String?
  inputData    Json
  outputData   Json
  confidence   Float    // 0-1 range

  execution    Execution? @relation(fields: [executionId], references: [id])

  @@index([ticketId])
  @@index([executionId])
  @@index([timestamp])
  @@index([agentName])
}

// File Lock Manager
model FileLock {
  id                String   @id @default(uuid())
  ticketId          String
  executionId       String
  filePath          String
  lockedAt          DateTime @default(now())
  expectedReleaseAt DateTime
  status            FileLockStatus @default(LOCKED)

  execution         Execution @relation(fields: [executionId], references: [id])

  @@unique([ticketId, filePath])
  @@index([status])
  @@index([filePath])
}

enum FileLockStatus {
  LOCKED
  RELEASED
}

// AI Cost Tracking
model AICostLog {
  id           String   @id @default(uuid())
  timestamp    DateTime @default(now())
  ticketId     String
  executionId  String?
  agentName    String
  modelUsed    String   // e.g., "gpt-4", "gpt-3.5-turbo"
  tokensInput  Int
  tokensOutput Int
  costUSD      Decimal  @db.Decimal(10, 6)
  duration     Int      // milliseconds
  purpose      String   // e.g., "code_generation", "status_update"

  execution    Execution? @relation(fields: [executionId], references: [id])

  @@index([ticketId])
  @@index([timestamp])
  @@index([agentName])
}

// Dependency Tracking
model TicketDependency {
  id              String   @id @default(uuid())
  ticketId        String
  dependsOnId     String   // ClickUp task ID this ticket depends on
  status          DependencyStatus @default(WAITING)
  estimatedReady  DateTime?
  createdAt       DateTime @default(now())
  resolvedAt      DateTime?

  @@unique([ticketId, dependsOnId])
  @@index([status])
}

enum DependencyStatus {
  WAITING
  READY
  CIRCULAR_DETECTED
}

// Storage Management
model WorkspaceArchive {
  id              String   @id @default(uuid())
  executionId     String   @unique
  workspacePath   String
  archivePath     String?  // Local compressed path
  remoteUrl       String?  // S3/GCS URL
  sizeBytes       BigInt
  compressedSize  BigInt?
  status          ArchiveStatus @default(PENDING)
  createdAt       DateTime @default(now())
  archivedAt      DateTime?
  deletedAt       DateTime?

  execution       Execution @relation(fields: [executionId], references: [id])

  @@index([status])
  @@index([createdAt])
}

enum ArchiveStatus {
  PENDING
  COMPRESSED
  UPLOADED
  DELETED
}
```

Update existing `Execution` model:

```prisma
model Execution {
  // ... existing fields ...

  // v3 additions
  baseBranch          String?           // AI-selected base branch
  branchSelectionLog  String?   @db.Text // AI reasoning for branch selection
  fileModifications   Json?             // Predicted files to modify
  riskLevel           PRRiskLevel?
  circularDepDetected Boolean   @default(false)

  // Relations
  aiDecisionLogs      AIDecisionLog[]
  fileLocks           FileLock[]
  aiCostLogs          AICostLog[]
  archive             WorkspaceArchive?
}

enum PRRiskLevel {
  LOW
  MEDIUM
  HIGH
}
```

**Migration Script:**

- Create migration: `pnpm prisma migrate dev --name add_v3_models`
- Generate Prisma client: `pnpm prisma generate`

---

#### [NEW] AI Decision Audit Service

Create comprehensive audit logging service.

##### [NEW] [src/audit/ai-decision-logger.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/audit/ai-decision-logger.service.ts)

```typescript
interface AIDecisionInput {
  agentName: string;
  action: string;
  reasoning: string;
  ticketId: string;
  executionId?: string;
  inputData: Record<string, any>;
  outputData: Record<string, any>;
  confidence: number; // 0-1
}

@Injectable()
export class AIDecisionLoggerService {
  constructor(private prisma: PrismaService) {}

  async logDecision(input: AIDecisionInput): Promise<AIDecisionLog> {
    // Create audit log entry
    // Emit Prometheus metric
    // Alert if confidence < 0.5
  }

  async getDecisionTimeline(ticketId: string): Promise<AIDecisionLog[]> {
    // Retrieve chronological decision history
  }

  async getLowConfidenceDecisions(threshold: number = 0.5): Promise<AIDecisionLog[]> {
    // Find decisions requiring review
  }
}
```

##### [NEW] [src/audit/ai-decision-logger.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/audit/ai-decision-logger.module.ts)

Standard NestJS module export.

---

#### [NEW] AI Progress Validator

Prevents infinite loops in AI self-healing.

##### [NEW] [src/ai-monitoring/progress-validator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-monitoring/progress-validator.service.ts)

```typescript
interface ProgressMetrics {
  executionId: string;
  errorCountBefore: number;
  errorCountAfter: number;
  fixAttempt: number;
  totalFixTime: number; // milliseconds
  isProgressing: boolean;
}

@Injectable()
export class ProgressValidatorService {
  private readonly MAX_FIX_TIME_MS = 10 * 60 * 1000; // 10 minutes

  async validateProgress(
    executionId: string,
    errorsBefore: number,
    errorsAfter: number,
    attemptNumber: number,
    startTime: Date,
  ): Promise<{
    shouldContinue: boolean;
    reason: string;
    escalate: boolean;
  }> {
    const totalTime = Date.now() - startTime.getTime();

    // Not making progress: errors increased or stayed same
    if (errorsAfter >= errorsBefore) {
      return {
        shouldContinue: false,
        reason: 'Not making progress - errors not decreasing',
        escalate: true,
      };
    }

    // Time limit exceeded
    if (totalTime > this.MAX_FIX_TIME_MS) {
      return {
        shouldContinue: false,
        reason: 'Time limit exceeded (10 minutes)',
        escalate: true,
      };
    }

    // Making progress, continue
    return {
      shouldContinue: true,
      reason: 'Making progress - error count reduced',
      escalate: false,
    };
  }

  async trackFixAttempt(metrics: ProgressMetrics): Promise<void> {
    // Log to database and Prometheus
  }
}
```

##### [NEW] [src/ai-monitoring/progress-validator.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-monitoring/progress-validator.module.ts)

---

### Phase 2: Dependency & Conflict Management (Week 2-3)

Handle task dependencies and prevent concurrent modification conflicts.

---

#### [NEW] Circular Dependency Detector

##### [NEW] [src/dependencies/circular-dependency-detector.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dependencies/circular-dependency-detector.service.ts)

```typescript
interface DependencyNode {
  ticketId: string;
  dependsOn: string[];
}

interface CircularDependencyResult {
  hasCircular: boolean;
  cycle?: string[]; // Ticket IDs forming the cycle
  visualization?: string;
}

@Injectable()
export class CircularDependencyDetectorService {
  private aiDecisionLogger: AIDecisionLoggerService;

  async detectCircularDependencies(
    ticketId: string,
    clickUpDependencies: string[],
  ): Promise<CircularDependencyResult> {
    // Build dependency graph
    const graph = await this.buildDependencyGraph(ticketId, clickUpDependencies);

    // Run DFS to detect cycles
    const cycle = this.detectCycleDFS(graph, ticketId);

    if (cycle) {
      // Log AI decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'AI Circular Dependency Detector',
        action: 'circular_dependency_detected',
        reasoning: `Circular dependency detected: ${cycle.join(' → ')}`,
        ticketId,
        inputData: { dependencies: clickUpDependencies },
        outputData: { cycle },
        confidence: 1.0,
      });

      return {
        hasCircular: true,
        cycle,
        visualization: this.visualizeCycle(cycle),
      };
    }

    return { hasCircular: false };
  }

  private detectCycleDFS(
    graph: Map<string, string[]>,
    start: string,
    visited = new Set<string>(),
    stack = new Set<string>(),
  ): string[] | null {
    // DFS implementation to find cycles
    // Returns cycle path if found, null otherwise
  }

  private async markTicketsAsCircular(cycle: string[]): Promise<void> {
    // Update all tickets in cycle to CIRCULAR_DETECTED status
    // Send alerts to PM
  }
}
```

##### [NEW] [src/dependencies/dependency-manager.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dependencies/dependency-manager.service.ts)

```typescript
@Injectable()
export class DependencyManagerService {
  async checkDependencies(ticketId: string): Promise<{
    hasUnresolvedDeps: boolean;
    dependencies: TicketDependency[];
    estimatedReady?: Date;
  }> {
    // Fetch ClickUp dependencies
    // Check each dependency status
    // Calculate ETA if waiting
  }

  async calculateETA(dependencies: TicketDependency[]): Promise<Date> {
    // Use historical data + current pipeline position
    // Return estimated completion time
  }

  async notifyDependentTickets(ticketId: string): Promise<void> {
    // Find tickets waiting on this one
    // Re-queue them for processing
  }
}
```

---

#### [NEW] File Lock Manager

##### [NEW] [src/file-locks/file-lock-manager.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/file-locks/file-lock-manager.service.ts)

```typescript
interface FileLockRequest {
  ticketId: string;
  executionId: string;
  filePaths: string[];
  estimatedDuration: number; // minutes
}

interface LockResult {
  acquired: boolean;
  conflicts?: string[]; // Conflicting file paths
  waitingFor?: string[]; // Ticket IDs holding locks
  estimatedReleaseTime?: Date;
}

@Injectable()
export class FileLockManagerService {
  async predictFileModifications(
    ticketDescription: string,
    codebaseContext: string,
  ): Promise<string[]> {
    // Use AI to predict which files will be modified
    // Return list of file paths
  }

  async acquireLocks(request: FileLockRequest): Promise<LockResult> {
    return await this.prisma.$transaction(async (tx) => {
      // Check for existing locks on requested files
      const conflicts = await this.checkConflicts(request.filePaths, tx);

      if (conflicts.length > 0) {
        return {
          acquired: false,
          conflicts: conflicts.map((c) => c.filePath),
          waitingFor: conflicts.map((c) => c.ticketId),
          estimatedReleaseTime: this.calculateETA(conflicts),
        };
      }

      // Acquire locks
      await this.createLocks(request, tx);

      return { acquired: true };
    });
  }

  async releaseLocks(executionId: string): Promise<void> {
    // Release all locks for execution
    // Notify waiting tickets
    await this.dependencyManager.notifyDependentTickets(executionId);
  }

  private async checkConflicts(filePaths: string[], tx: PrismaTransaction): Promise<FileLock[]> {
    return await tx.fileLock.findMany({
      where: {
        filePath: { in: filePaths },
        status: 'LOCKED',
      },
    });
  }
}
```

##### [NEW] [src/file-locks/file-lock-manager.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/file-locks/file-lock-manager.module.ts)

---

#### [MODIFY] Ticket Intake Consumer

Update to add dependency and conflict checks.

##### [MODIFY] [src/ticket-intake/ticket-intake.consumer.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ticket-intake/ticket-intake.consumer.ts)

```typescript
@Injectable()
export class TicketIntakeConsumer {
  // Inject new services
  constructor(
    // ... existing dependencies ...
    private circularDepDetector: CircularDependencyDetectorService,
    private dependencyManager: DependencyManagerService,
    private fileLockManager: FileLockManagerService,
    private aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async processTicket(task: ClickUpTask) {
    // 1. Existing validation

    // 2. NEW: Check circular dependencies
    const circularCheck = await this.circularDepDetector.detectCircularDependencies(
      task.id,
      task.dependencies,
    );

    if (circularCheck.hasCircular) {
      await this.handleCircularDependency(task, circularCheck.cycle);
      return; // End processing
    }

    // 3. NEW: Check if dependencies are resolved
    const depStatus = await this.dependencyManager.checkDependencies(task.id);

    if (depStatus.hasUnresolvedDeps) {
      await this.requeueWithETA(task, depStatus.estimatedReady);
      return; // Re-queue
    }

    // 4. NEW: Predict file modifications and check locks
    const filesToModify = await this.fileLockManager.predictFileModifications(
      task.description,
      await this.getCodebaseContext(),
    );

    const lockResult = await this.fileLockManager.acquireLocks({
      ticketId: task.id,
      executionId: execution.id,
      filePaths: filesToModify,
      estimatedDuration: 30, // minutes
    });

    if (!lockResult.acquired) {
      await this.queueUntilFilesAvailable(task, lockResult);
      return; // Queue
    }

    // 5. NEW: AI updates ClickUp status
    await this.updateClickUpStatus(
      task,
      'In Progress',
      'Dependencies resolved, file locks acquired',
    );

    // 6. Publish to ai-execution-queue
  }
}
```

---

### Phase 3: AI Enhancements & Self-Healing (Week 3-5)

Enhanced AI capabilities with cost tracking and intelligent recovery.

---

#### [NEW] AI Cost Tracking Service

##### [NEW] [src/ai-cost/ai-cost-tracker.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-cost/ai-cost-tracker.service.ts)

```typescript
interface CostCalculation {
  modelUsed: string;
  tokensInput: number;
  tokensOutput: number;
  costUSD: number;
}

@Injectable()
export class AICostTrackerService {
  private readonly PRICING = {
    'gpt-4': { input: 0.03 / 1000, output: 0.06 / 1000 },
    'gpt-4-turbo': { input: 0.01 / 1000, output: 0.03 / 1000 },
    'gpt-3.5-turbo': { input: 0.0005 / 1000, output: 0.0015 / 1000 },
  };

  async trackCost(params: {
    ticketId: string;
    executionId?: string;
    agentName: string;
    modelUsed: string;
    tokensInput: number;
    tokensOutput: number;
    duration: number;
    purpose: string;
  }): Promise<AICostLog> {
    const pricing = this.PRICING[params.modelUsed];
    const costUSD = params.tokensInput * pricing.input + params.tokensOutput * pricing.output;

    const log = await this.prisma.aICostLog.create({
      data: { ...params, costUSD },
    });

    // Check budget alerts
    await this.checkBudgetAlerts(params.ticketId, costUSD);

    return log;
  }

  async getCostSummary(ticketId: string): Promise<{
    totalCost: number;
    breakdown: Record<string, number>;
  }> {
    // Aggregate costs by agent
  }

  private async checkBudgetAlerts(ticketId: string, newCost: number): Promise<void> {
    // Check if ticket/daily/monthly budget exceeded
    // Send alerts if thresholds crossed
  }
}
```

##### [NEW] [src/ai-cost/cost-optimizer.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-cost/cost-optimizer.service.ts)

```typescript
@Injectable()
export class CostOptimizerService {
  selectModel(purpose: string, complexity: 'low' | 'medium' | 'high'): string {
    // Simple tasks: use GPT-3.5-turbo
    if (purpose === 'status_update' || purpose === 'categorization') {
      return 'gpt-3.5-turbo';
    }

    // Complex tasks: use GPT-4
    if (purpose === 'code_generation' || complexity === 'high') {
      return 'gpt-4-turbo';
    }

    return 'gpt-3.5-turbo';
  }

  async cachePrompt(key: string, response: string): Promise<void> {
    // Cache common AI responses (e.g., dependency analysis)
  }

  async getCachedResponse(key: string): Promise<string | null> {
    // Return cached response if available
  }
}
```

---

#### [NEW] AI Branch Strategist

##### [NEW] [src/git/branch-strategist.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/git/branch-strategist.service.ts)

```typescript
@Injectable()
export class BranchStrategistService {
  async selectBaseBranch(
    ticketId: string,
    dependencies: TicketDependency[],
  ): Promise<{
    branch: string;
    reasoning: string;
  }> {
    // If no dependencies, use main
    if (dependencies.length === 0) {
      return { branch: 'main', reasoning: 'No dependencies, using main branch' };
    }

    // If dependencies exist, use their branch
    const dependencyBranches = await this.getDependencyBranches(dependencies);

    if (dependencyBranches.length === 1) {
      return {
        branch: dependencyBranches[0],
        reasoning: `Following dependency chain, using ${dependencyBranches[0]}`,
      };
    }

    // Multiple dependency branches - need merge
    return {
      branch: 'main',
      reasoning: 'Multiple dependency branches detected, using main and will merge dependencies',
    };
  }
}
```

---

#### [MODIFY] AI Execution Consumer

Add self-healing with progress validation.

##### [MODIFY] [src/ai-execution/ai-execution.consumer.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-execution/ai-execution.consumer.ts)

```typescript
@Injectable()
export class AIExecutionConsumer {
  constructor(
    // ... existing ...
    private progressValidator: ProgressValidatorService,
    private aiCostTracker: AICostTrackerService,
    private costOptimizer: CostOptimizerService,
    private aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async executeAI(execution: Execution) {
    const startTime = Date.now();

    // Track cost - start
    const model = this.costOptimizer.selectModel('code_generation', 'high');

    try {
      const result = await this.cursorProvider.executePrompt(/* ... */);

      // Track cost - end
      await this.aiCostTracker.trackCost({
        ticketId: execution.ticketId,
        executionId: execution.id,
        agentName: 'AI Execution Consumer',
        modelUsed: model,
        tokensInput: result.tokensUsed.input,
        tokensOutput: result.tokensUsed.output,
        duration: Date.now() - startTime,
        purpose: 'code_generation',
      });

      // Success path
      await this.publishToQA(execution);
    } catch (error) {
      await this.handleAIFailure(execution, error, 1);
    }
  }

  private async handleAIFailure(
    execution: Execution,
    error: Error,
    attemptNumber: number,
  ): Promise<void> {
    // Categorize failure
    const category = await this.categorizeFailure(error);

    if (category === 'transient') {
      // Retry logic (existing)
      return;
    }

    if (category === 'code_issue') {
      // NEW: AI Self-Heal with progress validation
      const errorsBefore = await this.countErrors(execution);

      await this.attemptSelfHeal(execution, error);

      const errorsAfter = await this.countErrors(execution);

      const validation = await this.progressValidator.validateProgress(
        execution.id,
        errorsBefore,
        errorsAfter,
        attemptNumber,
        execution.createdAt,
      );

      if (validation.escalate) {
        await this.escalateToHuman(execution, validation.reason);
        return;
      }

      if (validation.shouldContinue) {
        // Retry with fix
        await this.executeAI(execution);
      }
    }
  }

  private async attemptSelfHeal(execution: Execution, error: Error): Promise<void> {
    // Use AI to analyze and fix code
    const fix = await this.aiProvider.analyzeFix({
      error: error.message,
      code: execution.generatedCode,
      context: execution.prompt,
    });

    // Apply fix
    await this.applyFix(execution, fix);

    // Log decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'AI Self-Heal',
      action: 'code_fix_applied',
      reasoning: fix.reasoning,
      ticketId: execution.ticketId,
      executionId: execution.id,
      inputData: { error: error.message },
      outputData: { fix: fix.changes },
      confidence: fix.confidence,
    });
  }
}
```

---

#### [MODIFY] QA Orchestrator

Add self-healing for QA failures.

##### [MODIFY] [src/qa-automation/qa-orchestrator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/qa-automation/qa-orchestrator.service.ts)

Similar pattern: add progress validation and AI fixes for test/lint failures.

---

### Phase 4: Observability & Operational Features (Week 5-6)

Dashboard, monitoring, storage management, and production readiness.

---

#### [NEW] PR Risk Assessor

##### [NEW] [src/github/pr-risk-assessor.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/pr-risk-assessor.service.ts)

```typescript
enum PRRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

interface RiskAssessment {
  riskLevel: PRRiskLevel;
  score: number;
  factors: string[];
  recommendation: string;
}

@Injectable()
export class PRRiskAssessorService {
  private readonly CRITICAL_PATHS = ['auth/', 'payment/', 'security/', 'database/migrations/'];

  async assessPR(pr: PullRequest): Promise<RiskAssessment> {
    let score = 0;
    const factors: string[] = [];

    // Lines changed
    const totalLines = pr.additions + pr.deletions;
    if (totalLines > 200) {
      score += 30;
      factors.push(`Large change: ${totalLines} lines`);
    } else if (totalLines > 50) {
      score += 15;
      factors.push(`Medium change: ${totalLines} lines`);
    }

    // Files changed
    if (pr.files.length > 5) {
      score += 20;
      factors.push(`Multiple files: ${pr.files.length}`);
    } else if (pr.files.length > 3) {
      score += 10;
      factors.push(`Several files: ${pr.files.length}`);
    }

    // Critical files
    const criticalFiles = pr.files.filter((f) =>
      this.CRITICAL_PATHS.some((path) => f.filename.startsWith(path)),
    );
    if (criticalFiles.length > 0) {
      score += 40;
      factors.push(`Critical files modified: ${criticalFiles.map((f) => f.filename).join(', ')}`);
    }

    // Test coverage
    if (pr.coverage?.delta < 0) {
      score += 25;
      factors.push(`Coverage decreased by ${Math.abs(pr.coverage.delta)}%`);
    }

    // Test failures
    if (!pr.checks?.tests?.passed) {
      score += 50;
      factors.push('Tests failing');
    }

    // Security issues
    if (pr.checks?.security?.issues?.length > 0) {
      score += 50;
      factors.push(`${pr.checks.security.issues.length} security issues`);
    }

    // Determine risk level
    let riskLevel: PRRiskLevel;
    let recommendation: string;

    if (score >= 50) {
      riskLevel = PRRiskLevel.HIGH;
      recommendation = 'Require 2 approvals before merge';
    } else if (score >= 20) {
      riskLevel = PRRiskLevel.MEDIUM;
      recommendation = 'Require 1 approval before merge';
    } else {
      riskLevel = PRRiskLevel.LOW;
      recommendation = 'Safe for auto-merge';
    }

    return { riskLevel, score, factors, recommendation };
  }
}
```

---

#### [NEW] Storage Manager

##### [NEW] [src/storage/storage-manager.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/storage/storage-manager.service.ts)

```typescript
@Injectable()
export class StorageManagerService {
  private readonly ARCHIVE_DIR = './workspace-archives';

  constructor(private configService: ConfigService) {}

  async archiveWorkspace(
    execution: Execution,
    workspacePath: string,
    success: boolean,
  ): Promise<WorkspaceArchive> {
    // 1. Compress workspace
    const compressedPath = await this.compressWorkspace(workspacePath, execution.id);

    // 2. Create archive record
    const archive = await this.prisma.workspaceArchive.create({
      data: {
        executionId: execution.id,
        workspacePath,
        archivePath: compressedPath,
        remoteUrl: null, // Local storage only
        sizeBytes: await this.getDirectorySize(workspacePath),
        compressedSize: await this.getFileSize(compressedPath),
        status: 'COMPRESSED',
      },
    });

    // 3. Schedule cleanup based on success/failure
    const retentionDays = success ? 3 : 7;
    await this.scheduleCleanup(archive, retentionDays);

    // 4. Delete original workspace immediately
    await this.removeDirectory(workspacePath);

    return archive;
  }

  private async compressWorkspace(path: string, executionId: string): Promise<string> {
    await fs.mkdir(this.ARCHIVE_DIR, { recursive: true });
    const tarPath = `${this.ARCHIVE_DIR}/${executionId}.tar.gz`;

    // Use tar + gzip
    await this.exec(`tar -czf ${tarPath} -C ${dirname(path)} ${basename(path)}`);
    return tarPath;
  }

  async cleanupOldArchives(): Promise<void> {
    // Run daily via cron
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7); // Delete archives > 7 days old

    const oldArchives = await this.prisma.workspaceArchive.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { not: 'DELETED' },
      },
    });

    for (const archive of oldArchives) {
      if (archive.archivePath && (await this.fileExists(archive.archivePath))) {
        await fs.unlink(archive.archivePath);
      }

      await this.prisma.workspaceArchive.update({
        where: { id: archive.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    }
  }

  async monitorDiskUsage(): Promise<void> {
    // Run every hour
    const usage = await this.getDiskUsage();

    if (usage.percentUsed > 95) {
      await this.emergencyCleanup();
    } else if (usage.percentUsed > 80) {
      await this.sendAlert('Disk usage high', usage);
    }
  }

  private async emergencyCleanup(): Promise<void> {
    // Delete oldest archives first (regardless of retention policy)
    const archives = await this.prisma.workspaceArchive.findMany({
      where: { status: 'COMPRESSED' },
      orderBy: { createdAt: 'asc' },
      take: 50, // Delete up to 50 oldest
    });

    for (const archive of archives) {
      if (archive.archivePath && (await this.fileExists(archive.archivePath))) {
        await fs.unlink(archive.archivePath);
        await this.prisma.workspaceArchive.update({
          where: { id: archive.id },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
      }

      // Check if space freed
      const usage = await this.getDiskUsage();
      if (usage.percentUsed < 80) break;
    }
  }

  private async getDiskUsage(): Promise<{ percentUsed: number; available: number; total: number }> {
    // Get disk usage stats for root partition
    const stats = await this.exec('df -h / | tail -1 | awk \'{print $5 " " $4 " " $2}\'');
    const [percentStr, available, total] = stats.trim().split(' ');
    return {
      percentUsed: parseInt(percentStr.replace('%', '')),
      available: this.parseSize(available),
      total: this.parseSize(total),
    };
  }
}
```

**Key Changes for Local Storage:**

- ✅ No S3/cloud dependencies
- ✅ Archives stored in `./workspace-archives` directory
- ✅ Automatic cleanup: successful (3 days), failed (7 days)
- ✅ Emergency cleanup when disk > 95% full
- ✅ Daily cron job cleans old archives

---

#### [NEW] Real-Time Observability Dashboard

##### [NEW] [src/dashboard/dashboard.controller.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboard/dashboard.controller.ts)

```typescript
@Controller('api/dashboard')
export class DashboardController {
  @Get('ticket-timeline/:ticketId')
  async getTicketTimeline(@Param('ticketId') ticketId: string) {
    // Return chronological events for a ticket
    return await this.dashboardService.getTicketTimeline(ticketId);
  }

  @Get('queue-metrics')
  async getQueueMetrics() {
    // Current queue depths, wait times, throughput
    return await this.dashboardService.getQueueMetrics();
  }

  @Get('ai-decisions')
  async getAIDecisions(@Query() filters: AIDecisionFilters) {
    // Live stream of AI decisions with filtering
    return await this.aiDecisionLogger.getDecisions(filters);
  }

  @Get('file-locks')
  async getFileLocks() {
    // Current file locks and waiting tickets
    return await this.fileLockManager.getCurrentLocks();
  }

  @Get('system-health')
  async getSystemHealth() {
    // Success rates, processing times, error trends
    return await this.dashboardService.getSystemHealth();
  }

  @Get('cost-summary')
  async getCostSummary(@Query('period') period: string) {
    // AI cost breakdown
    return await this.aiCostTracker.getSummary(period);
  }
}
```

##### [NEW] Frontend Dashboard (React/Next.js)

Create comprehensive dashboard UI with:

- Ticket timeline view
- Live queue monitoring
- AI agent activity log
- File lock visualization
- System health metrics
- Cost tracking charts
- Configuration UI for all v3 settings

---

#### [NEW] Post-Deployment Health Monitoring

##### [NEW] [src/deployment/health-monitor.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/deployment/health-monitor.service.ts)

```typescript
@Injectable()
export class HealthMonitorService {
  async monitorDeployment(
    execution: Execution,
    deploymentUrl: string,
  ): Promise<{
    healthy: boolean;
    metrics: HealthMetrics;
    shouldRollback: boolean;
  }> {
    const monitorDuration = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();

    // Get baseline metrics before deployment
    const baseline = await this.getBaselineMetrics(deploymentUrl);

    // Monitor for 5 minutes
    while (Date.now() - startTime < monitorDuration) {
      await this.sleep(30000); // Check every 30s

      const current = await this.getCurrentMetrics(deploymentUrl);
      const comparison = this.compareMetrics(baseline, current);

      if (comparison.shouldRollback) {
        await this.triggerRollback(execution);
        return {
          healthy: false,
          metrics: current,
          shouldRollback: true,
        };
      }
    }

    return {
      healthy: true,
      metrics: await this.getCurrentMetrics(deploymentUrl),
      shouldRollback: false,
    };
  }

  private compareMetrics(
    baseline: HealthMetrics,
    current: HealthMetrics,
  ): {
    shouldRollback: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Error rate check
    const errorRateIncrease = ((current.errorRate - baseline.errorRate) / baseline.errorRate) * 100;

    if (errorRateIncrease > 50) {
      reasons.push(`Error rate increased by ${errorRateIncrease.toFixed(1)}%`);
    }

    // Latency check
    const latencyIncrease = current.p95Latency - baseline.p95Latency;
    if (latencyIncrease > 200) {
      reasons.push(`P95 latency increased by ${latencyIncrease}ms`);
    }

    // 5xx errors
    if (current.server5xxCount > 10) {
      reasons.push(`${current.server5xxCount} 5xx errors detected`);
    }

    return {
      shouldRollback: reasons.length > 0,
      reasons,
    };
  }
}
```

---

### Phase 5: Configuration & Polish (Week 6-8)

Admin UI, feature flags, and production rollout.

---

#### [NEW] Configuration Dashboard UI

Create admin panel for configuring all v3 features:

1. **Workspace Cleanup Settings**
2. **AI Self-Healing Configuration**
3. **Dependency & Conflict Management**
4. **PR Auto-Merge Settings**
5. **AI Cost Tracking & Budgets**
6. **Audit & Observability Settings**
7. **Post-Deployment Monitoring**

See detailed UI mockups in system-flow-diagram-v3.md lines 649-820.

---

#### [NEW] Feature Flags

##### [NEW] [src/config/feature-flags.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/config/feature-flags.service.ts)

```typescript
@Injectable()
export class FeatureFlagsService {
  private flags = {
    v3_circular_dependency_detection: false,
    v3_file_lock_manager: false,
    v3_ai_self_heal: false,
    v3_pr_auto_merge: false,
    v3_cost_tracking: true, // Always on
    v3_audit_logging: true, // Always on
    v3_health_monitoring: false,
    v3_storage_manager: false,
  };

  isEnabled(flag: keyof typeof this.flags): boolean {
    return this.flags[flag];
  }

  async setFlag(flag: keyof typeof this.flags, enabled: boolean): Promise<void> {
    this.flags[flag] = enabled;
    await this.persistToDatabase(flag, enabled);
  }
}
```

Use feature flags to gradually roll out v3 features.

---

## Verification Plan

### Automated Tests

#### Unit Tests

- All new services have >80% code coverage
- Test circular dependency detection with various graph structures
- Test progress validator with edge cases (no progress, timeout, success)
- Test file lock manager with concurrent requests
- Test cost tracker calculations
- Test risk assessor scoring algorithm

#### Integration Tests

- End-to-end flow with circular dependency
- End-to-end flow with file conflicts
- End-to-end flow with AI self-heal success
- End-to-end flow with AI self-heal escalation
- PR auto-merge flow for low/medium/high risk
- Storage manager compression and upload

#### Load Tests

- 100 concurrent tickets with dependencies
- File lock manager under high contention
- Cost tracking performance (10k+ logs)
- Dashboard query performance

### Manual Verification

#### Phase 1 Validation

- [ ] Create ticket with circular dependency → verify detection and alert
- [ ] Create AI execution that fails initially → verify progress validation works
- [ ] Check audit logs in database → verify all decisions logged

#### Phase 2 Validation

- [ ] Create two tickets modifying same file → verify file lock queueing
- [ ] Create ticket with unresolved dependency → verify ETA calculation and re-queue
- [ ] Resolve dependency → verify dependent ticket auto-proceeds

#### Phase 3 Validation

- [ ] Run AI execution → verify cost logged correctly
- [ ] Trigger AI self-heal → verify progress validation prevents infinite loop
- [ ] Check AI decision audit → verify reasoning is clear

#### Phase 4 Validation

- [ ] Create low-risk PR → verify auto-merge
- [ ] Create high-risk PR → verify human review required
- [ ] Deploy code → verify health monitoring detects issues
- [ ] Fill disk to 85% → verify storage manager cleanup

#### Phase 5 Validation

- [ ] Toggle feature flags → verify graceful degradation
- [ ] Use configuration dashboard → verify all settings persist
- [ ] Review observability dashboard → verify all metrics display

### Deployment Strategy

**Staging Environment (Week 6)**

- Deploy all v3 features with feature flags OFF
- Enable features one by one
- Run full test suite
- Manual QA testing

**Production Canary (Week 7)**

- Deploy to production with ALL v3 features disabled
- Enable cost tracking + audit logging only (low risk)
- Enable circular dependency detection (10% of traffic)
- Enable file lock manager (10% of traffic)
- Monitor for 48 hours

**Production Rollout (Week 8)**

- Gradually enable features:
  - Day 1: 25% traffic
  - Day 3: 50% traffic
  - Day 5: 75% traffic
  - Day 7: 100% traffic
- Monitor metrics at each step
- Rollback capability via feature flags

---

## Success Metrics

### KPIs to Track

**Reliability:**

- ✅ Zero deadlocks from circular dependencies
- ✅ 80% reduction in merge conflicts (via file locking)
- ✅ 50% reduction in "stuck" AI executions (via progress validation)

**Efficiency:**

- ✅ 50% reduction in wasted AI costs (via progress validation + cost optimization)
- ✅ 2x faster PR merge time (via auto-merge)
- ✅ 30% improvement in ticket throughput

**Observability:**

- ✅ 100% of AI decisions logged with reasoning
- ✅ Full ticket timeline visibility
- ✅ Real-time system health dashboard

**Operational:**

- ✅ Zero disk outages (via storage manager)
- ✅ AI cost tracking with budget alerts
- ✅ Auto-rollback on deployment failures

---

## Rollback Plan

If critical issues are discovered:

1. **Immediate:** Disable feature flags for problematic features
2. **Database:** v3 tables are additive - no rollback needed
3. **Code:** Git revert to previous version if necessary
4. **Data:** Audit logs and cost logs are append-only - safe to keep

**Rollback Decision Criteria:**

- System-wide error rate increases >20%
- Data corruption detected
- Critical security vulnerability
- Unrecoverable performance degradation

---

## ~~Open Questions~~ RESOLVED

All critical decisions have been made:

1. ✅ **Cloud Storage Provider:** Local filesystem only (no cloud upload)
2. ✅ **AI Budget:** Monthly budget tracking with alerts
3. ✅ **Auto-Merge:** Opt-in (disabled by default, teams can enable per-project)
4. ✅ **Cleanup Policy:** Delete failed workspaces after 7 days (no archiving to cloud)
5. **Alert Channels:** Slack/Email/PagerDuty for critical failures? _(Still needs input)_

---

## Timeline Summary

| Phase       | Duration | Deliverables                                                    |
| ----------- | -------- | --------------------------------------------------------------- |
| **Phase 1** | Week 1-2 | Database schema, audit logging, progress validator              |
| **Phase 2** | Week 2-3 | Circular dep detector, file lock manager, dependency management |
| **Phase 3** | Week 3-5 | AI cost tracking, self-healing enhancements, branch strategist  |
| **Phase 4** | Week 5-6 | Risk assessor, storage manager, health monitoring, dashboard    |
| **Phase 5** | Week 6-8 | Configuration UI, feature flags, staging → production rollout   |

**Total: 6-8 weeks** (depending on team size and QA cycles)
