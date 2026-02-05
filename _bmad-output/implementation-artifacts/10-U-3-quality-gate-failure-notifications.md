# Story 10-U-3: Quality Gate Failure Notifications

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Product Manager or Lead QA**,
I want to **receive real-time notifications when quality gates fail**,
so that **I can immediately take corrective action, approve exceptions, or escalate issues without waiting for batch reports or manual status checks**.

## Acceptance Criteria

1. **Quality Gate Failure Event Detection**
   - `QualityGatesService` must emit real-time WebSocket events for ALL quality gate failures
   - Event triggers include:
     - Linting failures (ESLint, Prettier, or language-specific linters)
     - Test failures (unit tests, integration tests failing or below thresholds)
     - Code coverage below configured minimum threshold
     - Security scan failures (OWASP, dependency vulnerabilities)
     - Complexity violations (cyclomatic complexity exceeding limits)
   - Events must be emitted immediately after the quality check completes and BEFORE execution state transitions to FAILED
   - Event payload must include detailed failure information for actionable notifications

2. **QA Failure Event Types Specification**
   - **`qa.gate_failed`**: Emitted when any quality gate check fails
     - Payload: `{ executionId, ticketId, projectId, gateType, failureDetails, severity, failedAt }`
     - `gateType`: Enum - 'LINTING', 'TEST', 'COVERAGE', 'SECURITY', 'COMPLEXITY', 'CUSTOM'
     - `failureDetails`: Object with check-specific failure information
     - `severity`: Enum - 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW' (based on gate configuration)
   - **`qa.all_gates_failed`**: Emitted when ALL quality gates fail (complete QA failure)
     - Payload: `{ executionId, ticketId, projectId, failedGates[], summary, failedAt }`
     - `failedGates[]`: Array of individual gate failure objects
     - `summary`: Aggregated statistics (total failures, severity breakdown)
   - **`qa.gate_blocked`**: Emitted when quality gate blocks deployment (FR70)
     - Payload: `{ executionId, ticketId, projectId, blockedBy, canOverride, overrideRoles[] }`
     - `canOverride`: Boolean indicating if Lead QA can approve exception
     - `overrideRoles[]`: Array of roles allowed to override (typically ['LEAD_QA', 'ADMIN'])

3. **Room-Based Targeted Notification Routing**
   - QA failure events must be emitted to targeted rooms for appropriate audience:
     - **Assigned PM**: `user:{pmId}` - PM responsible for the project (access via `execution.ticket.project.pm_id`)
     - **Project room**: `project:{projectId}` - All project stakeholders
     - **Lead QA**: `role:LEAD_QA` - Quality oversight team
     - **Managers**: `role:MANAGER` - For critical/escalated failures
     - **Admins**: `role:ADMIN` - System administrators
   - Critical failures (severity: CRITICAL) must also emit to `role:MANAGER` room
   - Security failures must additionally notify `role:ADMIN` room for security review

4. **Integration Points with Existing Services**
   - `QualityGatesService.evaluate()` emits `qa.gate_failed` for each blocking issue in the `blockingIssues` array (AC 1)
   - `QualityGatesService.evaluate()` emits `qa.all_gates_failed` after evaluation if multiple blocking issues exist
   - Quality gate result with `passed: false` emits `qa.gate_blocked` when deployment would be blocked (FR70)
   - `AiQaOrchestrator.executeLintCheck()` emits `qa.gate_failed` with `gateType: 'LINTING'` on lint failures
   - `AiQaOrchestrator.executeTestRun()` emits `qa.gate_failed` with `gateType: 'TEST'` on test failures (note: method is `executeTestRun`, not `executeTestCheck`)
   - `AiQaOrchestrator.executeCoverageAnalysis()` emits `qa.gate_failed` with `gateType: 'COVERAGE'` on coverage failures (note: method is `executeCoverageAnalysis`, not `executeCoverageCheck`)
   - `AiQaOrchestrator.executeSecurityScan()` emits `qa.gate_failed` with `gateType: 'SECURITY'` on security failures

5. **Failure Details Payload Structure**
   - **Linting failures**: `{ fileCount, errorCount, warningCount, topIssues[], sampleErrors[] }`
   - **Test failures**: `{ testSuite, totalTests, passed, failed, failedTests[], durationMs }`
   - **Coverage failures**: `{ requiredCoverage, actualCoverage, uncoveredFiles[], coverageDiff }`
   - **Security failures**: `{ scanType, vulnerabilities[], severityCounts, remediationHints[] }`
   - **Complexity failures**: `{ filePath, functionName, actualComplexity, maxAllowed }`

