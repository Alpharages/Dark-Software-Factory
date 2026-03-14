# Story CS2.3: AI-Inferred Field Fill for Estimatable Fields

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want to use AI (Claude) to infer values for estimatable fields from execution context,
so that fields requiring judgment (story points, priority, tags) are filled automatically without human intervention.

## Acceptance Criteria

### AC1 — `PMFieldAutoFillService.fillInferredFields()` signature and location

**Given** a resolved `ProjectIntegration`, a `taskId`, a `remainingFields: NormalizedField[]` list from CS2-2, and an `InferenceContext`
**When** `PMFieldAutoFillService.fillInferredFields(integration, taskId, remainingFields, inferenceContext, correlationId)` is called
**Then** the method exists on `PMFieldAutoFillService` at `src/integrations/pm-field-auto-fill.service.ts`
**And** returns `Promise<InferredFillResult>`
**And** a `debug` log is emitted: `[{correlationId}] CS2-3: inferred fill for task {taskId}: {n} remaining fields, attempting AI inference`

### AC2 — `InferenceContext` interface exported from service file

**Given** the service is implemented
**When** `InferenceContext` is referenced
**Then** it is exported from `src/integrations/pm-field-auto-fill.service.ts` with the following shape:

```typescript
export interface InferenceContext {
  ticketTitle?: string | null;
  ticketDescription?: string | null;
  executionDurationMinutes?: number; // for complexity/effort estimation
  retryCount?: number; // indicator of implementation difficulty (Execution.retry_count)
  filesChangedCount?: number; // indicator of change scope (derived from Execution.files_changed)
}
```

### AC3 — `InferredFillResult` return type exported from service file

**Given** the method completes (successfully or partially)
**When** the result is returned
**Then** `InferredFillResult` is exported from `src/integrations/pm-field-auto-fill.service.ts` with the following shape:

```typescript
export interface InferredFillResult {
  filledFields: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>;
  manualFields: NormalizedField[]; // USER/people fields + dropdown no-match + fill failures
  inferFailed?: boolean; // true if Claude call threw, timed out, or is unconfigured
}
```

### AC4 — `USER` and `LABELS` assignment fields skipped to `manualFields`

**Given** a field where `field.type === NormalizedFieldType.USER`
**When** `fillInferredFields` processes it
**Then** it is immediately added to `manualFields` without any Claude call
**And** a `debug` log: `[{correlationId}] CS2-3: field "{field.name}" is USER type — skipping (handled by CS1-5)`

**Note**: `NormalizedFieldType.LABELS` fields with options (tag selection dropdowns) ARE sent to Claude — they are estimatable. Only `USER` type (person assignment) is excluded.

### AC5 — Single Claude prompt with all estimatable fields

**Given** at least one non-USER field remains after AC4 filtering
**When** `fillInferredFields` calls Claude
**Then** a single `anthropic.messages.create()` call is made (never multiple calls per `fillInferredFields` invocation)
**And** the system prompt instructs Claude to respond ONLY with a JSON object (no prose, no markdown)
**And** the user message includes:

- All estimatable field names, types, and valid options (for DROPDOWN fields)
- Ticket title and description (from `inferenceContext`)
- Execution duration in minutes (from `inferenceContext`, if available)
- Instruction to return `{ fieldId: inferredValue }` — using field IDs as keys, NOT field names
- Instruction to omit fields where confidence is low (do not include them in the JSON)
  **And** the model is resolved from config: `this.config.get<string>('anthropic.commitMessageModel') || 'claude-haiku-4-5-20251001'` (reuses existing config key; falls back to latest Haiku)
  **And** the `max_tokens` is set to `500` (sufficient for JSON field map)

### AC6 — Claude response parsed as `{ [fieldId]: string }` map

**Given** Claude returns a valid response
**When** the first text content block is parsed
**Then** JSON.parse is applied to extract the field-value map
**And** if JSON.parse throws, all estimatable fields are moved to `manualFields` with `inferFailed: true`
**And** the parse attempts to extract the JSON object even if surrounded by whitespace (use `.trim()` before parsing)

### AC7 — Dropdown option ID mapping

**Given** a field with `field.type === NormalizedFieldType.DROPDOWN` and `field.options` is non-empty
**When** Claude returns a value for that field
**Then** the value is matched case-insensitively against `field.options[].label`
**And** if a match is found, `IPMProvider.setFieldValue(taskId, field.id, matchedOption.id)` is called — NOT the label string
**And** `filledFields` entry has `source: 'ai_inferred'`

