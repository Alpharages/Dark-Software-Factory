# Story 16-5: AI Decision Logging Module

## Story

As a developer, I want to implement a dedicated `AIDecisionLoggerService` module so that key AI-driven actions (like project deletion, future automated assignments) are auditable and structured, replacing the temporary placeholder logging.

## Status

- **Status**: ✅ **DONE**
- **Priority**: Medium
- **Effort**: 1 day
- **Story Points**: 3
- **Completed**: 2026-02-03
- **Code Review**: All 8 issues fixed and approved

## Code Review Fixes Applied

### 🚨 Critical Issues Fixed

1. **Issue #1 - Lying Audit Log**: Moved `logDecision()` call to AFTER successful deletion. The `outputData` now accurately reflects the completed operation.
2. **Issue #2 - Silent Audit Failures**: Added explicit check for `logDecision()` return value. Logs error when audit trail creation fails.
3. **Issue #3 - Missing Negative Test**: Added test to verify `logDecision()` is NOT called when deletion is rejected due to active tickets.

### 🔶 High Priority Issues Fixed

4. **Issue #4 - Semantic Abuse**: Documented `ticketId` field usage (using project ID for project-level operations). Added `deletedAt` timestamp to output data.

### 🔷 Medium Priority Issues Fixed

5. **Issue #5 - Env Var on Every Call**: Cached `AI_CONFIDENCE_THRESHOLD` in constructor, parsed once at initialization.
6. **Issue #6 - No Confidence Validation**: Added validation to clamp confidence values to 0-1 range, with error logging for invalid values.
7. **Issue #7 - Missing Execution ID**: Documented - executionId is optional for manual operations (not part of an AI execution flow).

## Context

During the implementation of Story 19-4 (Project Management Enhancements), a gap was identified where `AIDecisionLoggerService` was referenced but not implemented. A standard `Logger` was used as a temporary measure to enable project deletion logging. This story tracks the creation of the full module.

**Note**: Upon investigation, the `AIDecisionLoggerService` already exists in `src/audit/ai-decision-logger.service.ts` as part of Story 11.2 (AI Decision Audit Logger). The main work for this story is to:

1. Integrate the existing `AIDecisionLoggerService` into `ProjectService`
2. Replace the temporary `this.logger.log` calls with proper `aiDecisionLogger.logDecision()` calls

## Acceptance Criteria

1.  **Module Structure**:
    - [x] Import `AIDecisionLoggerModule` in `ProjectModule`
    - [x] Inject `AIDecisionLoggerService` into `ProjectService`

2.  **Service Integration**:
    - [x] Refactor `ProjectService.deleteProject` to use `AIDecisionLoggerService.logDecision()` instead of `this.logger.log`
    - [x] Ensure the log decision includes proper context (project ID, name, active tickets, force flag)

3.  **Observability**:
    - [x] Verify logs are correctly generated on project deletion with structured format
    - [x] Ensure confidence score is set appropriately (1.0 for human-initiated actions)

## Tasks

- [x] **Integration**: Import `AIDecisionLoggerModule` in `ProjectModule`
- [x] **Injection**: Add `AIDecisionLoggerService` to `ProjectService` constructor
- [x] **Refactor**: Update `deleteProject` method to call `aiDecisionLogger.logDecision()`
- [x] **Update Tests**: Add `AIDecisionLoggerService` mock to `ProjectService` unit tests
- [x] **Verify**: Run project deletion test and inspect logs/DB

## Implementation Notes

### AIDecisionLoggerService Interface

```typescript
// From src/audit/ai-decision-logger.service.ts
export class AIDecisionLoggerService {
  async logDecision(data: {
    agentName: string; // e.g., ProjectService.name
    action: string; // e.g., 'project_safe_delete' or 'project_force_delete'
    reasoning: string; // Human-readable explanation
    ticketId: string; // Using project ID for project-level operations
    executionId?: string; // Optional execution ID
    inputData: Record<string, unknown>; // Context data
    outputData: Record<string, unknown>; // Result data
    confidence: number; // 0-1 range (1.0 for human actions)
  }): Promise<AIDecisionLog | null>;
}
```

### Database Schema

```prisma
// From prisma/schema.prisma
model AIDecisionLog {
  id           String   @id @default(uuid())
  timestamp    DateTime @default(now())
  agent_name   String   // AI agent that made the decision
  action       String   // Action taken
  reasoning    String   @db.Text
  ticket_id    String
  execution_id String?
  input_data   Json     // Input context
  output_data  Json     // Decision output
  confidence   Float    // 0-1 range

  execution Execution? @relation(fields: [execution_id], references: [id])

  @@index([ticket_id, timestamp])
  @@map("ai_decision_logs")
}
```

### Integration Pattern for deleteProject

