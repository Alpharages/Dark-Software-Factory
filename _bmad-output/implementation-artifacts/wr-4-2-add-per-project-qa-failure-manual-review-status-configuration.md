# Story WR-4.2: Add Per-Project QA Failure & Manual Review Status Configuration

Status: ready-for-dev

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

- [ ] Task 1: Add three new optional fields to `prisma/schema.prisma` (AC: 1)

  In `prisma/schema.prisma`, add after the `is_active` field in the `Project` model (near line 25, before the relation fields):

  ```prisma
  qa_failure_status     String?                            // WR-4.2: ClickUp status name for QA exhaustion (FR-WR11)
  manual_review_status  String?                            // WR-4.2: ClickUp status name for PM cancel action (FR-WR11, WR-4.3)
  code_review_status    String?                            // WR-4.2: ClickUp status name after open_pr action (FR-WR11, WR-4.3)
  ```

  All three fields are `String?` (nullable) — no default value needed (null = "not configured").
  - [ ] 1.1 Run `pnpm db:migrate` — name the migration `add_project_qa_status_fields`
  - [ ] 1.2 Run `pnpm db:generate` to regenerate the Prisma client

---

- [ ] Task 2: Create `UpdateQaStatusConfigDto` (AC: 2, 3)

  Create new file `src/projects/dto/update-qa-status-config.dto.ts`:

  ```typescript
  import { IsString, IsOptional, MinLength } from 'class-validator';
  import { ApiPropertyOptional } from '@nestjs/swagger';

  export class UpdateQaStatusConfigDto {
    @ApiPropertyOptional({
      description:
        'ClickUp status name to move ticket to when QA retries are exhausted. Pass null to clear.',
      example: 'QA Failed',
      nullable: true,
    })
    @IsOptional()
    @IsString()
    @MinLength(1, { message: 'qa_failure_status must be a non-empty string or null' })
    qa_failure_status?: string | null;

    @ApiPropertyOptional({
      description:
        'ClickUp status name to move ticket to when PM cancels QA-failed execution. Pass null to clear.',
      example: 'Needs Manual Review',
      nullable: true,
    })
    @IsOptional()
    @IsString()
    @MinLength(1, { message: 'manual_review_status must be a non-empty string or null' })
    manual_review_status?: string | null;

    @ApiPropertyOptional({
      description:
        'ClickUp status name to move ticket to after open_pr on QA-failed execution. Pass null to clear.',
      example: 'Code Review',
      nullable: true,
    })
    @IsOptional()
    @IsString()
    @MinLength(1, { message: 'code_review_status must be a non-empty string or null' })
    code_review_status?: string | null;
  }
  ```

  > **Pattern match:** This mirrors `UpdateSyncConfigDto` at `src/projects/dto/update-sync-config.dto.ts` — same `@IsOptional()` + `@IsString()` + `@MinLength(1)` triple for nullable-but-not-empty strings.

---

- [ ] Task 3: Add `updateQaStatusConfig()` to `ProjectService` (AC: 2, 5)

  In `src/projects/project.service.ts`:
  - [ ] 3.1 Update the top-of-file import for `@/prisma/client` — `Prisma` namespace is not currently imported in this service but is needed for `Prisma.ProjectUpdateInput`. Change:
    ```typescript
    import { Project } from '@/prisma/client';
    ```
    To:
    ```typescript
    import { Project, Prisma } from '@/prisma/client';
    ```
    Also add the new DTO import with the existing project DTO imports:
    ```typescript
    import { UpdateQaStatusConfigDto } from './dto/update-qa-status-config.dto';
    ```
  - [ ] 3.2 Add the method after `updateStatus()`:

    ```typescript
    /**
     * Update per-project QA status configuration fields (WR-4.2).
     * Accepted fields: qa_failure_status, manual_review_status, code_review_status.
     * All are optional; only provided fields are written (undefined = no change, null = clear).
     */
    async updateQaStatusConfig(
      projectId: string,
      dto: UpdateQaStatusConfigDto,
    ): Promise<Project> {
      const existing = await this.repository.findById(projectId);
      if (!existing) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }

      const updateData: Prisma.ProjectUpdateInput = {};
      if (dto.qa_failure_status !== undefined) updateData.qa_failure_status = dto.qa_failure_status;
      if (dto.manual_review_status !== undefined) updateData.manual_review_status = dto.manual_review_status;
      if (dto.code_review_status !== undefined) updateData.code_review_status = dto.code_review_status;

      this.logger.log(`[WR-4.2] Updating QA status config for project ${projectId}`);
      return this.repository.update(projectId, updateData);
    }
    ```

  > **Existing pattern:** `ProjectService.updateStatus()` follows this same guard-then-update pattern. `ProjectRepository.update(id, data: Prisma.ProjectUpdateInput)` already exists at `src/projects/project.repository.ts:L73`.

---

- [ ] Task 4: Add `PATCH :id/qa-status-config` endpoint to `ProjectController` (AC: 2, 3, 5)

  In `src/projects/project.controller.ts`:
  - [ ] 4.1 Add the import for the new DTO (add to the existing DTO import block):

    ```typescript
    import { UpdateQaStatusConfigDto } from './dto/update-qa-status-config.dto';
    ```

  - [ ] 4.2 Add the endpoint after `updateStatus()` (around line 196):
    ```typescript
    @Patch(':id/qa-status-config')
    @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
    @ApiOperation({ summary: 'Update per-project QA failure and manual review ClickUp status names' })
    @ApiParam({ name: 'id', description: 'Project ID' })
    @ApiResponse({ status: 200, description: 'QA status configuration updated successfully' })
    @ApiResponse({ status: 400, description: 'Empty string not accepted — use null to clear' })
    @ApiResponse({ status: 404, description: 'Project not found' })
    updateQaStatusConfig(
      @Param('id') id: string,
      @Body() dto: UpdateQaStatusConfigDto,
    ) {
      return this.projectService.updateQaStatusConfig(id, dto);
    }
    ```

  > **Pattern:** Matches `PATCH :id/status` structure. Role guard: ADMIN + MANAGER + PM (PM needs to configure their own project — same as `updateSyncConfig`).