**Given** no option label matches the AI response
**When** mapping occurs
**Then** the field is added to `manualFields` (no `setFieldValue` call)
**And** a `debug` log: `[{correlationId}] CS2-3: dropdown field "{field.name}" — no option match for AI value "{value}" — adding to manualFields`

### AC8 — Non-dropdown field value setting

**Given** a field with type TEXT, NUMBER, CHECKBOX, or OTHER where Claude returns a value
**When** the value is processed
**Then** `IPMProvider.setFieldValue(taskId, field.id, value)` is called with the AI-returned value cast to `FieldValue`
**And** for `NormalizedFieldType.NUMBER` fields, attempt `Number(value)` — if `NaN`, add to `manualFields` instead
**And** for `NormalizedFieldType.CHECKBOX` fields, accept only `true` or `false` string values (case-insensitive `"true"/"false"`) — otherwise add to `manualFields`
**And** TEXT/OTHER fields: use the string value directly

### AC9 — Sequential `setFieldValue()` calls (fail-partial)

**Given** multiple fields are matched from Claude's response
**When** `setFieldValue()` is called for each
**Then** calls are sequential (`for...of` loop, NOT `Promise.all`)
**And** if `setFieldValue()` throws for a field:

- Log `warn`: `[{correlationId}] CS2-3: setFieldValue failed for field {field.id} ({field.name}): {error.message} — adding to manualFields`
- `sentry.captureException(error)`
- Add the field to `manualFields` (not `filledFields`)
- Continue processing subsequent fields — **never rethrows**
- Set `inferFailed: true` in result

### AC10 — 10-second timeout for Claude call

**Given** the Claude API call takes longer than 10 seconds
**When** the timeout fires
**Then** all estimatable fields (non-USER fields) are moved to `manualFields`
**And** `inferFailed: true` is set
**And** a `warn` log: `[{correlationId}] CS2-3: Claude inference timed out (10s) for task {taskId} — all fields to manualFields`
**And** the status push is NOT blocked (NFR-CS3: non-blocking)

Implementation pattern using `Promise.race` with `clearTimeout` to prevent timer leak:

```typescript
const timeoutMs = 10_000;
let timeoutHandle: NodeJS.Timeout;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => reject(new Error('CS2-3: Claude inference timeout')), timeoutMs);
});
try {
  const response = await Promise.race([claudeCallPromise, timeoutPromise]);
  clearTimeout(timeoutHandle!);
  // ...proceed with response parsing
} catch (error) {
  clearTimeout(timeoutHandle!);
  // distinguish timeout from other errors via error.message check
  throw error; // re-throw so outer catch handles it
}
```

**Why `clearTimeout` matters**: If Claude responds in 2s, the 10s timer continues running until it fires 8s later. `clearTimeout` prevents this dangling timer from causing unnecessary work.

### AC11 — ConfigService injection; graceful no-op when `ANTHROPIC_API_KEY` absent

**Given** `PMFieldAutoFillService` is modified to inject `ConfigService`
**When** the service is instantiated
**Then** `ConfigService` is injected as `private readonly config: ConfigService`
**And** in the constructor: `const apiKey = this.config.get<string>('anthropic.apiKey'); if (apiKey) { this.anthropicClient = new Anthropic({ apiKey }); }`
**And** `private readonly anthropicClient: Anthropic | null = null` is declared

**Given** `ANTHROPIC_API_KEY` is NOT set in the environment
**When** `fillInferredFields()` is called
**Then** the method immediately returns `{ filledFields: [], manualFields: remainingFields.filter(f => f.type !== NormalizedFieldType.USER), inferFailed: true }` (fail-open, no Claude call)
**And** a `warn` log: `[{correlationId}] CS2-3: Anthropic API key not configured — skipping AI inference for task {taskId}`
**And** USER fields are still handled by AC4 (added to manualFields without the warn)

### AC12 — Fail-open: any unexpected error

**Given** any unexpected error during inference (non-timeout, non-parse)
**When** the error is caught
**Then** all remaining estimatable fields (those not yet successfully filled) are added to `manualFields`
**And** `sentry.captureException(error)` is called
**And** `inferFailed: true` is set
**And** the method **never throws** — status push must never be blocked

### AC13 — Empty `remainingFields` fast-path

**Given** `remainingFields` is an empty array
**When** `fillInferredFields()` is called
**Then** it immediately returns `{ filledFields: [], manualFields: [], inferFailed: undefined }` without calling Claude or the provider

