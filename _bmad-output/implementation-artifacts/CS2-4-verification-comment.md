# Story CS2.4: Post Auto-Fill Verification Comment

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want a comment posted on my task whenever DSF auto-fills any required fields,
so that I can verify AI-estimated values before using them for billing or reporting.

## Acceptance Criteria

### AC1 — `PMVerificationCommentService.postVerificationComment()` signature and location

**Given** a resolved `ProjectIntegration`, a `taskId`, a `factualFilled` array from CS2-2, an `inferredFilled` array from CS2-3, a `manualFields` array, and a `correlationId`
**When** `PMVerificationCommentService.postVerificationComment(integration, taskId, factualFilled, inferredFilled, manualFields, correlationId)` is called
**Then** the service exists at `src/integrations/pm-verification-comment.service.ts`
**And** returns `Promise<void>`
**And** a `debug` log is emitted: `[{correlationId}] CS2-4: verification comment for task {taskId}: {f} factual, {i} inferred, {m} manual fields`

Method signature:

```typescript
async postVerificationComment(
  integration: ProjectIntegration,
  taskId: string,
  factualFilled: Array<{ field: NormalizedField; value: FieldValue; source: string }>,
  inferredFilled: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>,
  manualFields: NormalizedField[],
  correlationId: string,
): Promise<void>
```

### AC2 — No-op when no fields were auto-filled

**Given** `factualFilled.length === 0` AND `inferredFilled.length === 0`
**When** `postVerificationComment()` is called
**Then** it returns immediately without calling `getProvider()` or `addComment()`
**And** a `debug` log: `[{correlationId}] CS2-4: no fields were auto-filled for task {taskId} — skipping verification comment`

**Note**: `manualFields` alone does not trigger a comment — the comment is only posted when DSF actually filled at least one field.

### AC3 — Comment includes factual fields section (when factualFilled is non-empty)

**Given** `factualFilled.length > 0`
**When** the comment is built
**Then** the comment includes a `✅ Factual fields (auto-filled from DSF execution data):` section
**And** each entry is formatted as `• {field.name}: {formattedValue}`
**And** the section appears before the AI section (if present)

Source-specific value formatting:

- `source === 'execution_duration'`: display as `{value} min` (value is a number representing minutes)
- `source === 'deployed_at'`: display as ISO date string — `new Date(value as number).toISOString()`
- `source === 'pr_url'` or `source === 'branch_name'`: display value as-is (string)
- Any other source: `String(value)`

### AC4 — Comment includes AI-estimated fields section (when inferredFilled is non-empty)

**Given** `inferredFilled.length > 0`
**When** the comment is built
**Then** the comment includes a `🤖 AI-estimated fields (inferred by Claude — please verify):` section
**And** each entry is formatted as `• {field.name}: {formattedValue}` where `formattedValue = String(value)`
**And** the section appears after the factual section (if present)

### AC5 — Comment includes manual fields section (when manualFields is non-empty AND at least one field was filled)

**Given** `manualFields.length > 0` AND (`factualFilled.length > 0` OR `inferredFilled.length > 0`)
**When** the comment is built
**Then** the comment includes an `⚠️ Fields requiring manual input:` section
**And** each entry is formatted as `• {field.name} (type: {field.type})`
**And** the section appears last in the comment

**Given** `manualFields.length === 0`
**Then** the `⚠️` section is omitted entirely

### AC6 — Comment header

**Given** at least one field was auto-filled
**When** the comment is built
**Then** the first line is: `📋 DSF Auto-Fill Summary`
**And** followed by a blank line
**And** followed by: `Auto-filled by DSF — please verify before using for billing or reporting.`
**And** followed by a blank line before the first section

Full comment structure (example with all sections):

```
📋 DSF Auto-Fill Summary

Auto-filled by DSF — please verify before using for billing or reporting.

✅ Factual fields (auto-filled from DSF execution data):
• Time Estimate: 45 min
• PR URL: https://github.com/org/repo/pull/42
• Branch Name: feature/my-feature

🤖 AI-estimated fields (inferred by Claude — please verify):
• Story Points: 5
• Priority: High

⚠️ Fields requiring manual input:
• Sprint (type: dropdown)
• Assignee (type: user)
```

### AC7 — `IPMProvider.addComment()` called with built comment

