# Story WR-5.1: Add qaMaxRetries to Project Schema & Settings API

Status: DONE

<!-- Note: Validate with validate-create-story if needed before running dev-story. -->

## Story

As a **platform engineer configuring a project**,
I want a `qaMaxRetries` field on the project settings model exposed via the API,
so that each project's QA retry limit can be set independently without touching code.

## Acceptance Criteria

**AC-1: Migration adds qa_max_retries to Project table**
Given the `Project` Prisma model exists with existing QA status fields
When migration `add_qa_max_retries_to_project` is applied
Then a new `qa_max_retries Int @default(3)` column is added to the `projects` table
And all existing project rows receive the default value of 3 with no data loss (NFR-EXT2)

**AC-2: GET project response includes qaMaxRetries**
Given the project detail GET endpoint is called (`GET /api/v1/projects/:id`)
When the response is returned
Then `qa_max_retries` is included in the response body alongside `qa_failure_status`, `manual_review_status`, `code_review_status`

**AC-3: PATCH qa-status-config updates qaMaxRetries**
Given a PATCH request to `PATCH /api/v1/projects/:id/qa-status-config` with `{ "qaMaxRetries": 5 }`
When the request is processed
Then the project's `qa_max_retries` is updated to 5 in the database
And the updated project is returned

**AC-4: Validation — minimum 1**
Given a PATCH request is made with `{ "qaMaxRetries": 0 }`
When the request is validated
Then a `422 Unprocessable Entity` is returned — minimum value is 1 (NFR-EXT1)

**AC-5: Validation — maximum 10**
Given a PATCH request is made with `{ "qaMaxRetries": 11 }`
When the request is validated
Then a `422 Unprocessable Entity` is returned — maximum value is 10 (NFR-EXT1)

**AC-6: Existing fields unchanged (purely additive)**
Given existing project settings endpoints exist
When `qa_max_retries` is added
Then all existing fields (`qa_failure_status`, `manual_review_status`, `code_review_status`) remain unchanged in shape and response (NFR-EXT8)

**AC-7: Build clean**
Given all changes applied
When `pnpm test -- --testPathPattern="project.controller|project.service"` runs
Then all tests pass with zero TypeScript errors (`pnpm typecheck`)

---

## Tasks / Subtasks

- [ ] Task 1: Add `qa_max_retries` to Project schema and create migration (AC: 1)
  - [ ] 1.1: In `prisma/schema.prisma`, add `qa_max_retries Int @default(3)` after `code_review_status` on the `Project` model (see exact location below)
  - [ ] 1.2: Run `pnpm db:migrate -- --name add_qa_max_retries_to_project` to create and apply migration (the `--` separator passes the name arg through to `prisma migrate dev`)
  - [ ] 1.3: Run `pnpm db:generate` to regenerate Prisma client
  - [ ] 1.4: Verify migration SQL contains `ALTER TABLE "projects" ADD COLUMN "qa_max_retries" INTEGER NOT NULL DEFAULT 3`

- [ ] Task 2: Extend UpdateQaStatusConfigDto with qaMaxRetries (AC: 3, 4, 5)
  - [ ] 2.1: In `src/projects/dto/update-qa-status-config.dto.ts`, add `qaMaxRetries?: number` field with `@IsOptional() @IsInt() @Min(1) @Max(10)` validators (handles type-level 400; range 422 is done in the service — see Task 3)
  - [ ] 2.2: Add `@ApiPropertyOptional` decorator with description, example (`3`), min/max documented
  - [ ] 2.3: Import `IsInt, Min, Max` from `class-validator` (add to existing import line)

- [ ] Task 3: Update service to handle qaMaxRetries with 422 range guard (AC: 3, 4, 5, 6)
  - [ ] 3.1: Import `UnprocessableEntityException` from `@nestjs/common` at the top of `src/projects/project.service.ts`
  - [ ] 3.2: In `updateQaStatusConfig()` (line ~434), add the range guard and null guard before building `updateData` — see exact code in Dev Notes below
  - [ ] 3.3: Guard uses `!= null` (double-equals — catches both `null` AND `undefined`) not `!== undefined`