### AC14 — Pipeline wired into `DeploymentStatusSyncService`

**Given** the CS2-2 factual fill pipeline already runs in `DeploymentStatusSyncService.syncToClickUp()`
**When** `factualResult.remainingFields.length > 0` after CS2-2
**Then** `PMFieldAutoFillService.fillInferredFields(integration, ticketId, factualResult.remainingFields, inferenceContext, finalCorrelationId)` is called
**And** the `inferenceContext` is assembled as:

```typescript
// Execution.files_changed is Json? — extract count from array or number
const execRecord = execution as Record<string, unknown>;
const rawFilesChanged = execRecord.files_changed;
const filesChangedCount = Array.isArray(rawFilesChanged)
  ? rawFilesChanged.length
  : typeof rawFilesChanged === 'number'
    ? rawFilesChanged
    : undefined;

const inferenceContext: InferenceContext = {
  ticketTitle: execution.ticket.title,
  ticketDescription: execution.ticket.description, // String (non-nullable in schema)
  executionDurationMinutes: ctx.executionDurationMinutes, // from CS2-2's ctx
  retryCount: (execRecord.retry_count as number) ?? 0, // Execution.retry_count Int @default(0)
  filesChangedCount,
};
```

**Note**: `Execution.retry_count` and `Execution.files_changed` are already returned by the `include: { ticket: true }` query (all scalar fields are returned). Access via type assertion — same pattern as CS2-2's `execWithTiming` approach.

**And** the entire inferred fill block is wrapped in a `try/catch` (fail-open, status push never blocked)
**And** the `PMFieldAutoFillService` injection in `DeploymentStatusSyncService` already exists from CS2-2 — no new injection needed; `fillInferredFields()` is called on the same injected instance

**Given** `factualResult.remainingFields` is empty
**Then** `fillInferredFields()` is NOT called (skip the inference step)

### AC15 — `PMFieldAutoFillService` exports `ConfigModule`-compatible; `IntegrationsModule` unchanged for module imports

**Given** `PMFieldAutoFillService` now injects `ConfigService`
**When** `IntegrationsModule` is loaded
**Then** `IntegrationsModule` does NOT need to explicitly import `ConfigModule` — `ConfigModule` is registered globally in `app.module.ts` and `ConfigService` is therefore available for injection without explicit module import

### AC16 — Unit tests (minimum coverage)

**Given** the method is implemented
**When** tests run via `pnpm test`
**Then** `pm-field-auto-fill.service.spec.ts` is updated to cover:

| Test           | AC                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| T-I1 → AC13    | Empty `remainingFields` returns immediately, no provider/Claude calls                                      |
| T-I2 → AC4     | USER field is added to `manualFields`, no Claude call                                                      |
| T-I3 → AC11    | No ANTHROPIC_API_KEY: all non-USER fields in `manualFields`, `inferFailed: true`                           |
| T-I4 → AC5/AC6 | Claude returns valid JSON → fields filled via `setFieldValue`                                              |
| T-I5 → AC7     | Dropdown field: Claude returns label → matched to option ID, `setFieldValue` called with option.id         |
| T-I6 → AC7     | Dropdown field: Claude returns unmatched label → field in `manualFields`, no `setFieldValue`               |
| T-I7 → AC8     | NUMBER field: Claude returns `"8"` → `setFieldValue` called with `8` (Number)                              |
| T-I8 → AC8     | NUMBER field: Claude returns `"high"` (not numeric) → field in `manualFields`                              |
| T-I9 → AC8     | CHECKBOX field: Claude returns `"true"` → `setFieldValue` called with `true`                               |
| T-I10 → AC8    | CHECKBOX field: Claude returns `"maybe"` → field in `manualFields`                                         |
| T-I11 → AC6    | Claude returns invalid JSON → all fields in `manualFields`, `inferFailed: true`                            |
| T-I12 → AC10   | Claude call times out (10s) → all fields in `manualFields`, `inferFailed: true`                            |
| T-I13 → AC9    | `setFieldValue` throws for one field → that field in `manualFields`, others processed                      |
| T-I14 → AC12   | Unexpected error in inference → all remaining fields in `manualFields`, `inferFailed: true`, Sentry called |
| T-I15 → AC5    | Verify single Claude call regardless of field count (not one per field)                                    |
| T-I16 → E2     | LABELS field with options: options list included in prompt sent to Claude                                  |

