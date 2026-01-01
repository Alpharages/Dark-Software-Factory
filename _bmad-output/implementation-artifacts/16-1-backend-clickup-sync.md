# Story 16-1: Backend changes for Dynamic ClickUp Syncitoring & Import API

**Epic**: 16
**Status**: done
**Priority**: High
**Effort**: 3 days
**Type**: Feature

## Context
We need to move the source of truth for "Monitored Lists" from the `.env` file to the Database (`Project` model) to allow dynamic management. The `ClickUpPollingOrchestrator` must be updated to poll based on active Projects in the DB.

## Acceptance Criteria
1.  **Schema Update**: `Project` model adds `provider` enum (CLICKUP, JIRA, ASANA) and `monitor_tasks`.
2.  **Discovery API**: `GET /api/v1/integrations/:provider/hierarchy` (Initially supports only 'clickup').
3.  **Import API**: `POST /api/v1/projects/import` accepts `provider` and `resourceId`.
4.  **Strategy Pattern**: Implement a basic `SyncProvider` interface to allow future Jira/Asana implementations without rewriting the controller.
5.  **Orchestrator Update**: Update polling logic to filter by `provider: CLICKUP`.
6.  **Toggle API**: `PATCH /api/v1/projects/:id` allows updating `monitor_tasks` status.

## Technical Notes
- **Prisma**: Modify `schema.prisma`.
- **Services**:
    - `ClickUpService`: Add method to fetch hierarchy (Spaces > Lists).
    - `ProjectsController` / `ProjectsService`: Add import logic.
    - `ClickUpPollingOrchestrator`: Change `onModuleInit` to load from DB and subscribe to Project change events (or just refresh periodically/on-demand).
- **Security**: Endpoint should be protected (Admin/Manager role).

## Tasks
- [x] Create/Update Prisma Schema & Migration <!-- id: 0 -->
- [x] Implement `ClickUpService.getHierarchy()` <!-- id: 1 -->
- [x] Create `ProjectsController.importClickUpList()` endpoint <!-- id: 2 -->
- [x] Refactor `ClickUpPollingOrchestrator` to read from DB <!-- id: 3 -->
- [x] Add unit tests for Polling Orchestrator DB integration <!-- id: 5 -->

## Senior Developer Review (AI)
> [!IMPORTANT]
> **Date:** 2026-01-02
> **Reviewer:** Antigravity
> **Outcome:** Approved with Remediation

### Findings & Remediation
- **Critical:** Untracked files (`integrations.controller.ts`, `import-project.dto.ts`) -> **FIXED** (Added to git)
- **Critical:** `Project` schema required `clickup_list_id` (Blocking multi-provider) -> **FIXED** (Made optional in schema & migration applied)
- **Critical:** Missing Test `ClickUpPollingOrchestrator` -> **FIXED** (Created spec file)
- **High:** unsafe `pm_id` in import -> **FIXED** (Injected `@CurrentUser` in controller)
- **High:** DTO validation -> **FIXED** (Added `IsNumberString`, `IsNotEmpty`)

### Dev Agent Record
**Files Changed:**
- `prisma/schema.prisma` (Schema update)
- `prisma/migrations/*` (Migration)
- `src/integrations/integrations.controller.ts` (New)
- `src/integrations/integrations.module.ts` (New)
- `src/projects/project.controller.ts` (Update import)
- `src/projects/project.service.ts` (Update import logic)
- `src/projects/dto/import-project.dto.ts` (New)
- `src/clickup/clickup-polling-orchestrator.service.spec.ts` (New Test)
- `src/clickup/clickup-polling-orchestrator.service.ts` (Refactor)