6. **Notification Severity & Priority Logic**
   - Severity determination based on gate configuration:
     - `CRITICAL`: Security vulnerabilities (high/critical), test failures in production-bound code
     - `HIGH`: Coverage below threshold by >10%, linting errors in core files
     - `MEDIUM`: Minor coverage gaps, style violations, warnings elevated to errors
     - `LOW`: Cosmetic issues, non-blocking recommendations
   - Override capability flags:
     - `canOverride: true` for MEDIUM and LOW severity (Lead QA can approve)
     - `canOverride: false` for CRITICAL severity (requires code fix)
     - `canOverride: conditional` for HIGH (requires Manager + Lead QA approval)

7. **Error Handling & Resilience**
   - WebSocket emission failures must NOT block quality gate evaluation or execution state transitions
   - Use try-catch around `RealtimeService` calls with logging
   - If RealtimeService is unavailable, execution must continue normally (degraded notification mode)
   - Prometheus metric `qa_notification_emission_errors_total` must track emission failures
   - Failed notifications should be logged to audit trail for compliance (FR91)

## Tasks / Subtasks

- [ ] **Define QA Event Interfaces** (AC 2)
  - [ ] Add `QaGateFailedEvent`, `QaAllGatesFailedEvent`, `QaGateBlockedEvent` to `realtime.types.ts`
  - [ ] Define `GateType` enum: 'LINTING', 'TEST', 'COVERAGE', 'SECURITY', 'COMPLEXITY', 'CUSTOM'
  - [ ] Define `QaFailureSeverity` enum: 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  - [ ] Define failure detail interfaces: `LintingFailureDetails`, `TestFailureDetails`, `CoverageFailureDetails`, `SecurityFailureDetails`, `ComplexityFailureDetails`

- [ ] **Create QaNotificationService** (AC 1, 3, 6)
  - [ ] Create `src/qa-automation/services/qa-notification.service.ts`
  - [ ] Inject `RealtimeService` with `@Optional()` for graceful degradation
  - [ ] Implement `emitGateFailed(executionId, gateType, failureDetails, severity)` method
  - [ ] Implement `emitAllGatesFailed(executionId, failedGates[], summary)` method
  - [ ] Implement `emitGateBlocked(executionId, blockedBy, canOverride)` method
  - [ ] Implement severity determination logic based on gate configuration
  - [ ] Implement room routing logic (PM, project, Lead QA, Managers, Admins)

- [ ] **Integrate with QualityGatesService** (AC 4)
  - [ ] Inject `QaNotificationService` into `QualityGatesService`
  - [ ] Add emission calls in `evaluate()` method using the `blockingIssues` array (already contains structured failure data)
  - [ ] Emit `qa.all_gates_failed` when `blockingIssues.length > 1`
  - [ ] Emit `qa.gate_blocked` when `passed: false` (deployment would be blocked)
  - [ ] Ensure emissions happen AFTER database updates, BEFORE returning result (non-blocking, fire-and-forget)

- [ ] **Integrate with AiQaOrchestrator** (AC 4)
  - [ ] Inject `QaNotificationService` into `AiQaOrchestrator` (NOTE: Class name is `AiQaOrchestrator`, not `AiQaOrchestratorService`)
  - [ ] Add emission in `executeLintCheck()` on lint failure
  - [ ] Add emission in `executeTestRun()` on test failure (method name: `executeTestRun`)
  - [ ] Add emission in `executeCoverageAnalysis()` on coverage failure (method name: `executeCoverageAnalysis`)
  - [ ] Add emission in `executeSecurityScan()` on security failure
  - [ ] Use existing parsed results from AI-delegated checks (no custom parsers needed - Story 3.10 pattern)

- [ ] **Leverage Existing Parsed Results** (AC 5)
  - [ ] **NO CUSTOM PARSERS NEEDED** - Story 3.10 (AI QA Orchestrator) already returns parsed JSON results
  - [ ] Use `IQaResult.data` from `AiQaOrchestrator` methods (already structured)
  - [ ] Use `IBlockingIssue.details` from `QualityGatesService.evaluate()` (already structured)
  - [ ] Map existing data structures to notification payload interfaces

- [ ] **Add Prometheus Metrics** (AC 7)
  - [ ] Register `qa_notifications_emitted_total` counter with labels: [gate_type, severity]
  - [ ] Register `qa_notification_emission_errors_total` counter with labels: [event, reason]
  - [ ] Register `qa_gates_failed_total` counter with labels: [gate_type, severity]
  - [ ] Inject metrics in `QaNotificationService` and increment appropriately