```typescript
// Log AI decision for deletion (AC#2)
await this.aiDecisionLogger.logDecision({
  agentName: ProjectService.name,
  action: force ? 'project_force_delete' : 'project_safe_delete',
  reasoning:
    `Project deletion initiated. Project: "${project.name}" (${id}), ` +
    `Active Tickets: ${activeTickets}, Force: ${force}`,
  ticketId: id, // Using project ID as ticket ID for project-level operations
  inputData: {
    projectId: id,
    projectName: project.name,
    activeTickets,
    force,
  },
  outputData: {
    deleted: true,
    projectId: id,
  },
  confidence: 1.0, // Human-initiated action has 100% confidence
});
```

## Files to Modify

1. `src/projects/project.module.ts` - Add `AIDecisionLoggerModule` to imports ✅
2. `src/projects/project.service.ts` - Inject service and replace logging ✅
3. `src/projects/project.service.spec.ts` - Add `AIDecisionLoggerService` mock ✅

## Dev Agent Record

**Implemented by**: Dev Agent (Amelia)  
**Date**: 2026-02-03  
**Story**: 16-5 AI Decision Logging Module

### Implementation Summary

1. **Module Integration** (`src/projects/project.module.ts`):
   - Added import for `AIDecisionLoggerModule` from `@/audit/ai-decision-logger.module`
   - Added `AIDecisionLoggerModule` to the `imports` array

2. **Service Injection** (`src/projects/project.service.ts`):
   - Added import for `AIDecisionLoggerService` from `@/audit/ai-decision-logger.service`
   - Injected `AIDecisionLoggerService` into constructor as `aiDecisionLogger`
   - Replaced temporary `this.logger.log()` call with structured `aiDecisionLogger.logDecision()` call
   - Log decision includes:
     - `agentName`: `ProjectService.name`
     - `action`: `'project_safe_delete'` or `'project_force_delete'` (based on force flag)
     - `reasoning`: Human-readable explanation with project name, ID, active ticket count, and force flag
     - `ticketId`: Project ID (used for project-level operations)
     - `inputData`: Context with projectId, projectName, activeTickets, force
     - `outputData`: Result with deleted status and projectId
     - `confidence`: 1.0 (human-initiated action)

3. **Test Updates** (`src/projects/project.service.spec.ts`):
   - Added import for `AIDecisionLoggerService`
   - Added import for `RabbitMQPublisherService` (required dependency)
   - Created mock: `mockAIDecisionLogger` with `logDecision` method returning `{ id: 'log-123' }`
   - Created mock: `mockRabbitMQPublisher` with `publishToQueue` method
   - Added both mocks to the testing module providers
   - Added test assertions to verify `logDecision` is called with correct parameters for both safe delete and force delete scenarios

### Test Results (After Fixes)

```
PASS src/projects/project.service.spec.ts
  ProjectService
    deleteProject
      ✓ should delete project when no active tickets
      ✓ should reject deletion when active tickets exist and force=false
      ✓ should force delete project when active tickets exist and force=true
      ✓ should complete deletion even when audit logging fails

PASS src/audit/ai-decision-logger.service.spec.ts
  AIDecisionLoggerService
    logDecision
      ✓ should create AI decision log in database
      ✓ should clamp confidence value below 0 to 0
      ✓ should clamp confidence value above 1 to 1
      ✓ should handle NaN confidence value gracefully
      ... (20 total tests)
```

All tests pass including new tests for:

- Audit log failure handling (Issue #2)
- Negative test for rejected deletions (Issue #3)
- Confidence validation edge cases (Issue #6)

## Testing Requirements

When implementing this story, the `ProjectService` unit tests will need to be updated to mock `AIDecisionLoggerService`:

```typescript
// Add to project.service.spec.ts
const mockAIDecisionLogger = {
  logDecision: jest.fn().mockResolvedValue({ id: 'log-123' }),
};

// Add to providers array in beforeEach
{
  provide: AIDecisionLoggerService,
  useValue: mockAIDecisionLogger,
}
```

## References

- **Story 11.2**: [AI Decision Audit Logger](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/11-2-ai-decision-audit-logger.md) - Original AIDecisionLoggerService implementation
- **Story 19-4**: [Project Management Enhancements](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/19-4-project-management-enhancements.md) - Where the temporary logging was added
- **Story 19-5**: [AI Decision Logging Module](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/19-5-ai-decision-logging-module.md) - Similar story in Epic 19
- **Sprint Status**: [sprint-status.yaml](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml) - Line 1442

## Notes

- **Duplicate Story**: Story 19-5 exists with similar requirements. The key difference is that Story 16-5 focuses on **integration** while Story 19-5 assumed **creation** of the module. Since the module already exists (Story 11.2), this story (16-5) is the correct one to implement.
- **Module Location**: `AIDecisionLoggerService` is in `src/audit/` (not `src/ai-decision-logging/` as suggested in Story 19-5)