**And** `deployment-status-sync.service.spec.ts` is updated to add:

| Test   | Description                                                                       |
| ------ | --------------------------------------------------------------------------------- |
| T-DSS4 | When `factualResult.remainingFields` is empty, `fillInferredFields` is NOT called |
| T-DSS5 | When `factualResult.remainingFields` has fields, `fillInferredFields` IS called   |

### AC17 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS2-3 modified files

---

## Tasks / Subtasks

- [ ] **Task 1**: Add `InferenceContext` and `InferredFillResult` interfaces to `pm-field-auto-fill.service.ts` (AC2, AC3)
  - [ ] Export `InferenceContext` interface from `pm-field-auto-fill.service.ts`
  - [ ] Export `InferredFillResult` interface from `pm-field-auto-fill.service.ts`

- [ ] **Task 2**: Inject `ConfigService` and initialize Anthropic client (AC11)
  - [ ] Add `private readonly config: ConfigService` to constructor (inject last, after `SentryService`)
  - [ ] Add `private readonly anthropicClient: Anthropic | null = null` class field
  - [ ] In constructor body: `const apiKey = this.config.get<string>('anthropic.apiKey'); if (apiKey) { this.anthropicClient = new Anthropic({ apiKey }); }`
  - [ ] Add import: `import Anthropic from '@anthropic-ai/sdk';`
  - [ ] Add import: `import { ConfigService } from '@nestjs/config';`

- [ ] **Task 3**: Implement `fillInferredFields()` method (AC1, AC4–AC13)
  - [ ] AC13: Early return for empty `remainingFields`
  - [ ] AC4: Filter out USER fields → add directly to `manualFields` with debug log
  - [ ] AC11: If `anthropicClient` is null → return fail-open for all estimatable fields
  - [ ] E4: Resolve model via `this.config.get<string>('anthropic.commitMessageModel') || 'claude-haiku-4-5-20251001'`
  - [ ] E3: Build Claude call + wrap in `Promise.race` with 10s timeout using `clearTimeout` cleanup pattern
  - [ ] AC5/E2: Build prompt with field list; include options for DROPDOWN **and LABELS** type fields
  - [ ] AC5/E1: Include `retryCount` and `filesChangedCount` in prompt context lines when present
  - [ ] C1: Call `getProvider()` ONCE before the field loop — never inside the loop
  - [ ] AC6: Parse Claude JSON response; on parse failure → all to manualFields, `inferFailed: true`
  - [ ] AC7/AC8: For each field in parsed response, call `mapInferredValue()` helper
  - [ ] AC9: Sequential `for...of` loop calling `setFieldValue` with per-field error handling
  - [ ] AC12: Outer catch for unexpected errors

- [ ] **Task 4**: Wire into `DeploymentStatusSyncService` (AC14, E1)
  - [ ] Import `InferenceContext` from `pm-field-auto-fill.service.ts`
  - [ ] After CS2-2's factual fill block: if `factualResult.remainingFields.length > 0`, build `InferenceContext` and call `this.pmAutoFillService.fillInferredFields(...)`
  - [ ] Populate `retryCount` from `execRecord.retry_count` and `filesChangedCount` from `execRecord.files_changed` (see AC14 assembly pattern)
  - [ ] Wrap in try/catch (fail-open)
  - [ ] Update `deployment-status-sync.service.spec.ts`: mock `fillInferredFields` on existing mock + add T-DSS4/T-DSS5 tests

- [ ] **Task 5**: Write unit tests (AC16)
  - [ ] Update `src/integrations/pm-field-auto-fill.service.spec.ts`
  - [ ] Add `ConfigService` mock to module setup: `{ provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-api-key') } }`
  - [ ] Use direct private-field injection for `anthropicClient` mock (see "Test Setup" section — do NOT use `jest.mock('@anthropic-ai/sdk')`)
  - [ ] Cover all 16 test cases T-I1 through T-I16
  - [ ] Update `deployment-status-sync.service.spec.ts` with T-DSS4/T-DSS5