- [ ] Task 4: Update controller Swagger docs (AC: 3, 4, 5)
  - [ ] 4.1: In `src/projects/project.controller.ts`, add `@ApiResponse({ status: 422, description: 'qaMaxRetries out of range — must be 1–10' })` on the `updateQaStatusConfig` endpoint

- [ ] Task 5: Write tests (AC: 7)
  - [ ] 5.1: In `src/projects/project.service.spec.ts` — `describe('updateQaStatusConfig')` block — add:
    - `qaMaxRetries: 5` → `repository.update` called with `{ qa_max_retries: 5 }`, result returned
    - `qaMaxRetries: 1` → valid lower bound, update called
    - `qaMaxRetries: 10` → valid upper bound, update called
    - `qaMaxRetries: 0` → throws `UnprocessableEntityException`, `repository.update` NOT called
    - `qaMaxRetries: 11` → throws `UnprocessableEntityException`, `repository.update` NOT called
    - `qaMaxRetries: null` (or `undefined`) → no-op branch, `repository.update` NOT called for that field
  - [ ] 5.2: In `src/projects/project.controller.spec.ts`, add test that `PATCH :id/qa-status-config` with `{ qaMaxRetries: 5 }` calls `projectService.updateQaStatusConfig` with the correct args
  - [ ] 5.3: Run `pnpm test -- --testPathPattern="project.controller|project.service"` — all tests green

---

## Dev Notes

### THIS STORY SCOPE — WR-5.1 ONLY

**WR-5.1 is schema + settings API only.** Do NOT touch providers in this story.

- WR-5.2 (next story) wires all 4 providers to read `qaMaxRetries` from the project record and replace hardcoded `'3'` literals.
- WR-5.1 ONLY adds the DB field and exposes it via the project settings API.

### Exact Schema Change

**File:** `prisma/schema.prisma`
**Insert after line 28** (after `code_review_status`):

```prisma
// CURRENT (lines 26-28):
qa_failure_status     String?   // WR-4.2: ClickUp status name for QA exhaustion (FR-WR11)
manual_review_status  String?   // WR-4.2: ClickUp status name for PM cancel action (FR-WR11, WR-4.3)
code_review_status    String?   // WR-4.2: ClickUp status name after open_pr action (FR-WR11, WR-4.3)

// ADD THIS (line 29):
qa_max_retries        Int       @default(3)   // WR-5.1: Per-project QA retry limit (FR-EXT1, NFR-EXT1/2)
```

### DTO Extension

**File:** `src/projects/dto/update-qa-status-config.dto.ts`

Add this field at the end of the class:

```typescript
import { IsString, IsOptional, MinLength, IsInt, Min, Max } from 'class-validator';

// ADD at end of UpdateQaStatusConfigDto class:
@ApiPropertyOptional({
  description: 'Max QA retry attempts for this project (1–10). Default: 3. Takes effect on next execution only.',
  example: 3,
  minimum: 1,
  maximum: 10,
})
@IsOptional()
@IsInt()
@Min(1, { message: 'qaMaxRetries must be at least 1' })
@Max(10, { message: 'qaMaxRetries must be at most 10' })
qaMaxRetries?: number;
```

**NAMING NOTE:** The story AC uses `qaMaxRetries` (camelCase) in `{ "qaMaxRetries": 5 }`. The existing DTO fields use snake_case (`qa_failure_status`). Use camelCase `qaMaxRetries` for this new field to match the story spec. The Prisma model field is `qa_max_retries` (snake_case); the service maps `dto.qaMaxRetries` → `updateData.qa_max_retries`.

### 422 vs 400 — Definitive Implementation

**Context:** The global `ValidationPipe` is registered in `src/app.module.ts` (lines 200–209):

```typescript
new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });
```

No `errorHttpStatusCode` is set → `@Min`/`@Max` produce **HTTP 400**. Do NOT change the global pipe (it would affect all endpoints).

**Approach:** Keep `@IsInt() @Min(1) @Max(10)` on the DTO for type-level rejection (400 for non-integers), and add an **explicit service-level range guard** that throws `UnprocessableEntityException` (422) for out-of-range integers. This is the same pattern used in WR-4.3 for 409/422 state validation.

### Service Method Pattern (exact reuse)

**File:** `src/projects/project.service.ts` — method `updateQaStatusConfig()` at line ~434