**Given** the comment is built (non-empty)
**When** the method proceeds
**Then** `PMProviderFactory.getProvider(integration)` is called once (handles token refresh)
**And** `provider.addComment(taskId, comment)` is called with the complete comment string
**And** an `info` log: `[{correlationId}] CS2-4: verification comment posted for task {taskId}`

### AC8 — Fail-open: any error from provider does not throw

**Given** `getProvider()` throws OR `addComment()` throws
**When** the error is caught
**Then** the method logs `warn`: `[{correlationId}] CS2-4: failed to post verification comment for task {taskId}: {error.message}`
**And** `sentry.captureException(error as Error)` is called
**And** the method returns (does NOT rethrow) — status push must never be blocked

### AC9 — `PMVerificationCommentService` exported from `IntegrationsModule`

**Given** `PMVerificationCommentService` is implemented
**When** `IntegrationsModule` is configured
**Then** `PMVerificationCommentService` is in both `providers` and `exports` arrays of `src/integrations/integrations.module.ts`

**Expected `IntegrationsModule` providers state after CS2-1–CS2-3** (before CS2-4 adds its service):

```typescript
providers: [
  ProjectIntegrationService,
  ClickUpOAuthService,
  PMProviderFactory,
  PMStatusService,
  BotAssignmentService,
  PMFieldPreCheckService, // added CS2-1
  PMFieldAutoFillService, // added CS2-2
  // PMVerificationCommentService — CS2-4 adds this
];
```

If `PMFieldPreCheckService` or `PMFieldAutoFillService` are missing, it means CS2-1 or CS2-2 is incomplete — do not proceed until those stories are done.

### AC10 — Pipeline wiring in `DeploymentStatusSyncService`

**Given** the CS2-2 and CS2-3 pipeline already runs in `DeploymentStatusSyncService.syncToClickUp()`
**When** `CS2-4` is implemented
**Then** the CS2-3 block is modified to capture the `InferredFillResult` return value:

```typescript
// BEFORE (CS2-3 as-implemented — result discarded):
await this.pmAutoFillService.fillInferredFields(integration, ticketId, ...);

// AFTER (CS2-4 modification — result captured):
let inferredResult: InferredFillResult | undefined;
if (factualResult.remainingFields.length > 0) {
  try {
    inferredResult = await this.pmAutoFillService.fillInferredFields(
      integration, ticketId, factualResult.remainingFields, inferenceContext, finalCorrelationId,
    );
  } catch (_err) {
    this.logger.warn(`[${finalCorrelationId}] CS2-3: unexpected error in inferred fill block — continuing`);
  }
}
```

**And** immediately after the CS2-3 block (still inside the `if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0)` guard), the verification comment call is added:

```typescript
// CS2-4: Post verification comment
try {
  await this.pmVerificationService.postVerificationComment(
    integration,
    ticketId,
    factualResult.filledFields,
    inferredResult?.filledFields ?? [],
    inferredResult?.manualFields ?? factualResult.remainingFields,
    finalCorrelationId,
  );
} catch (_err) {
  this.logger.warn(
    `[${finalCorrelationId}] CS2-4: unexpected error in verification comment block — continuing`,
  );
}
```

**And** `PMVerificationCommentService` is injected into `DeploymentStatusSyncService` constructor:

```typescript
private readonly pmVerificationService: PMVerificationCommentService,  // ADD
```

**Given** `preCheckResult.allFilled === true` (all fields already set)
**Then** neither the fill pipeline nor the verification comment runs — they are inside the `if (!preCheckResult.allFilled)` guard

### AC11 — Unit tests (minimum coverage)

**Given** the service is implemented
**When** tests run via `pnpm test`
**Then** `pm-verification-comment.service.spec.ts` exists alongside the service file and covers:

| Test         | AC                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| T-V1 → AC2   | Both `factualFilled` and `inferredFilled` empty → no `getProvider` or `addComment` call                    |
| T-V2 → AC3   | Only factual fills → comment contains `✅ Factual fields` section, no `🤖` section                         |
| T-V3 → AC4   | Only inferred fills → comment contains `🤖 AI-estimated fields` section, no `✅` section                   |
| T-V4 → AC3+4 | Both factual and inferred fills → comment contains both sections in order (✅ before 🤖)                   |
| T-V5 → AC5   | Manual fields present with at least one fill → comment includes `⚠️ Fields requiring manual input` section |
| T-V6 → AC5   | No manual fields → no `⚠️` section in comment                                                              |
| T-V7 → AC6   | Comment starts with `📋 DSF Auto-Fill Summary` header                                                      |
| T-V8 → AC3   | `source === 'execution_duration'` → value displayed as `{n} min`                                           |
| T-V9 → AC3   | `source === 'deployed_at'` → value displayed as ISO date string                                            |
| T-V10 → AC7  | `addComment` called with string containing header `📋 DSF Auto-Fill Summary` and at least one field entry  |
| T-V11 → AC8  | `addComment()` throws → `warn` log + `sentry.captureException` + no rethrow                                |
| T-V12 → AC8  | `getProvider()` throws → `warn` log + `sentry.captureException` + no rethrow                               |
| T-V13 → AC2  | `manualFields` non-empty but both fill arrays empty → still no `addComment` call                           |

**And** `deployment-status-sync.service.spec.ts` is updated to add:

| Test   | Description                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| T-DSS6 | `inferredResult.filledFields` is passed to `postVerificationComment` (captured from CS2-3 call)                    |
| T-DSS7 | When only factual fill runs (remainingFields empty), `postVerificationComment` is called with `inferredFilled: []` |

### AC12 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS2-4 modified files

---

## Tasks / Subtasks

- [ ] **Task 1**: Create `PMVerificationCommentService` (AC1, AC2–AC8)
  - [ ] Create `src/integrations/pm-verification-comment.service.ts`
  - [ ] Inject `PMProviderFactory` and `SentryService` (same pattern as `BotAssignmentService`)
  - [ ] Use `private readonly logger = new Logger(PMVerificationCommentService.name)`
  - [ ] Implement `postVerificationComment()` method with AC2 fast-path guard
  - [ ] Implement `buildComment()` private helper (AC3–AC6)
  - [ ] Implement `formatFieldValue()` private helper (AC3 — source-specific formatting)
  - [ ] Call `getProvider()` once then `addComment()` (AC7)
  - [ ] Wrap provider calls in try/catch — fail-open (AC8)

- [ ] **Task 2**: Register in `IntegrationsModule` (AC9)
  - [ ] Add `PMVerificationCommentService` to `providers: [...]`
  - [ ] Add `PMVerificationCommentService` to `exports: [...]`

- [ ] **Task 3**: Wire into `DeploymentStatusSyncService` (AC10)
  - [ ] Import `PMVerificationCommentService` from `@/integrations/pm-verification-comment.service`
  - [ ] Import `InferredFillResult` from `@/integrations/pm-field-auto-fill.service` (for `let inferredResult` type)
  - [ ] Add `private readonly pmVerificationService: PMVerificationCommentService` to constructor
  - [ ] Modify CS2-3 block: declare `let inferredResult: InferredFillResult | undefined` before the `if (factualResult.remainingFields.length > 0)` guard, change `await` to `inferredResult = await`
  - [ ] Add CS2-4 verification comment block after the CS2-3 block (inside the `if (!preCheckResult.allFilled)` guard)
  - [ ] Update `deployment-status-sync.service.spec.ts`: add `PMVerificationCommentService` mock `{ provide: PMVerificationCommentService, useValue: { postVerificationComment: jest.fn().mockResolvedValue(undefined) } }`, update CS2-3 mock to return `InferredFillResult`, add T-DSS6/T-DSS7 tests

- [ ] **Task 4**: Write unit tests (AC11)
  - [ ] Create `src/integrations/pm-verification-comment.service.spec.ts`
  - [ ] Mock `PMProviderFactory.getProvider()` → mock `IPMProvider` with `addComment: jest.fn()`
  - [ ] Mock `SentryService.captureException()`
  - [ ] Cover all 13 test cases T-V1 through T-V13