- [ ] **Task 6**: TypeScript + lint verification (AC17)
  - [ ] `pnpm typecheck` — zero errors on CS2-3 modified files
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test -- --testPathPattern="pm-field-auto-fill"` — all tests pass

---

## Dev Notes

### What This Story Builds

CS2-3 adds a second fill method to the existing `PMFieldAutoFillService` from CS2-2. The service already exists with `fillFactualFields()`. CS2-3 adds `fillInferredFields()` which uses Claude (via Anthropic SDK direct call) to infer values for fields that couldn't be filled factually — typically story points, priority ratings, and tag/label selections.

CS2-4 (Verification Comment) will consume both `filledFields` from CS2-2 AND `filledFields` from CS2-3 to build the comment. CS2-3 does NOT implement the verification comment.

### Pattern: Direct Anthropic SDK Usage

Follow `src/github/services/github-pr-orchestrator.service.ts` exactly for SDK initialization:

```typescript
// Imports needed:
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';

// Class fields:
private readonly anthropicClient: Anthropic | null = null;

// Constructor addition (ConfigService injected LAST after SentryService):
constructor(
  private readonly providerFactory: PMProviderFactory,
  private readonly sentry: SentryService,
  private readonly config: ConfigService,   // ADD — no @Inject token needed
) {
  const apiKey = this.config.get<string>('anthropic.apiKey');
  if (apiKey) {
    this.anthropicClient = new Anthropic({ apiKey });
  }
}
```

**ConfigService is globally available** — `ConfigModule` is registered globally in `src/app.module.ts`. No change to `IntegrationsModule` imports is needed.

### Anthropic API Call Pattern

Use the minimal `messages.create()` approach, mirroring `github-commit-orchestrator.service.ts`:

```typescript
// Resolve model from config — reuses same config key as commit message model
const model =
  this.config.get<string>('anthropic.commitMessageModel') || 'claude-haiku-4-5-20251001';

const claudeCallPromise = this.anthropicClient.messages.create({
  model,
  max_tokens: 500,
  system: `You are a project management assistant. Your task is to infer values for required PM tool fields based on execution context. Respond ONLY with a valid JSON object where keys are field IDs and values are the inferred field values. Do NOT include fields you are not confident about. Do not include any prose or markdown — only raw JSON.`,
  messages: [
    {
      role: 'user',
      content: this.buildInferencePrompt(estimatableFields, inferenceContext),
    },
  ],
});
```

### Prompt Building

```typescript
private buildInferencePrompt(
  fields: NormalizedField[],
  ctx: InferenceContext,
): string {
  const fieldDescriptions = fields
    .map((f) => {
      let desc = `- Field ID: "${f.id}", Name: "${f.name}", Type: ${f.type}`;
      // Include options for DROPDOWN and LABELS — both have discrete selectable values
      if (
        (f.type === NormalizedFieldType.DROPDOWN || f.type === NormalizedFieldType.LABELS) &&
        f.options?.length
      ) {
        const opts = f.options.map((o) => `"${o.label}" (id: ${o.id})`).join(', ');
        desc += `, Options: [${opts}]`;
      }
      return desc;
    })
    .join('\n');

  const contextLines: string[] = [];
  if (ctx.ticketTitle) contextLines.push(`Ticket Title: ${ctx.ticketTitle}`);
  if (ctx.ticketDescription) contextLines.push(`Ticket Description: ${ctx.ticketDescription}`);
  if (ctx.executionDurationMinutes !== undefined) {
    contextLines.push(`Execution Duration: ${ctx.executionDurationMinutes.toFixed(1)} minutes`);
  }
  if (ctx.retryCount !== undefined && ctx.retryCount > 0) {
    contextLines.push(`Retry Count: ${ctx.retryCount} (task required ${ctx.retryCount} retry/retries — higher complexity indicator)`);
  }
  if (ctx.filesChangedCount !== undefined) {
    contextLines.push(`Files Changed: ${ctx.filesChangedCount}`);
  }

  return [
    'Fields to fill:',
    fieldDescriptions,
    '',
    'Execution Context:',
    contextLines.length > 0 ? contextLines.join('\n') : '(no additional context available)',
    '',
    'Respond with a JSON object. Example: { "field-id-1": "high", "field-id-2": 5 }',
    'For DROPDOWN fields, use the exact option label text (not the ID) — the system will map it.',
    'Omit fields you cannot confidently estimate.',
  ].join('\n');
}
```

**Note on dropdown prompt**: Tell Claude to return the label text (not the ID) — your code then maps the label to the option ID via `f.options.find(o => o.label.toLowerCase() === value.toLowerCase())?.id`. This is more natural for Claude to output.

### Response Parsing and Type Coercion

```typescript
// Parse Claude's response
const textBlock = response.content.find((b) => b.type === 'text');
if (!textBlock || textBlock.type !== 'text') {
  // treat as parse failure
}
const rawJson = (textBlock as { type: 'text'; text: string }).text.trim();
let inferredMap: Record<string, unknown>;
try {
  inferredMap = JSON.parse(rawJson) as Record<string, unknown>;
} catch {
  this.logger.warn(
    `[${correlationId}] CS2-3: failed to parse Claude JSON response — all fields to manualFields`,
  );
  return { filledFields: [], manualFields: estimatableFields, inferFailed: true };
}