```typescript
// Add to imports at top of file:
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

// Updated method body:
async updateQaStatusConfig(projectId: string, dto: UpdateQaStatusConfigDto): Promise<Project> {
  const existing = await this.repository.findById(projectId);
  if (!existing) throw new NotFoundException(`Project ${projectId} not found`);

  const updateData: Prisma.ProjectUpdateInput = {};
  if (dto.qa_failure_status !== undefined) updateData.qa_failure_status = dto.qa_failure_status;
  if (dto.manual_review_status !== undefined) updateData.manual_review_status = dto.manual_review_status;
  if (dto.code_review_status !== undefined) updateData.code_review_status = dto.code_review_status;

  // WR-5.1: qaMaxRetries — use != null (catches both null AND undefined)
  // Null guard prevents propagating null to a non-nullable DB column
  if (dto.qaMaxRetries != null) {
    if (dto.qaMaxRetries < 1 || dto.qaMaxRetries > 10) {
      throw new UnprocessableEntityException(
        `qaMaxRetries must be between 1 and 10 (inclusive), got: ${dto.qaMaxRetries}`,
      );
    }
    updateData.qa_max_retries = dto.qaMaxRetries;
  }

  if (Object.keys(updateData).length === 0) {
    this.logger.log(`[WR-4.2] No fields to update for project ${projectId} — returning existing record`);
    return existing;
  }

  const updated = await this.repository.update(projectId, updateData);
  this.logger.log(`[WR-4.2] QA status config updated for project ${projectId}`);
  return updated;
}
```

**Why `!= null` not `!== undefined`:** `@IsOptional()` in class-validator treats `null` as absent, so `{ "qaMaxRetries": null }` passes DTO validation. If `null` reached `updateData.qa_max_retries`, Prisma would throw a write error on the non-nullable `Int` column. The `!= null` guard (double-equals) catches both `null` and `undefined` in one check.

After `pnpm db:generate`, `Prisma.ProjectUpdateInput` will include `qa_max_retries?: number | null` — TypeScript will confirm the assignment.

### GET Response — Automatic Exposure

The `GET /api/v1/projects/:id` returns the Prisma `Project` entity directly. After adding `qa_max_retries Int @default(3)` to the schema and regenerating, the field is automatically included in all project GET responses. No changes needed to the GET controller endpoint.