- [ ] **Task 5**: TypeScript + lint verification (AC12)
  - [ ] `pnpm typecheck` — zero errors on CS2-4 modified files
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test -- --testPathPattern="pm-verification-comment"` — all tests pass

---

## Dev Notes

### What This Story Builds

CS2-4 is the final story of Epic CS2. It adds a transparency comment to the PM task after CS2-2 (factual fill) and CS2-3 (AI-inferred fill) have completed. The comment tells the PM exactly what happened: what was filled automatically (and how), what was AI-estimated (and needs verification), and what still needs manual input.

CS2-4 has **two deliverables**:

1. **`PMVerificationCommentService`** — a focused comment-building and posting service
2. **Pipeline modification** — updates `DeploymentStatusSyncService.syncToClickUp()` to:
   - Capture the `InferredFillResult` from the CS2-3 call (currently discarded)
   - Post the verification comment after both fill passes complete

### Pattern: `BotAssignmentService` as structural template

Follow `src/integrations/bot-assignment.service.ts` for the service skeleton:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@/prisma/client';
import { PMProviderFactory } from '@/integrations/providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { NormalizedField, FieldValue } from '@/integrations/providers/dto/normalized-field.dto';

@Injectable()
export class PMVerificationCommentService {
  private readonly logger = new Logger(PMVerificationCommentService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  async postVerificationComment(
    integration: ProjectIntegration,
    taskId: string,
    factualFilled: Array<{ field: NormalizedField; value: FieldValue; source: string }>,
    inferredFilled: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>,
    manualFields: NormalizedField[],
    correlationId: string,
  ): Promise<void> {
    this.logger.debug(
      `[${correlationId}] CS2-4: verification comment for task ${taskId}: ` +
        `${factualFilled.length} factual, ${inferredFilled.length} inferred, ${manualFields.length} manual fields`,
    );

    if (factualFilled.length === 0 && inferredFilled.length === 0) {
      this.logger.debug(
        `[${correlationId}] CS2-4: no fields were auto-filled for task ${taskId} — skipping verification comment`,
      );
      return;
    }

    const comment = this.buildComment(factualFilled, inferredFilled, manualFields);

    try {
      const provider = await this.providerFactory.getProvider(integration);
      await provider.addComment(taskId, comment);
      this.logger.log(`[${correlationId}] CS2-4: verification comment posted for task ${taskId}`);
    } catch (error) {
      this.logger.warn(
        `[${correlationId}] CS2-4: failed to post verification comment for task ${taskId}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
    }
  }
}
```

### Comment Building

```typescript
private buildComment(
  factualFilled: Array<{ field: NormalizedField; value: FieldValue; source: string }>,
  inferredFilled: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>,
  manualFields: NormalizedField[],
): string {
  const lines: string[] = [
    '📋 DSF Auto-Fill Summary',
    '',
    'Auto-filled by DSF — please verify before using for billing or reporting.',
  ];

  if (factualFilled.length > 0) {
    lines.push('');
    lines.push('✅ Factual fields (auto-filled from DSF execution data):');
    for (const { field, value, source } of factualFilled) {
      lines.push(`• ${field.name}: ${this.formatFieldValue(value, source)}`);
    }
  }

  if (inferredFilled.length > 0) {
    lines.push('');
    lines.push('🤖 AI-estimated fields (inferred by Claude — please verify):');
    for (const { field, value } of inferredFilled) {
      lines.push(`• ${field.name}: ${String(value)}`);
    }
  }

  if (manualFields.length > 0) {
    lines.push('');
    lines.push('⚠️ Fields requiring manual input:');
    for (const field of manualFields) {
      lines.push(`• ${field.name} (type: ${field.type})`);
    }
  }

  return lines.join('\n');
}