// Get provider ONCE before the loop — getProvider() is async and handles token refresh
const provider = await this.providerFactory.getProvider(integration);

// Process each field from inferred map
for (const field of estimatableFields) {
  const rawValue = inferredMap[field.id];
  if (rawValue === undefined) {
    // Claude chose not to infer this field — add to manualFields
    manualFields.push(field);
    continue;
  }
  const mappedValue = this.mapInferredValue(field, rawValue, correlationId);
  if (mappedValue === null) {
    // mapping failed (no dropdown match, non-numeric NUMBER, invalid CHECKBOX)
    manualFields.push(field);
    continue;
  }
  try {
    await provider.setFieldValue(taskId, field.id, mappedValue);
    filledFields.push({ field, value: mappedValue, source: 'ai_inferred' });
  } catch (error) {
    this.logger.warn(
      `[${correlationId}] CS2-3: setFieldValue failed for field ${field.id} (${field.name}): ${(error as Error).message} — adding to manualFields`,
    );
    this.sentry.captureException(error as Error);
    manualFields.push(field);
    inferFailed = true;
  }
}
```

**IMPORTANT — `getProvider()` called ONCE before the loop, NEVER inside it**:

```typescript
// CORRECT — provider resolved once, token refresh happens once:
const provider = await this.providerFactory.getProvider(integration);
for (const field of estimatableFields) {
  await provider.setFieldValue(taskId, field.id, mappedValue); // reuse provider
}