- [ ] **Unit Tests** (All ACs)
  - [ ] Test `QaNotificationService` emission methods with mocked `RealtimeService`
  - [ ] Test room routing logic (verify correct rooms receive events)
  - [ ] Test severity determination logic
  - [ ] Test graceful degradation when `RealtimeService` unavailable
  - [ ] Test error handling and metrics increment
  - [ ] Test integration with `QualityGatesService` (verify emissions triggered)

- [ ] **Integration Tests**
  - [ ] Test end-to-end flow: QA check failure → notification emitted → received by subscribed clients
  - [ ] Test multiple concurrent failures (ensure no event loss)
  - [ ] Test failure detail accuracy in payloads

## Dev Notes

### Architecture Compliance

- **New Service**: `src/qa-automation/services/qa-notification.service.ts`
- **Module**: Update `src/qa-automation/qa-automation.module.ts`
  - Add `QaNotificationService` to providers
  - Export `QaNotificationService` for use by `ExecutionModule`
  - Import `RealtimeModule` to access `RealtimeService` (use `forwardRef(() => RealtimeModule)` if circular dependency)
  - Add Prometheus metric providers
- **Dependencies**:
  - `RealtimeService` from `@/realtime/realtime.service` (optional injection with `@Optional()`)
  - `QualityGatesService` - emit notifications from `evaluate()` method using existing `blockingIssues` array
  - `AiQaOrchestrator` - emit notifications from AI-delegated checks (use existing `IQaResult` interface)
  - Prometheus counters for observability
- **Event Types**: Extend `src/realtime/realtime.types.ts` with QA event interfaces
- **Existing Interfaces to Leverage**:
  - `IQaResult` from `ai-qa-orchestrator.service.ts` (Story 3.10) - already contains parsed check results
  - `IBlockingIssue` from `quality-gates.service.ts` - already contains structured failure data
  - `BlockerType` enum from `quality-gate.interface.ts` - use for mapping to GateType

### Key Technical Requirements

1. **QaNotificationService Implementation Pattern**

   ```typescript
   @Injectable()
   export class QaNotificationService {
     constructor(
       @Optional() private readonly realtimeService?: RealtimeService,
       @InjectMetric('qa_notifications_emitted_total')
       private readonly notificationsCounter?: Counter,
       @InjectMetric('qa_notification_emission_errors_total')
       private readonly emissionErrorsCounter?: Counter,
       private readonly logger: LoggerService,
     ) {}

     async emitGateFailed(
       execution: Execution,
       gateType: GateType,
       failureDetails: FailureDetails,
       severity: QaFailureSeverity,
     ): Promise<void> {
       if (!this.realtimeService) {
         this.logger.warn('RealtimeService not available, skipping QA notification');
         return;
       }

       const payload: QaGateFailedEvent = {
         executionId: execution.id,
         ticketId: execution.ticketId,
         projectId: execution.ticket?.projectId,
         gateType,
         failureDetails,
         severity,
         failedAt: new Date(),
       };

       // Emit to appropriate rooms
       await this.emitToTargetRooms(execution, 'qa.gate_failed', payload, severity);

       // Track metrics
       this.notificationsCounter?.inc({ gate_type: gateType, severity });
     }

     private async emitToTargetRooms(
       execution: Execution,
       event: string,
       payload: any,
       severity: QaFailureSeverity,
     ): Promise<void> {
       const projectId = execution.ticket?.projectId;
       // Access PM through project relationship (NOT assignedPmUserId - field doesn't exist)
       const pmId = execution.ticket?.project?.pm_id;

       try {
         // Always notify assigned PM
         if (pmId) {
           await this.realtimeService.emitToUser(pmId, event, payload);
         }

         // Project room for all stakeholders
         if (projectId) {
           await this.realtimeService.emitToProject(projectId, event, payload);
         } else {
           // Fallback to admin/manager broadcast
           await this.realtimeService.emitToRole('ADMIN', event, payload);
           await this.realtimeService.emitToRole('MANAGER', event, payload);
         }

         // Lead QA always gets QA failure notifications
         await this.realtimeService.emitToRole('LEAD_QA', event, payload);

         // Critical failures also notify managers
         if (severity === 'CRITICAL') {
           await this.realtimeService.emitToRole('MANAGER', event, payload);
         }

         // Security failures notify admins
         if (payload.gateType === 'SECURITY') {
           await this.realtimeService.emitToRole('ADMIN', event, payload);
         }
       } catch (error) {
         this.logger.error(`Failed to emit QA notification ${event}:`, error);
         this.emissionErrorsCounter?.inc({ event, reason: error.message });
       }
     }
   }
   ```