private formatFieldValue(value: FieldValue, source: string): string {
  if (source === 'execution_duration') {
    return `${value} min`;
  }
  if (source === 'deployed_at' && typeof value === 'number') {
    return new Date(value).toISOString();
  }
  return String(value);
}
```

### `DeploymentStatusSyncService` Class Name

**IMPORTANT**: The current file `src/github/services/deployment-status-sync.service.ts` exports the class as `DeploymentStatusSync` (not `DeploymentStatusSyncService`). CS2-2 renames this class to `DeploymentStatusSyncService` as part of aligning the codebase to the CS2 story specs. By the time CS2-4 is implemented, the class name will be `DeploymentStatusSyncService`. If for any reason CS2-2 did not rename it, rename it as part of CS2-4 setup.

### `DeploymentStatusSyncService` Modification

**Context**: After CS2-2 and CS2-3 are implemented, the relevant section of `syncToClickUp()` looks like:

```typescript
// CS2-2 block (existing):
const integration = await this.integrationService.findFirstByProject(execution.ticket.project_id);
if (integration) {
  const cfg = integration.provider_config as Record<string, unknown> | null;
  const containerId = typeof cfg?.containerId === 'string' ? cfg.containerId : '';

  const preCheckResult = await this.pmPreCheckService.checkRequiredFields(
    integration,
    ticketId,
    containerId,
    finalCorrelationId,
  );

  if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0) {
    // ... build ctx: ExecutionContext ...
    const factualResult = await this.pmAutoFillService.fillFactualFields(
      integration,
      ticketId,
      preCheckResult.missingFields,
      ctx,
      finalCorrelationId,
    );

    // CS2-3 block (existing — result currently discarded):
    if (factualResult.remainingFields.length > 0) {
      try {
        await this.pmAutoFillService.fillInferredFields(
          // ← PROBLEM: result discarded
          integration,
          ticketId,
          factualResult.remainingFields,
          inferenceContext,
          finalCorrelationId,
        );
      } catch (_err) {
        this.logger.warn(`[${finalCorrelationId}] CS2-3: unexpected error...`);
      }
    }
  } // end if (!preCheckResult.allFilled)
} // end if (integration)
```

**CS2-4 changes this to:**

```typescript
// CS2-2 block (unchanged):
const integration = await this.integrationService.findFirstByProject(execution.ticket.project_id);
if (integration) {
  const cfg = integration.provider_config as Record<string, unknown> | null;
  const containerId = typeof cfg?.containerId === 'string' ? cfg.containerId : '';

  const preCheckResult = await this.pmPreCheckService.checkRequiredFields(
    integration, ticketId, containerId, finalCorrelationId,
  );

  if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0) {
    // ... build ctx: ExecutionContext (unchanged from CS2-2) ...
    const factualResult = await this.pmAutoFillService.fillFactualFields(
      integration, ticketId, preCheckResult.missingFields, ctx, finalCorrelationId,
    );

    // CS2-3 block: MODIFIED — capture inferredResult
    let inferredResult: InferredFillResult | undefined;
    if (factualResult.remainingFields.length > 0) {
      try {
        const inferenceContext: InferenceContext = { ... };   // unchanged from CS2-3
        inferredResult = await this.pmAutoFillService.fillInferredFields(  // ← CAPTURE result
          integration,
          ticketId,
          factualResult.remainingFields,
          inferenceContext,
          finalCorrelationId,
        );
      } catch (_err) {
        this.logger.warn(`[${finalCorrelationId}] CS2-3: unexpected error in inferred fill block — continuing`);
      }
    }

    // CS2-4 ADDITION: post verification comment
    try {
      await this.pmVerificationService.postVerificationComment(
        integration,
        ticketId,
        factualResult.filledFields,
        inferredResult?.filledFields ?? [],
        inferredResult?.manualFields ?? factualResult.remainingFields,
        finalCorrelationId,
      );
    } catch (_err) {
      this.logger.warn(
        `[${finalCorrelationId}] CS2-4: unexpected error in verification comment block — continuing`,
      );
    }
  }  // end if (!preCheckResult.allFilled)
}  // end if (integration)
```

**Import additions:**

```typescript
import { InferredFillResult } from '@/integrations/pm-field-auto-fill.service';
import { PMVerificationCommentService } from '@/integrations/pm-verification-comment.service';
```

**Constructor addition:**

```typescript
constructor(
  // ... existing params (prisma, clickUp, metrics, auditLog, sentry, integrationService, pmPreCheckService, pmAutoFillService) ...
  private readonly pmVerificationService: PMVerificationCommentService,  // ADD (CS2-4)
) {}
```

### Why `InferredFillResult` import is needed

`InferredFillResult` is the return type of `fillInferredFields()` (defined in `pm-field-auto-fill.service.ts`). It's needed to type `let inferredResult: InferredFillResult | undefined`. Since `InferredFillResult` is already exported from `pm-field-auto-fill.service.ts` (per CS2-3), importing it here adds zero new code.

### `manualFields` construction logic

```typescript
// manualFields for the comment = fields that NEITHER factual NOR AI fill could handle
// - If CS2-3 ran successfully: inferredResult.manualFields is the definitive list
// - If CS2-3 was skipped (no remaining after factual): empty (all factual fields were filled)
// - If CS2-3 threw: factualResult.remainingFields is the best-effort fallback
inferredResult?.manualFields ?? factualResult.remainingFields;
```

This covers all cases cleanly without extra branching.

### Testing setup for `PMVerificationCommentService`

```typescript
const mockProvider = {
  addComment: jest.fn().mockResolvedValue(undefined),
};
const mockProviderFactory = {
  getProvider: jest.fn().mockResolvedValue(mockProvider),
};
const mockSentry = { captureException: jest.fn() };