// WRONG — causes N token refresh checks for N fields:
// for (const field of estimatableFields) {
//   const provider = await this.providerFactory.getProvider(integration); // ← WRONG
// }
```

### `mapInferredValue()` Helper

```typescript
private mapInferredValue(
  field: NormalizedField,
  rawValue: unknown,
  correlationId: string,
): FieldValue | null {
  const strVal = String(rawValue);

  if (field.type === NormalizedFieldType.DROPDOWN) {
    const match = field.options?.find(
      (o) => o.label.toLowerCase() === strVal.toLowerCase(),
    );
    if (!match) {
      this.logger.debug(
        `[${correlationId}] CS2-3: dropdown field "${field.name}" — no option match for AI value "${strVal}" — adding to manualFields`,
      );
      return null;
    }
    return match.id;
  }

  if (field.type === NormalizedFieldType.NUMBER) {
    const num = Number(strVal);
    if (isNaN(num)) return null;
    return num;
  }

  if (field.type === NormalizedFieldType.CHECKBOX) {
    if (strVal.toLowerCase() === 'true') return true;
    if (strVal.toLowerCase() === 'false') return false;
    return null;
  }

  // TEXT, URL, OTHER, LABELS (string value)
  return strVal;
}
```

### `DeploymentStatusSyncService` Modification

The entire CS2-2 block in `syncToClickUp()` looks like:

```typescript
// CS2-2 block (already implemented):
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

    // CS2-3 ADDITION — after factual fill:
    if (factualResult.remainingFields.length > 0) {
      try {
        const inferenceContext: InferenceContext = {
          ticketTitle: execution.ticket.title,
          ticketDescription: execution.ticket.description ?? null,
          executionDurationMinutes: ctx.executionDurationMinutes,
        };
        await this.pmAutoFillService.fillInferredFields(
          integration,
          ticketId,
          factualResult.remainingFields,
          inferenceContext,
          finalCorrelationId,
        );
      } catch (_err) {
        // fail-open: inference failure must never block status push
        this.logger.warn(
          `[${finalCorrelationId}] CS2-3: unexpected error in inferred fill block — continuing with status push`,
        );
      }
    }
  }
}
```

Note: `execution.ticket.title` and `execution.ticket.description` are both `String` (non-nullable) in the Prisma schema — no null guard needed. Use them directly without `?? null`.

### Test Setup for Anthropic SDK Mocking

Use the **direct private field injection** approach — bypasses module mock complexity and is consistent with NestJS testing patterns in this codebase:

```typescript
// In Test.createTestingModule providers:
{ provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-api-key') } }

// After module.compile(), before each test:
const service = module.get(PMFieldAutoFillService);
const mockCreate = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(service as any).anthropicClient = { messages: { create: mockCreate } };
```

**Why this approach**: The `ConfigService` mock causes the constructor to run `new Anthropic({ apiKey })` during module init. We then replace `anthropicClient` with a plain mock object — no `jest.mock('@anthropic-ai/sdk')` hoisting needed, no `import` ordering issues.

**For the no-API-key test (T-I3)**: Use a separate module setup where `ConfigService.get` returns `undefined`. The constructor will not call `new Anthropic()`, leaving `anthropicClient = null`. Then call `fillInferredFields()` and assert `inferFailed: true`.

### Mock Claude Response Shape

```typescript
const mockClaudeResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({ 'field-id-1': '5', 'field-id-2': 'High' }),
    },
  ],
};
mockCreate.mockResolvedValue(mockClaudeResponse);
```

### Timeout Test Pattern

```typescript
// T-I12: Timeout
mockCreate.mockImplementation(
  () => new Promise((resolve) => setTimeout(() => resolve(mockClaudeResponse), 15_000)),
);
jest.useFakeTimers();
const promise = service.fillInferredFields(integration, taskId, fields, ctx, correlationId);
jest.advanceTimersByTime(11_000);
const result = await promise;
expect(result.inferFailed).toBe(true);
expect(result.manualFields).toHaveLength(fields.length);
jest.useRealTimers();
```

### NFR-CS3 Compliance

NFR-CS3 states: "AI field inference must be best-effort and non-blocking — timeout or failure skips that field and adds it to manualFields." The 10-second timeout and fail-open error handling fully satisfy this NFR.

### Architecture Compliance

- **`@/` path aliases**: All cross-directory imports use `@/` (e.g., `@/integrations/providers/dto/normalized-field.dto`)
- **NestJS `Logger`**: Already using `new Logger(PMFieldAutoFillService.name)` from CS2-2 — no change
- **`SentryService`**: Already injected from CS2-2 — no change
- **TypeScript strict**: `InferenceContext`, `InferredFillResult`, `FieldValue` must be fully typed — no `any`
- **Never throws**: `fillInferredFields` must never throw — all errors caught, fail-open
- **Sequential provider calls**: `getProvider()` called once, `setFieldValue()` calls are sequential

### Project Structure Notes

| File                                                         | Change Type | Notes                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/integrations/pm-field-auto-fill.service.ts`             | **MODIFY**  | Add `ConfigService` injection, `Anthropic` client init, `InferenceContext`, `InferredFillResult` interfaces, `fillInferredFields()` method, `buildInferencePrompt()` and `mapInferredValue()` helpers |
| `src/integrations/pm-field-auto-fill.service.spec.ts`        | **MODIFY**  | Add `ConfigService` mock to module setup; add 15 new test cases T-I1–T-I15                                                                                                                            |
| `src/github/services/deployment-status-sync.service.ts`      | **MODIFY**  | Import `InferenceContext`; add CS2-3 inference call block after CS2-2 factual fill                                                                                                                    |
| `src/github/services/deployment-status-sync.service.spec.ts` | **MODIFY**  | Add `fillInferredFields` mock to `PMFieldAutoFillService` mock; add T-DSS4/T-DSS5                                                                                                                     |

**Do NOT touch:**

- `src/integrations/integrations.module.ts` — no module change needed (ConfigService is global)
- `src/integrations/pm-field-pre-check.service.ts` — CS2-1 scope, no changes
- `src/integrations/providers/pm-provider.interface.ts` — `setFieldValue` already exists
- `src/integrations/providers/dto/normalized-field.dto.ts` — types already complete
- `src/integrations/providers/clickup/clickup.provider.ts` — no changes needed

### Previous Story Intelligence (from CS2-2)

From CS2-2 (`factual-auto-fill`):

- `PMFieldAutoFillService` is at `src/integrations/pm-field-auto-fill.service.ts`, exported from `IntegrationsModule`
- `ExecutionContext`, `FactualFillResult` interfaces exported from the same file
- Constructor: `constructor(private readonly providerFactory: PMProviderFactory, private readonly sentry: SentryService)` — CS2-3 ADDS `ConfigService` as third param
- `PMProviderFactory.getProvider()` is async, must be awaited ONCE before any loop
- Test setup: `{ provide: PMProviderFactory, useValue: mockProviderFactory }` — no `@Inject` token
- `IntegrationsModule` already has `PMFieldAutoFillService` in providers + exports
- `DeploymentStatusSyncService` already has `PMFieldAutoFillService` injected as `pmAutoFillService`
- The CS2-2 pipeline block in `DeploymentStatusSyncService` is the insertion point for CS2-3

