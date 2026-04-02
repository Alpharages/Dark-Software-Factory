# Story WR-4.2: Add Per-Project QA Failure & Manual Review Status Configuration

Status: done

## Story

As a **platform engineer configuring a project**,
I want `qa_failure_status` and `manual_review_status` to be configurable per project in the project settings model,
So that ClickUp status transitions for QA failures can be customised per project without hardcoding status name strings anywhere in the backend.

## Acceptance Criteria

**AC-1: Schema fields added to Project model**
**Given** the existing project settings model (`prisma/schema.prisma`)
**When** the schema is updated
**Then** three new optional string fields are added to `Project`: `qa_failure_status String?`, `manual_review_status String?`, and `code_review_status String?` (FR-WR11; `code_review_status` is added here to avoid a second migration for WR-4.3 which reads it)
**And** the schema migration applies cleanly with no data loss to existing project records (all new fields default to `null`)

**AC-2: PATCH endpoint to configure the three status fields**
**Given** an authenticated ADMIN, MANAGER, or PM user
**When** `PATCH /api/v1/projects/:id/qa-status-config` is called with any subset of `{ qa_failure_status, manual_review_status, code_review_status }`
**Then** the project record is updated with the provided values
**And** null is accepted to clear a previously set value
**And** the updated project record is returned

**AC-3: Non-empty string or null only**
**Given** the PATCH endpoint
**When** an empty string `""` is provided for any field
**Then** a 400 Bad Request is returned (empty strings are not valid status names)

**AC-4: PMExecutionStatusService.notifyQAFailure() uses typed field post-migration**
**Given** WR-4.1 uses `(project as any)?.qa_failure_status` as a workaround pending this story
**When** WR-4.2 adds `qa_failure_status` to the Prisma schema and regenerates the client
**Then** the `(project as any)` cast in `pm-execution-status.service.ts` is replaced with the typed `project.qa_failure_status` — no more `eslint-disable` comment on that line

**AC-5: 404 on unknown project**
**Given** the PATCH endpoint is called with a project ID that does not exist
**When** the service attempts to update the project
**Then** a `404 Not Found` response is returned

**AC-6: Build clean**
**Given** all changes applied
**When** `pnpm test -- --testPathPattern="project.controller|project.service"` runs
**Then** all tests pass with zero TypeScript errors (`pnpm typecheck`)

---

## Tasks / Subtasks

> **Context before starting:** WR-4.1 (`wr-4-1-implement-hard-qa-failure-provider-behaviour-state-transition.md`) is in `ready-for-dev` state — it uses `(project as any)?.qa_failure_status` as a placeholder until this story's schema migration lands. WR-4.3 uses `code_review_status` and `manual_review_status`. This story provides the schema foundation for both.

---

- [x] Task 1: Add three new optional fields to `prisma/schema.prisma` (AC: 1)
- [x] Task 2: Create `UpdateQaStatusConfigDto` (AC: 2, 3)
- [x] Task 3: Add `updateQaStatusConfig()` to `ProjectService` (AC: 2, 5)
- [x] Task 4: Add `PATCH :id/qa-status-config` endpoint to `ProjectController` (AC: 2, 3, 5)
- [x] Task 5: Remove `(as any)` cast in `PMExecutionStatusService.notifyQAFailure()` (AC: 4)
- [x] Task 6: Tests for `ProjectController.updateQaStatusConfig` (AC: 2, 3, 5)
- [x] Task 7: Tests for `ProjectService.updateQaStatusConfig` (AC: 2, 5)
- [x] Task 8: Run and verify (AC: 6)
  - [x] 8.1 `pnpm db:validate` → schema integrity confirmed before migration
  - [x] 8.2 `pnpm db:migrate` → migration `add_project_qa_status_fields` applied cleanly
  - [x] 8.3 `pnpm db:generate` → Prisma client has `qa_failure_status`, `manual_review_status`, `code_review_status` on `Project` type
  - [x] 8.4 `pnpm test -- --testPathPattern="project.controller"` → green
  - [x] 8.5 `pnpm test -- --testPathPattern="project.service"` → green
  - [x] 8.6 _(Conditional — only if Task 5 was applied)_ `pnpm test -- --testPathPattern="pm-execution-status"` → green
  - [x] 8.7 `pnpm typecheck` → zero errors (especially verify Task 5 cast removal and new `Prisma` import in service both compile cleanly)
  - [x] 8.8 `pnpm build` → clean build