const module = await Test.createTestingModule({
  providers: [
    PMVerificationCommentService,
    { provide: PMProviderFactory, useValue: mockProviderFactory },
    { provide: SentryService, useValue: mockSentry },
  ],
}).compile();
const service = module.get(PMVerificationCommentService);
```

**Test fixtures:**

```typescript
const factualField: NormalizedField = {
  id: 'f-time',
  name: 'Time Estimate',
  type: NormalizedFieldType.NUMBER,
  required: true,
};

const inferredField: NormalizedField = {
  id: 'f-points',
  name: 'Story Points',
  type: NormalizedFieldType.NUMBER,
  required: true,
};

const manualField: NormalizedField = {
  id: 'f-sprint',
  name: 'Sprint',
  type: NormalizedFieldType.DROPDOWN,
  required: true,
};

// ProjectIntegration is imported from '@/prisma/client' in the service and test files
const mockIntegration = {
  id: 'integration-1',
  provider: 'CLICKUP',
  // ... minimal ProjectIntegration fields
} as ProjectIntegration; // import { ProjectIntegration } from '@/prisma/client'
```

**T-V8 (execution_duration formatting):**

```typescript
const result = await service.postVerificationComment(
  mockIntegration,
  'task-1',
  [{ field: factualField, value: 45, source: 'execution_duration' }],
  [],
  [],
  'corr-1',
);
const [, comment] = (mockProvider.addComment as jest.Mock).mock.calls[0];
expect(comment).toContain('• Time Estimate: 45 min');
```

**T-V9 (deployed_at formatting):**

```typescript
const unixMs = new Date('2026-03-14T12:00:00.000Z').getTime();
const result = await service.postVerificationComment(
  mockIntegration,
  'task-1',
  [{ field: dateField, value: unixMs, source: 'deployed_at' }],
  [],
  [],
  'corr-1',
);
const [, comment] = (mockProvider.addComment as jest.Mock).mock.calls[0];
expect(comment).toContain('• Deployed At: 2026-03-14T12:00:00.000Z');
```

### `deployment-status-sync.service.spec.ts` additions

**Add mock for `PMVerificationCommentService`:**

```typescript
{
  provide: PMVerificationCommentService,
  useValue: { postVerificationComment: jest.fn().mockResolvedValue(undefined) },
},
```

**Update CS2-3 mock** (if CS2-3 was previously mocked to return nothing, change to return `InferredFillResult`):

```typescript
// In beforeEach:
const mockPMAutoFillService = {
  fillFactualFields: jest.fn().mockResolvedValue({
    filledFields: [{ field: mockField, value: 45, source: 'execution_duration' }],
    remainingFields: [],
  }),
  fillInferredFields: jest.fn().mockResolvedValue({
    filledFields: [{ field: mockField2, value: 5, source: 'ai_inferred' }],
    manualFields: [],
    inferFailed: false,
  }),
};
```

**T-DSS6** — verify `inferredResult.filledFields` is passed to `postVerificationComment`:

```typescript
it('T-DSS6: passes inferredResult.filledFields to postVerificationComment', async () => {
  const mockInferredFilled = [{ field: mockField2, value: 5, source: 'ai_inferred' as const }];
  mockPMAutoFillService.fillInferredFields.mockResolvedValue({
    filledFields: mockInferredFilled,
    manualFields: [],
  });
  mockIntegrationService.findFirstByProject.mockResolvedValue(mockIntegration);
  mockPMPreCheckService.checkRequiredFields.mockResolvedValue({
    allFilled: false,
    missingFields: [mockField2],
  });
  mockPMAutoFillService.fillFactualFields.mockResolvedValue({
    filledFields: [],
    remainingFields: [mockField2],
  });

  await service.syncToClickUp(deploymentId, correlationId);

  expect(mockVerificationService.postVerificationComment).toHaveBeenCalledWith(
    mockIntegration,
    expect.any(String), // taskId
    [], // factualFilled (empty in this case)
    mockInferredFilled, // inferredFilled — captured from CS2-3
    [], // manualFields
    expect.any(String), // correlationId
  );
});
```

### ClickUp `addComment` — notification behaviour

`ClickUpProvider.addComment()` sends `{ comment_text: comment, notify_all: false }` — PMs see the comment in task activity, not as a notification ping. This is intentional: the comment is an audit trail, not an action prompt. Do not change this behaviour in CS2-4.

### NFR-CS2 Compliance

The verification comment is posted AFTER both fill passes. The `IPMProvider.addComment()` call is wrapped in try/catch (fail-open). If it throws, a `warn` log + Sentry capture occurs and the status push continues unblocked. This satisfies the non-blocking requirement.

### Architecture Compliance

- **`@/` path aliases**: All cross-directory imports use `@/` — never relative paths
- **NestJS `Logger`**: Use `new Logger(PMVerificationCommentService.name)` — NOT `LoggerService`
- **`SentryService`**: Inject from `@/common/sentry/sentry.service`
- **TypeScript strict**: All types explicit — `NormalizedField`, `FieldValue`, `ProjectIntegration` — no `any`
- **Never throws**: `postVerificationComment` must never throw — always catch provider errors
- **`getProvider()` called once**: before any provider method calls, handles token refresh

### Project Structure Notes

| File                                                         | Change Type | Notes                                                                                                                                                                     |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/integrations/pm-verification-comment.service.ts`        | **NEW**     | `PMVerificationCommentService` + `buildComment()` + `formatFieldValue()` helpers                                                                                          |
| `src/integrations/pm-verification-comment.service.spec.ts`   | **NEW**     | Unit tests T-V1–T-V13                                                                                                                                                     |
| `src/integrations/integrations.module.ts`                    | **MODIFY**  | Add `PMVerificationCommentService` to providers + exports                                                                                                                 |
| `src/github/services/deployment-status-sync.service.ts`      | **MODIFY**  | Import `InferredFillResult` + `PMVerificationCommentService`; add constructor param; update CS2-3 block to capture `inferredResult`; add CS2-4 verification comment block |
| `src/github/services/deployment-status-sync.service.spec.ts` | **MODIFY**  | Add `PMVerificationCommentService` mock; update CS2-3 mock to return `InferredFillResult`; add T-DSS6/T-DSS7 tests                                                        |