From CS2-1 (`required-field-pre-check`):

- Fail-open pattern: catch + Sentry + return graceful result
- `SentryService.captureException(error as Error)` — no extra metadata
- `NormalizedField` from `@/integrations/providers/dto/normalized-field.dto`

### Git Intelligence (Recent Commits)

1. `1d70c54` — `StartupChecksService` — lifecycle service pattern
2. `d31bb7c` — `DevelopmentGateService` — Logger + SentryService fail-open pattern
3. `eb3d381` — `BotAssignmentService` — structural template for integration services
4. `c60a2fc` — Live status picker completion — `IntegrationsModule` exports pattern
5. `c9dda19` — `ClickUpTaskUpdateConsumer` tests — spec patterns for NestJS unit tests

### References

- FR-CS11: AI inference for story points, complexity, priority, tags [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS11]
- FR-CS12: Dropdown option_id resolution [Source: `epics-clickup-smart-sync.md` #FR-CS12]
- NFR-CS3: AI field inference must be best-effort and non-blocking [Source: `epics-clickup-smart-sync.md` #NFR-CS3]
- Story 2.3 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-2.3]
- CS2-3 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS2-3-ai-inferred-fill]
- CS2-2 story (PMFieldAutoFillService — extended by this story) [Source: `_bmad-output/implementation-artifacts/CS2-2-factual-auto-fill.md`]
- CS2-1 story (PMFieldPreCheckService — consumed upstream) [Source: `_bmad-output/implementation-artifacts/CS2-1-required-field-pre-check.md`]
- `IPMProvider.setFieldValue()` signature [Source: `src/integrations/providers/pm-provider.interface.ts:34`]
- `NormalizedFieldType` enum + `FieldValue` type [Source: `src/integrations/providers/dto/normalized-field.dto.ts`]
- `NormalizedField.options` — `NormalizedFieldOption[]` with `id` and `label` [Source: `src/integrations/providers/dto/normalized-field.dto.ts:16-21`]
- `PMFieldAutoFillService` + `FactualFillResult.remainingFields` [Source: `src/integrations/pm-field-auto-fill.service.ts`]
- `PMProviderFactory.getProvider()` is async — await once before loop [Source: `src/integrations/providers/pm-provider.factory.ts`]
- Anthropic SDK direct usage pattern [Source: `src/github/services/github-pr-orchestrator.service.ts:13-46`]
- `anthropic.apiKey` and `anthropic.commitMessageModel` ConfigService paths [Source: `src/config/configuration.ts:173`]
- `ConfigModule` is globally registered [Source: `src/app.module.ts:83`]
- `DeploymentStatusSync.syncToClickUp()` CS2-2 pipeline insertion point [Source: `src/github/services/deployment-status-sync.service.ts`]
- `Ticket.title String` and `Ticket.description String` (both non-nullable) [Source: `prisma/schema.prisma:44-45`]
- `Execution.retry_count Int @default(0)` [Source: `prisma/schema.prisma:84`]
- `Execution.max_retries Int @default(3)` [Source: `prisma/schema.prisma:85`]
- `Execution.files_changed Json?` (nullable — extract count from array or number) [Source: `prisma/schema.prisma:83`]
- `@anthropic-ai/sdk` version `^0.71.0` [Source: `package.json:83`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/integrations/pm-field-auto-fill.service.ts` — MODIFY: add `ConfigService` injection + `Anthropic` client init + `InferenceContext` (with `retryCount`/`filesChangedCount`) + `InferredFillResult` + `fillInferredFields()` + `buildInferencePrompt()` (LABELS+DROPDOWN options) + `mapInferredValue()` (AC1–AC13, E1–E4, C1)
- `src/integrations/pm-field-auto-fill.service.spec.ts` — MODIFY: add `ConfigService` mock + 16 new test cases T-I1–T-I16 (AC16, O3)
- `src/github/services/deployment-status-sync.service.ts` — MODIFY: import `InferenceContext`, populate `retryCount`/`filesChangedCount`, add CS2-3 inference call block (AC14, E1)
- `src/github/services/deployment-status-sync.service.spec.ts` — MODIFY: add `fillInferredFields` mock + T-DSS4/T-DSS5 (AC16)