---

## Dev Notes

### What Is Already Built (Do NOT Re-implement)

- `PMStatusService` (`src/integrations/pm-status.service.ts`) — already does runtime status discovery with 5-min cache and stale fallback. WR-4.1's `notifyQAFailure()` already calls `provider.getStatuses()` directly (same mechanism). **Do not add a new status discovery path.**
- `ProjectRepository.update(id, data: Prisma.ProjectUpdateInput)` — exists at `src/projects/project.repository.ts:L73`. Use it directly.
- `ProjectService.updateStatus()` — the pattern for guard-then-update. Follow it exactly.
- The existing `PATCH /projects/:id` (via `UpdateProjectDto`) does NOT include these status fields — intentional. Dedicated endpoint `PATCH :id/qa-status-config` keeps concerns separate.

### Why Three Fields (Not Two)

FR-WR11 names `qa_failure_status` and `manual_review_status`. However, WR-4.3 also reads `project.code_review_status` for the `open_pr` action (moving to code review after creating the PR). Adding all three fields in the same migration avoids a second schema migration when WR-4.3 is implemented.

### `qa_failure_status` Field Ownership

This field lives on the `Project` model (not `ProjectIntegration`). It is the configured **name** of the ClickUp status — the actual ClickUp status ID is resolved at runtime via `provider.getStatuses()` + case-insensitive name match. This is the FR-WR11 "no hardcoded ClickUp status name strings" pattern.

### WR-4.1 Dependency Clarification

WR-4.1 (`ready-for-dev`) is sequenced to implement BEFORE WR-4.2 in sprint order, but it intentionally uses `(project as any)?.qa_failure_status` to compile cleanly without this story's schema migration. The sequencing is:

- **Implement WR-4.1 first** (it handles the QA_FAILED state machine + ClickUp notification with graceful null-config fallback)
- **Then implement WR-4.2** (adds the schema + CRUD endpoint + removes the `as any` cast)

If implementing out of order (WR-4.2 before WR-4.1): WR-4.1's `(project as any)` pattern still compiles cleanly even after the schema adds the field — the `as any` cast is just unnecessary, not wrong.

### `notifyQAFailure()` Read Pattern (Pre-WR-4.2)

WR-4.1 reads `qa_failure_status` via:

```typescript
const project = await this.prisma.project.findUnique({ where: { id: projectId } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qaFailureStatus = ((project as any)?.qa_failure_status as string | null) ?? null;
```

After WR-4.2 runs `pnpm db:generate`:

```typescript
const project = await this.prisma.project.findUnique({ where: { id: projectId } });
const qaFailureStatus = project?.qa_failure_status ?? null;
```

### `@MinLength(1)` with `@IsOptional()` Pattern

The `UpdateSyncConfigDto` pattern (used by `ai_trigger_status`) has a subtle interaction: `@IsOptional()` makes the field skippable when `undefined`, but `@MinLength(1)` still fires when the field is present and is an empty string `""`. This is intentional — it rejects `""` while allowing `null` (which clears the field) and `undefined` (which leaves the field unchanged). Replicate this exact triple in `UpdateQaStatusConfigDto`.

### Project Model Location

`prisma/schema.prisma` — `model Project` starts at line 9. The three new fields should be added after `is_active Boolean @default(true)` (line 25) and before the relation fields (`conversations`, `coverage_baseline`, etc.). All new fields are `String?` (nullable, no default).