**Do NOT touch:**

- `src/integrations/pm-field-auto-fill.service.ts` — no changes; `InferredFillResult` is already exported
- `src/integrations/pm-field-pre-check.service.ts` — CS2-1 scope, no changes
- `src/integrations/providers/pm-provider.interface.ts` — `addComment` already exists (line 25)
- `src/integrations/providers/clickup/clickup.provider.ts` — `addComment` already implemented
- `src/github/github.module.ts` — `IntegrationsModule` was already added in CS2-2

**Prerequisite check — `GitHubModule`**: Verify `IntegrationsModule` is present in `src/github/github.module.ts` imports array (added by CS2-2). The current codebase does NOT have it — CS2-2 adds it. If it is missing when you reach CS2-4, add it as a plain import (no `forwardRef` — there is no circular dependency):

```typescript
import { IntegrationsModule } from '@/integrations/integrations.module';
// In @Module({ imports: [..., IntegrationsModule] })
```

### Previous Story Intelligence (from CS2-3)

From CS2-3 (`ai-inferred-fill`):

- `PMFieldAutoFillService` is at `src/integrations/pm-field-auto-fill.service.ts`, exported from `IntegrationsModule`
- `InferredFillResult` is exported from the same file with shape: `{ filledFields: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>; manualFields: NormalizedField[]; inferFailed?: boolean }`
- `ConfigService` was added to `PMFieldAutoFillService` constructor in CS2-3 — no impact on CS2-4
- The current CS2-3 wiring in `DeploymentStatusSyncService` discards the `fillInferredFields()` return value — CS2-4 changes this to capture it
- `DeploymentStatusSyncService` already has `PMFieldAutoFillService` injected as `this.pmAutoFillService` (from CS2-2)