2. **Severity Determination Logic**

   For **QualityGatesService** (using existing `IBlockingIssue` data):

   ```typescript
   private determineSeverityFromBlockerType(blockerType: BlockerType): QaFailureSeverity {
     switch (blockerType) {
       case BlockerType.CRITICAL_SECURITY:
       case BlockerType.TEST_FAILURE:
         return 'CRITICAL';
       case BlockerType.HIGH_SEVERITY_SECURITY:
       case BlockerType.COVERAGE_BELOW_MINIMUM:
         return 'HIGH';
       case BlockerType.LINTING_ERROR:
         return 'MEDIUM';
       default:
         return 'LOW';
     }
   }
   ```

   For **AiQaOrchestrator** (using `IQaResult` from AI-delegated checks):

   ```typescript
   private determineSeverityFromQaResult(
     checkType: 'linting' | 'testing' | 'security' | 'coverage',
     data: unknown,
   ): QaFailureSeverity {
     switch (checkType) {
       case 'security':
         const securityData = data as { vulnerabilities?: Array<{ severity: string }> };
         const hasCritical = securityData.vulnerabilities?.some(
           (v) => v.severity === 'CRITICAL' || v.severity === 'HIGH'
         );
         return hasCritical ? 'CRITICAL' : 'HIGH';

       case 'testing':
         const testData = data as { failed?: number };
         return (testData.failed || 0) > 0 ? 'CRITICAL' : 'MEDIUM';

       case 'coverage':
         const coverageData = data as { overall?: number; required?: number };
         const diff = (coverageData.required || 80) - (coverageData.overall || 0);
         if (diff > 20) return 'CRITICAL';
         if (diff > 10) return 'HIGH';
         if (diff > 5) return 'MEDIUM';
         return 'LOW';

       case 'linting':
         const lintData = data as { errorCount?: number };
         const errors = lintData.errorCount || 0;
         if (errors > 50) return 'HIGH';
         if (errors > 20) return 'MEDIUM';
         return 'LOW';

       default:
         return 'MEDIUM';
     }
   }
   ```

3. **Integration in QualityGatesService**

   ```typescript
   // In src/qa-automation/quality-gates.service.ts
   async evaluate(
     executionId: string,
     correlationId: string,
     projectId: string,
     qaResult: IQaResultInput,
   ): Promise<IQualityGateResult> {
     // ... existing evaluation logic ...

     // Identify blocking issues (already done in existing code)
     const blockingIssues = this.determineBlockingIssues(qaResult, config.thresholds);

     // EMIT NOTIFICATIONS FOR EACH BLOCKING ISSUE (AC 4)
     if (blockingIssues.length > 0) {
       for (const issue of blockingIssues) {
         const severity = this.determineSeverityFromBlockerType(issue.type);

         // Map BlockerType to GateType
         const gateType = this.mapBlockerTypeToGateType(issue.type);

         // Fire-and-forget notification (don't await)
         this.qaNotificationService.emitGateFailed(
           execution,
           gateType,
           issue.details,
           severity,
         ).catch((err) => this.logger.error('Notification emission failed', err));
       }

       // Emit aggregated event if multiple failures
       if (blockingIssues.length > 1) {
         this.qaNotificationService.emitAllGatesFailed(
           execution,
           blockingIssues.map(issue => ({
             gateType: this.mapBlockerTypeToGateType(issue.type),
             failureDetails: issue.details,
             severity: this.determineSeverityFromBlockerType(issue.type),
           })),
           {
             totalFailures: blockingIssues.length,
             criticalCount: blockingIssues.filter(i => i.type === BlockerType.CRITICAL_SECURITY).length,
             highCount: blockingIssues.filter(i =>
               i.type === BlockerType.HIGH_SEVERITY_SECURITY ||
               i.type === BlockerType.COVERAGE_BELOW_MINIMUM
             ).length,
             mediumCount: 0,
             lowCount: 0,
           }
         ).catch((err) => this.logger.error('Aggregated notification failed', err));
       }

       // Emit blocked event for deployment blocking
       this.qaNotificationService.emitGateBlocked(
         execution,
         blockingIssues.map(i => this.mapBlockerTypeToGateType(i.type)),
         this.canOverrideFailures(blockingIssues),
         ['LEAD_QA', 'ADMIN'],
       ).catch((err) => this.logger.error('Blocked notification failed', err));
     }

     // ... rest of existing logic ...
   }
   ```