The response JSON key will be `qa_max_retries` (snake_case, Prisma's default for non-mapped fields) consistent with existing `qa_failure_status`, `manual_review_status`, `code_review_status`.

### Files to Touch (Complete List)

| File                                                                      | Change                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                    | Add `qa_max_retries Int @default(3)` to `Project` model                                            |
| `prisma/migrations/TIMESTAMP_add_qa_max_retries_to_project/migration.sql` | Auto-generated by `pnpm db:migrate`                                                                |
| `src/projects/dto/update-qa-status-config.dto.ts`                         | Add `qaMaxRetries?: number` with validators                                                        |
| `src/projects/project.service.ts`                                         | Add `qaMaxRetries` branch + `UnprocessableEntityException` range guard in `updateQaStatusConfig()` |
| `src/projects/project.controller.ts`                                      | Add `@ApiResponse(422)` on `updateQaStatusConfig` endpoint                                         |
| `src/projects/project.service.spec.ts`                                    | Add tests for `qaMaxRetries` update                                                                |
| `src/projects/project.controller.spec.ts`                                 | Add test for PATCH with `qaMaxRetries`                                                             |

**DO NOT TOUCH:** Any provider files (`claude-code.provider.ts`, `codex.provider.ts`, `kimi.provider.ts`, `gemini.provider.ts`) — that's WR-5.2.

### Anti-Pattern Prevention

1. **Do not create a separate endpoint** — add `qaMaxRetries` to the existing `PATCH :id/qa-status-config` endpoint via the existing DTO.
2. **Do not add a GET /qa-status-config endpoint** — the project detail endpoint already exposes all project fields; `qa_max_retries` will appear automatically.
3. **Do not hardcode a fallback in this story** — the DB default of 3 handles NFR-EXT2. Provider fallback logic belongs in WR-5.2.
4. **Do not use `@Transform`** on the DTO field — the existing DTO pattern uses raw validators only.
5. **Do not use `!== undefined` for the null guard** — use `!= null` (double-equals) to catch both `null` and `undefined`, preventing a null write to a non-nullable `Int` DB column.
6. **Do not change the global ValidationPipe in `app.module.ts`** — it would affect all endpoints. Use the service-level `UnprocessableEntityException` pattern for 422 instead.
7. **Do not rely on `@Min`/`@Max` for 422** — the global pipe returns 400 for these; the service-level guard is the correct mechanism for 422 on range violations.

### Previous Story Context (WR-4.3)

The most recent completed story (WR-4.3, commit `542281a`) implemented `POST /api/v1/executions/:id/resolve-qa-failure`. Key patterns from that work:

- 409 for state conflicts, 422 for unprocessable input, 404 for not found — same pattern applies here for 422 on out-of-range `qaMaxRetries`
- All QA-related service logic lives in `src/projects/project.service.ts` (for project settings) and `src/execution/` (for execution logic)
- Tests in `project.controller.spec.ts` and `project.service.spec.ts` follow standard NestJS unit test pattern: mock repository, call service method, assert result

### WR-4.2 Migration Reference

The WR-4.2 migration (`prisma/migrations/20260402185858_add_project_qa_status_fields/migration.sql`) is:

```sql
ALTER TABLE "projects" ADD COLUMN "code_review_status" TEXT,
ADD COLUMN "manual_review_status" TEXT,
ADD COLUMN "qa_failure_status" TEXT;
```

For WR-5.1, the new migration should produce:

```sql
ALTER TABLE "projects" ADD COLUMN "qa_max_retries" INTEGER NOT NULL DEFAULT 3;
```

This is non-destructive (all existing rows get default 3) satisfying NFR-EXT2.

### Project Structure Notes

- DTOs: `src/projects/dto/` — one DTO per concern, no monolithic DTOs
- Service: `src/projects/project.service.ts` — all project mutation logic
- Repository: `src/projects/project.repository.ts` — Prisma passthrough, no business logic
- Controller: `src/projects/project.controller.ts` — route mapping, guards, Swagger docs
- All imports use `@/` path alias (e.g. `@/common/guards/auth.guard`), never relative paths

### References

- FR-EXT1, FR-EXT3: `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md` — Epic WR-5 / Story WR-5.1 ACs
- NFR-EXT1 (422 validation), NFR-EXT2 (default 3, no data loss), NFR-EXT7 (in-flight unaffected), NFR-EXT8 (additive): same file
- Existing DTO pattern: `src/projects/dto/update-qa-status-config.dto.ts`
- Existing service pattern: `src/projects/project.service.ts` — `updateQaStatusConfig()` (~L434)
- Existing controller pattern: `src/projects/project.controller.ts` — `updateQaStatusConfig()` (L198–207)
- WR-5.2 (next story): Wire all 4 providers to per-project `qaMaxRetries` — do NOT implement that here

---

### Review Findings

- [x] [Review][Patch] P1 — Remove `@Min(1)` and `@Max(10)` from DTO; they cause global ValidationPipe to return HTTP 400 before service-level 422 guard fires, making the `UnprocessableEntityException` dead code and `@ApiResponse(422)` misleading. Fix: remove `@Min`/`@Max` from `UpdateQaStatusConfigDto.qaMaxRetries` (keep `@IsInt()` + `@IsOptional()`); update controller spec range test to assert `UnprocessableEntityException` propagation rather than DTO-level validation errors. [`src/projects/dto/update-qa-status-config.dto.ts`, `src/projects/project.controller.spec.ts`]
- [x] [Review][Defer] D1 — No test for explicit `null` body value (`{ qaMaxRetries: null }` → silent no-op via `!= null` guard). Behavior is correct but undocumented. [`src/projects/project.service.spec.ts`] — deferred, pre-existing gap
- [x] [Review][Defer] D2 — No test for combined PATCH (e.g. `{ qa_failure_status: null, qaMaxRetries: 5 }`) to verify multi-field `updateData` merging. [`src/projects/project.service.spec.ts`] — deferred, pre-existing gap
- [x] [Review][Defer] D3 — Out-of-range service spec test does not assert `repository.findById` was called before guard fires. [`src/projects/project.service.spec.ts:567`] — deferred, minor ordering gap

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