From CS2-2 (`factual-auto-fill`):

- `FactualFillResult.filledFields` has type `Array<{ field: NormalizedField; value: FieldValue; source: string }>` — source strings: `'execution_duration'`, `'deployed_at'`, `'pr_url'`, `'branch_name'`
- `FactualFillResult.remainingFields` = fields that couldn't be factually filled (passed to CS2-3, then becomes `manualFields` input for CS2-4 fallback)
- `IntegrationsModule` was added to `GitHubModule` imports in CS2-2 (plain import, no `forwardRef`)
- `DeploymentStatusSyncService` already has `PMFieldPreCheckService` and `PMFieldAutoFillService` injected

From CS2-1 (`required-field-pre-check`):

- Fail-open pattern: always catch + Sentry + return graceful result, never throw
- `PMProviderFactory.getProvider()` must be `await`ed as a standalone step, never inside `Promise.all`

### Git Intelligence (Recent Commits)

1. `1d70c54` — `StartupChecksService` — `OnApplicationBootstrap` lifecycle pattern; `@/` alias; `LoggerService` + `ConfigService`
2. `d31bb7c` — `DevelopmentGateService` — Logger + SentryService fail-open pattern in `src/ticket-intake/`
3. `eb3d381` — `BotAssignmentService` — **direct structural template** for CS2-4; same constructor pattern, same fail-open approach
4. `c60a2fc` — Live status picker — `IntegrationsModule` exports expansion pattern confirmed
5. `c9dda19` — `ClickUpTaskUpdateConsumer` tests — NestJS unit test setup patterns

### References

- FR-CS19: `IPMProvider.addComment()` verification comment after auto-fill [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS19]
- Story 2.4 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-2.4]
- CS2-4 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS2-4-verification-comment]
- CS2-3 story (PMFieldAutoFillService `fillInferredFields` + `InferredFillResult`) [Source: `_bmad-output/implementation-artifacts/CS2-3-ai-inferred-fill.md`]
- CS2-2 story (PMFieldAutoFillService `fillFactualFields` + `FactualFillResult`) [Source: `_bmad-output/implementation-artifacts/CS2-2-factual-auto-fill.md`]
- CS2-1 story (PMFieldPreCheckService — upstream producer of `missingFields`) [Source: `_bmad-output/implementation-artifacts/CS2-1-required-field-pre-check.md`]
- `IPMProvider.addComment()` signature [Source: `src/integrations/providers/pm-provider.interface.ts:25`]
- `NormalizedField`, `NormalizedFieldType`, `FieldValue` [Source: `src/integrations/providers/dto/normalized-field.dto.ts`]
- `BotAssignmentService` (structural template) [Source: `src/integrations/bot-assignment.service.ts`]
- `IntegrationsModule` providers/exports [Source: `src/integrations/integrations.module.ts`]
- `DeploymentStatusSync.syncToClickUp()` CS2-3 insertion point [Source: `src/github/services/deployment-status-sync.service.ts`]
- `PMProviderFactory.getProvider()` is async — await once before any calls [Source: `src/integrations/providers/pm-provider.factory.ts`]
- `ConfigModule` is globally registered — no explicit import needed [Source: `src/app.module.ts:83`]
- `InferredFillResult` exported from CS2-3's service file [Source: `src/integrations/pm-field-auto-fill.service.ts`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/integrations/pm-verification-comment.service.ts` — NEW: `PMVerificationCommentService` + `buildComment()` + `formatFieldValue()` helpers (AC1–AC8)
- `src/integrations/pm-verification-comment.service.spec.ts` — NEW: unit tests T-V1–T-V13 (AC11)
- `src/integrations/integrations.module.ts` — MODIFY: add `PMVerificationCommentService` to providers + exports (AC9)
- `src/github/services/deployment-status-sync.service.ts` — MODIFY: import `InferredFillResult` + `PMVerificationCommentService`; inject `pmVerificationService`; capture `inferredResult` from CS2-3 call; add CS2-4 verification comment block (AC10)
- `src/github/services/deployment-status-sync.service.spec.ts` — MODIFY: add `PMVerificationCommentService` mock; update CS2-3 mock to return `InferredFillResult`; add T-DSS6/T-DSS7 (AC11)