4. **Helper Methods for QualityGatesService Integration**

   ```typescript
   // Helper to map BlockerType (from quality-gates.service.ts) to GateType
   private mapBlockerTypeToGateType(blockerType: BlockerType): GateType {
     switch (blockerType) {
       case BlockerType.LINTING_ERROR:
         return 'LINTING';
       case BlockerType.TEST_FAILURE:
         return 'TEST';
       case BlockerType.COVERAGE_BELOW_MINIMUM:
         return 'COVERAGE';
       case BlockerType.CRITICAL_SECURITY:
       case BlockerType.HIGH_SEVERITY_SECURITY:
         return 'SECURITY';
       default:
         return 'CUSTOM';
     }
   }

   // Helper to determine severity from blocker type
   private determineSeverityFromBlockerType(blockerType: BlockerType): QaFailureSeverity {
     switch (blockerType) {
       case BlockerType.CRITICAL_SECURITY:
       case BlockerType.TEST_FAILURE:
         return 'CRITICAL';
       case BlockerType.HIGH_SEVERITY_SECURITY:
       case BlockerType.COVERAGE_BELOW_MINIMUM:
         return 'HIGH';
       case BlockerType.LINTING_ERROR:
         return 'MEDIUM';
       default:
         return 'LOW';
     }
   }

   // Helper to determine if failures can be overridden
   private canOverrideFailures(blockingIssues: IBlockingIssue[]): boolean {
     // Cannot override if any critical security issues
     return !blockingIssues.some(i => i.type === BlockerType.CRITICAL_SECURITY);
   }
   ```

5. **Event Payload Interfaces**

   ```typescript
   // Add to src/realtime/realtime.types.ts

   export type GateType = 'LINTING' | 'TEST' | 'COVERAGE' | 'SECURITY' | 'COMPLEXITY' | 'CUSTOM';
   export type QaFailureSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

   export interface QaGateFailedEvent {
     executionId: string;
     ticketId: string;
     projectId: string | null;
     gateType: GateType;
     failureDetails:
       | LintingFailureDetails
       | TestFailureDetails
       | CoverageFailureDetails
       | SecurityFailureDetails
       | ComplexityFailureDetails;
     severity: QaFailureSeverity;
     failedAt: Date;
   }

   export interface QaAllGatesFailedEvent {
     executionId: string;
     ticketId: string;
     projectId: string | null;
     failedGates: Array<{
       gateType: GateType;
       failureDetails: any;
       severity: QaFailureSeverity;
     }>;
     summary: {
       totalFailures: number;
       criticalCount: number;
       highCount: number;
       mediumCount: number;
       lowCount: number;
     };
     failedAt: Date;
   }

   export interface QaGateBlockedEvent {
     executionId: string;
     ticketId: string;
     projectId: string | null;
     blockedBy: GateType[];
     canOverride: boolean;
     overrideRoles: string[];
     blockedAt: Date;
   }

   export interface LintingFailureDetails {
     fileCount: number;
     errorCount: number;
     warningCount: number;
     topIssues: Array<{ rule: string; count: number }>;
     sampleErrors: Array<{ file: string; line: number; message: string }>;
   }

   export interface TestFailureDetails {
     testSuite: string;
     totalTests: number;
     passed: number;
     failed: number;
     failedTests: Array<{ name: string; error: string }>;
     durationMs: number;
   }

   export interface CoverageFailureDetails {
     requiredCoverage: number;
     actualCoverage: number;
     uncoveredFiles: string[];
     coverageDiff: number;
   }

   export interface SecurityFailureDetails {
     scanType: string;
     vulnerabilities: Array<{
       id: string;
       severity: string;
       package: string;
       description: string;
     }>;
     severityCounts: { critical: number; high: number; medium: number; low: number };
     remediationHints: string[];
   }

   export interface ComplexityFailureDetails {
     filePath: string;
     functionName: string;
     actualComplexity: number;
     maxAllowed: number;
   }
   ```

### Security

- All WebSocket events already authenticated by `WsAuthGuard` (Story 10-U-1)
- RBAC for room subscriptions handled by `RealtimeGateway.joinProject()` (Story 10-U-1)
- No additional auth needed in `QaNotificationService` (relies on room-based routing)
- Failure details should NOT include sensitive code snippets (use file paths, line numbers only)
- Security vulnerability details should be redacted for non-ADMIN roles (show counts only)