### Files to Create/Modify (Complete List)

| File                                              | Change                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                            | Add `qa_failure_status`, `manual_review_status`, `code_review_status` as `String?` to `Project` model |
| `src/projects/dto/update-qa-status-config.dto.ts` | **NEW** — DTO with three optional nullable-string fields                                              |
| `src/projects/project.service.ts`                 | Add `updateQaStatusConfig()` method                                                                   |
| `src/projects/project.controller.ts`              | Add `PATCH :id/qa-status-config` endpoint                                                             |
| `src/integrations/pm-execution-status.service.ts` | Remove `(as any)` cast for `qa_failure_status` (Task 5 — only if WR-4.1 is merged)                    |

### Test Files to Create/Update

| File                                      | Change                                |
| ----------------------------------------- | ------------------------------------- |
| `src/projects/project.controller.spec.ts` | Add `updateQaStatusConfig` test suite |
| `src/projects/project.service.spec.ts`    | Add `updateQaStatusConfig` test suite |

### Mock Fixture Note

Both spec files have a `mockProject` fixture. The fixture must include the three new fields when testing WR-4.2 methods — add them as `null` since that's the schema default:

```typescript
qa_failure_status: null,
manual_review_status: null,
code_review_status: null,
```

### References

- [Source: `_bmad-output/planning-artifacts/epics-workspace-removal.md` — Story WR-4.2, FR-WR11]
- [Source: `_bmad-output/implementation-artifacts/wr-4-1-implement-hard-qa-failure-provider-behaviour-state-transition.md` — Task 6, Dev Notes §"Prisma Access Pattern for qa_failure_status (Pre-WR-4.2)"]
- [Source: `src/projects/dto/update-sync-config.dto.ts` — `@IsOptional()` + `@MinLength(1)` pattern]
- [Source: `src/projects/project.controller.ts:L253–L285` — `updateSyncConfig` endpoint pattern]
- [Source: `src/projects/project.service.ts` — `updateStatus()` guard-then-update pattern]
- [Source: `prisma/schema.prisma:L9–L39` — `Project` model field ordering]

---

## Review Findings

- [x] [Review][Patch] No-op DB write when all DTO fields are undefined — guard `updateData` before calling `repository.update` [project.service.ts:L443–449]
- [x] [Review][Patch] NotFoundException test missing `not.toHaveBeenCalled()` on `repository.update` [project.service.spec.ts:L527–529]
- [x] [Review][Patch] Null-clearing path not validated through `plainToInstance`+`validate()` in controller spec [project.controller.spec.ts:L359]
- [x] [Review][Patch] Log emitted before `repository.update()` resolves — move to after or add error-path log [project.service.ts:L448]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

| File                                                                          | Change                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                        | Added `qa_failure_status`, `manual_review_status`, `code_review_status` as `String?` to `Project` model |
| `prisma/migrations/20260402185858_add_project_qa_status_fields/migration.sql` | Migration: `ALTER TABLE "projects" ADD COLUMN` for three new fields                                     |
| `src/projects/dto/update-qa-status-config.dto.ts`                             | **NEW** — DTO with three optional nullable-string fields + `@MinLength(1)` guards                       |
| `src/projects/project.service.ts`                                             | Added `updateQaStatusConfig()` method; added `Prisma` to import                                         |
| `src/projects/project.controller.ts`                                          | Added `PATCH :id/qa-status-config` endpoint                                                             |
| `src/integrations/pm-execution-status.service.ts`                             | Removed `(as any)` cast for `qa_failure_status`                                                         |
| `src/projects/project.controller.spec.ts`                                     | Added `updateQaStatusConfig` test suite + new fields to `mockProject` fixture                           |
| `src/projects/project.service.spec.ts`                                        | Added `updateQaStatusConfig` test suite + new fields to `mockProject` fixture                           |