---

- [ ] Task 5: Remove `(as any)` cast in `PMExecutionStatusService.notifyQAFailure()` (AC: 4)

  In `src/integrations/pm-execution-status.service.ts`, in the `notifyQAFailure()` method (added by WR-4.1):

  Replace:

  ```typescript
  const project = await this.prisma.project.findUnique({ where: { id: projectId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qaFailureStatus = ((project as any)?.qa_failure_status as string | null) ?? null;
  ```

  With:

  ```typescript
  const project = await this.prisma.project.findUnique({ where: { id: projectId } });
  const qaFailureStatus = project?.qa_failure_status ?? null;
  ```

  > **Context:** WR-4.1 used `(project as any)` because `qa_failure_status` didn't exist in the Prisma schema yet. After Task 1 adds it and `pnpm db:generate` regenerates the client (Task 1.2), the field is properly typed on the `Project` type and the cast is no longer needed. **Only apply this task if WR-4.1 has already been merged into the codebase.** If WR-4.1 is not yet merged, skip this task — the WR-4.1 developer will pick it up.

---

- [ ] Task 6: Tests for `ProjectController.updateQaStatusConfig` (AC: 2, 3, 5)

  In `src/projects/project.controller.spec.ts`:
  - [ ] 6.0 **Update `mockProject` fixture** — after `pnpm db:generate` the Prisma `Project` type gains the three new nullable fields. TypeScript strict mode will reject `.mockResolvedValue(mockProject)` if the fixture is missing them. Add to the `mockProject` object (around line 37, after `deactivated_at: null`):

    ```typescript
    qa_failure_status: null,
    manual_review_status: null,
    code_review_status: null,
    ```

  - [ ] 6.1 Add `updateQaStatusConfig` to the `ProjectService` mock in the test module:

    ```typescript
    updateQaStatusConfig: jest.fn().mockResolvedValue({ ...mockProject, qa_failure_status: 'QA Failed' }),
    ```

  - [ ] 6.2 Add describe block `'updateQaStatusConfig'` with test cases:
    - `'should update qa_failure_status when provided'` — call `controller.updateQaStatusConfig('project-123', { qa_failure_status: 'QA Failed' })`, assert `projectService.updateQaStatusConfig` called with `('project-123', { qa_failure_status: 'QA Failed' })`
    - `'should clear qa_failure_status when null passed'` — call with `{ qa_failure_status: null }`, assert service called with `{ qa_failure_status: null }`
    - `'should update all three fields in one call'` — call with all three fields set, assert service called with all three
    - `'should reject empty string via validation'` — use `plainToInstance(UpdateQaStatusConfigDto, { qa_failure_status: '' })` + `validate()`, assert at least one validation error on `qa_failure_status`

  > **Pattern:** Follow the `updateSyncConfig` test block at lines 246–315 of `project.controller.spec.ts` — identical structure.

---

- [ ] Task 7: Tests for `ProjectService.updateQaStatusConfig` (AC: 2, 5)

  In `src/projects/project.service.spec.ts`:
  - [ ] 7.0 **Update `mockProject` fixture** — same reason as Task 6.0. Add to the `mockProject` object at `src/projects/project.service.spec.ts:L38` (after `deactivated_at: null`):

    ```typescript
    qa_failure_status: null,
    manual_review_status: null,
    code_review_status: null,
    ```

  - [ ] 7.1 Add describe block `'updateQaStatusConfig'` with test cases:
    - `'should update qa_failure_status on the project'` — mock `repository.findById` returns `mockProject`, mock `repository.update` returns updated project, assert `repository.update` called with `(projectId, { qa_failure_status: 'QA Failed' })`
    - `'should throw NotFoundException when project not found'` — mock `repository.findById` returns `null`, assert `updateQaStatusConfig` rejects with `NotFoundException`
    - `'should only include defined fields in update payload'` — call with `{ qa_failure_status: 'QA Failed' }` only, assert `repository.update` called with `{ qa_failure_status: 'QA Failed' }` and NO `manual_review_status` key in the payload
    - `'should pass null to clear a field'` — call with `{ qa_failure_status: null }`, assert `repository.update` called with `{ qa_failure_status: null }`

---

- [ ] Task 8: Run and verify (AC: 6)
  - [ ] 8.1 `pnpm db:validate` → schema integrity confirmed before migration
  - [ ] 8.2 `pnpm db:migrate` → migration `add_project_qa_status_fields` applied cleanly
  - [ ] 8.3 `pnpm db:generate` → Prisma client has `qa_failure_status`, `manual_review_status`, `code_review_status` on `Project` type
  - [ ] 8.4 `pnpm test -- --testPathPattern="project.controller"` → green
  - [ ] 8.5 `pnpm test -- --testPathPattern="project.service"` → green
  - [ ] 8.6 _(Conditional — only if Task 5 was applied)_ `pnpm test -- --testPathPattern="pm-execution-status"` → green
  - [ ] 8.7 `pnpm typecheck` → zero errors (especially verify Task 5 cast removal and new `Prisma` import in service both compile cleanly)
  - [ ] 8.8 `pnpm build` → clean build

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

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