### ⚠️ ANTI-PATTERNS TO AVOID

1. **DON'T create custom parsers** - Story 3.10 (AI QA Orchestrator) already returns parsed JSON results via `IQaResult.data`
2. **DON'T await WebSocket emissions** - Use fire-and-forget pattern from 10-U-2 (do NOT await `realtimeService.emit*()` calls)
3. **DON'T forget @Optional() on RealtimeService** - Always use `@Optional()` decorator for graceful degradation
4. **DON'T query Ticket service for PM** - Access PM via `execution.ticket.project.pm_id` (Ticket → Project → pm_id relationship)
5. **DON'T handle circular dependencies incorrectly** - Use `forwardRef(() => RealtimeModule)` if circular dependency with RealtimeModule arises

### Testing Strategy

- **Unit Tests**: Mock `RealtimeService`, verify emission calls with correct parameters
- **Integration Tests**: Use real `RealtimeGateway`, subscribe to rooms, verify events received
- **Severity Tests**: Test severity determination logic with various failure scenarios
- **Room Routing Tests**: Verify PM, Lead QA, Managers receive appropriate notifications
- **E2E Tests**: Deferred to future story (requires frontend + full stack integration)

### Project Structure Notes

**Files to Create:**

- `src/qa-automation/services/qa-notification.service.ts` - Core notification service
- `src/qa-automation/services/qa-notification.service.spec.ts` - Unit tests
- **NO PARSER FILES NEEDED** - Story 3.10 AI QA Orchestrator already returns parsed results via `IQaResult.data`

**Files to Modify:**

- `src/realtime/realtime.types.ts` - Add QA event interfaces
- `src/qa-automation/qa-automation.module.ts` - Add QaNotificationService, import RealtimeModule (use `forwardRef()` if circular dependency), add metrics
- `src/qa-automation/quality-gates.service.ts` - Inject QaNotificationService, add emission calls in `evaluate()` method
- `src/qa-automation/ai-qa-orchestrator.service.ts` - Inject QaNotificationService, add emission calls (class is `AiQaOrchestrator`)

### References

- [Story 10-U-1: Socket.IO Infrastructure](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-1-socket-io-real-time-infrastructure.md) - Established RealtimeService and room patterns
- [Story 10-U-2: Execution Progress Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-2-execution-progress-streaming.md) - Event emission patterns from ExecutionTrackerService
- [Story 3.10: QA Automation AI Delegation](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/3-10-qa-automation-ai-delegation-refactor.md) - AI-delegated QA pattern (already returns parsed results)
- [Architecture Doc: Quality Gates](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#Section-Automated-QA) - Quality gate architecture
- [PRD: FR34-43 Lead QA Capabilities](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/prd.md#Lead-QA-Capabilities) - Original requirements
- [QualityGatesService](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/qa-automation/quality-gates.service.ts) - Service to integrate with (main method: `evaluate()`)
- [AiQaOrchestrator](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/qa-automation/ai-qa-orchestrator.service.ts) - AI-delegated QA service (class: `AiQaOrchestrator`, methods: `executeLintCheck`, `executeTestRun`, `executeCoverageAnalysis`, `executeSecurityScan`)

### Previous Story Intelligence

**Story 10-U-1 Learnings:**

- `RealtimeService` provides 4 emission methods: `emitToProject()`, `emitToRole()`, `emitToUser()`, `broadcast()`
- Use `@Optional()` decorator for graceful degradation when RealtimeModule not loaded
- Event interfaces must be exported from `realtime.types.ts` for consumer use
- Room-based routing ensures targeted notifications (security/privacy)

**Story 10-U-2 Learnings:**

- Fire-and-forget emission pattern (do NOT await or block critical paths)
- Use try-catch wrappers to prevent service crashes from notification failures
- Prometheus metrics for observability are required (follow pattern from 10-U-2)
- Rate limiting may be needed for high-frequency events (consider for bulk failures)

**Established Patterns:**

- Optional dependency injection for graceful degradation
- Defensive programming with null checks
- Prometheus metrics for observability
- Room-based routing: `project:{id}`, `role:{role}`, `user:{userId}`
- Event emission AFTER database commits, BEFORE state transitions

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent_

### Debug Log References

_To be filled by dev agent_

### Completion Notes List

_To be filled by dev agent_

### File List

_To be filled by dev agent_
