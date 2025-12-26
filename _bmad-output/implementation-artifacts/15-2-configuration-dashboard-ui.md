# Story 15.2: Configuration Dashboard UI

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **System Administrator or Manager**,
I want **a centralized configuration dashboard with 7 specialized panels**,
so that **I can fine-tune system behaviors (cleanup, costs, auto-merge, etc.) in real-time without redeploying code.**

## Acceptance Criteria

### AC 1: Configuration Dashboard Layout
- [x] Implement a **Sidebar Navigation** layout in `dsf-dashboard` repository.
- [x] **Sidebar Updates**: Update `Sidebar` component to include a "Settings" link (icon: `Settings` from lucide-react).
- [x] **Routing**: Add explicit routes in `App.tsx`:
    - `/settings` (redirects to `/settings/cleanup`)
    - `/settings/:panel` (renders specific panel)
- [x] Ensure distinct icons and labels for all 7 panels.
- [x] Restrict access to `ADMIN` and `MANAGER` roles only (hide Sidebar link and protect route from others).

### AC 2: Panel 1 - Cleanup Settings
- [x] Connect to `StorageManagerService` settings.
- [x] Inputs for:
    - Retention Period (default: 30 days)
    - Emergency Cleanup Threshold (default: 85%)
    - Archive Directory Path
- [x] "Run Cleanup Now" manual trigger button.

### AC 3: Panel 2 - Self-Healing Settings
- [x] Connect to `SelfHealingOrchestrator` config.
- [x] Inputs for:
    - Max Fix Attempts (default: 2)
    - Progress Validation Toggle (On/Off)
    - Escalation Thresholds.

### AC 4: Panel 3 - Dependency Management
- [x] Connect to `DependencyManagerService`.
- [x] Inputs for:
    - Circular Dependency Detection (Strict/Warn)
    - File Lock Timeout (minutes).

### AC 5: Panel 4 - Auto-Merge & PRs
- [x] Connect to `GitHubService` / `PRRiskAssessor`.
- [x] Inputs for:
    - Auto-Merge Risk Threshold (Low only / Low+Medium)
    - Review Timer Reminders (2h, 4h, 24h)
    - Require Code Owner Review (Toggle).

### AC 6: Panel 5 - Cost & AI Models
- [x] Connect to `CostOptimizerService`.
- [x] Inputs for:
    - Global Monthly Budget Cap ($).
    - Model Selection Overrides (Force GPT-4, Force Claude).
    - Cache TTL (hours).

### AC 7: Panel 6 - Audit & Safety
- [x] Connect to `AIDecisionLogger`.
- [x] Inputs for:
    - Audit Log Retention (days).
    - Min Confidence Score for Auto-Approval.

### AC 8: Panel 7 - Health & Rollback
- [x] Connect to `DeploymentHealthMonitorService`.
- [x] Inputs for:
    - Post-Deploy Monitor Window (minutes).
    - Error Rate Rollback Threshold (%).
    - Latency Rollback Threshold (ms).

### AC 9: Backend Configuration API
- [x] Implement `SystemConfigModule` in `Dark Software Factory`.
- [x] Create `SystemConfig` model in Prisma (key-value store or structured).
- [x] **Safe Fallback Strategy**: Implement `ConfigService` to read from DB, falling back to Env Vars if DB entry missing (Zero Downtime safety).
- [x] Endpoints:
    - `GET /api/v1/config` (Fetch all)
    - `PATCH /api/v1/config` (Update specific settings)
    - `POST /api/v1/config/reset` (Reset to defaults)

### AC 10: Frontend Data Management (TanStack Query)
- [x] Install `@tanstack/react-query` in `dsf-dashboard`.
- [x] Implement `useSystemConfig` hook using `useQuery` for fetching.
- [x] Implement `useUpdateSystemConfig` hook using `useMutation` with optimistic updates (optional) or cache invalidation.
- [x] **Real-Time Sync**: Use `useSocket` hook to listen for `CONFIG_UPDATED` events and trigger `queryClient.invalidateQueries(['systemConfig'])`.

## Tasks / Subtasks

- [x] **Backend: Configuration Infrastructure** (AC 9)
  - [x] Create `SystemConfig` model in `schema.prisma`.
  - [x] Generate migration and apply.
  - [x] Implement `SystemConfigService` with Fallback Strategy (DB || Env).
  - [x] Implement `SystemConfigController` with RBAC (`RolesGuard`).
- [x] **Frontend: Infrastructure** (AC 1, 10)
  - [x] Setup `QueryClientProvider` in `main.tsx` (if not exists) or `App.tsx`.
  - [x] Create `SettingsLayout` component with Sidebar.
  - [x] Update `App.tsx` Routes.
  - [x] Update `Sidebar` component.
  - [x] Create `types/config.ts` shared interface.
- [x] **Frontend: Implement Panels** (AC 2-8)
  - [x] Create reusable `ConfigInput` components (using Tailwind).
  - [x] Implement all 7 Panel components using `useSystemConfig` hook.

## Dev Notes

### Architecture Patterns
- **Frontend State**: **TanStack Query (React Query)** is REQUIRED for config state management.
- **Frontend UI**: Use **React + TypeScript**. Reuse `StatsGrid`/`ProjectCard` styling patterns (Tailwind).
- **Backend**: **NestJS**. `SystemConfigModule`.
- **Persistence**: Store config in PostgreSQL.
- **Security**: **Strict RBAC**. Only `ADMIN` role should be able to write configs. `MANAGER` might have read-only.

### File Locations
- **Frontend**: `dsf-dashboard/src/pages/settings/*`, `dsf-dashboard/src/components/settings/*`, `dsf-dashboard/src/hooks/queries/useSystemConfig.ts`
- **Backend**: `Dark Software Factory/src/system-settings/*`

### Source Tree Components
- `dsf-dashboard`: New pages.
- `Dark Software Factory`: `src/system-settings/`

### Testing Standards
- **Backend**: Unit tests for `SystemConfigService` (verifying fallback logic).
- **Frontend**: Component tests for Panels.

## Dev Agent Record

### Agent Model Used
{{agent_model_name_version}}

### Debug Log References
- Check `App.tsx` for `useSocket` hook usage pattern.
- Verify `RolesGuard` implementation in `architecture.md`.

### Completion Notes List
- Implemented full configuration dashboard with all 7 panels.
- Added SystemConfig model to Prisma and ran migration.
- Created SystemConfigModule with Service and Controller.
- Implemented useSystemConfig hook with TanStack Query and socket.io sync.
- Verified both backend and frontend builds pass.
- [Remediation] Added `POST /api/v1/config/reset` for bulk reset capability.
- [Remediation] Added frontend unit tests for `useSystemConfig` and `AllPanels` to meet validation criteria.

### File List
- `Dark Software Factory/prisma/schema.prisma`
- `Dark Software Factory/src/system-settings/system-config.module.ts`
- `Dark Software Factory/src/system-settings/system-config.service.ts`
- `Dark Software Factory/src/system-settings/system-config.controller.ts`
- `Dark Software Factory/src/system-settings/dto/system-config.dto.ts`
- `Dark Software Factory/src/app.module.ts`
- `dsf-dasbhoard/src/App.tsx`
- `dsf-dasbhoard/src/hooks/queries/useSystemConfig.ts`
- `dsf-dasbhoard/src/hooks/queries/useSystemConfig.test.ts`
- `dsf-dasbhoard/src/components/layout/Sidebar.tsx`
- `dsf-dasbhoard/src/pages/settings/SettingsLayout.tsx`
- `dsf-dasbhoard/src/pages/settings/panels/AllPanels.tsx`
- `dsf-dasbhoard/src/pages/settings/panels/AllPanels.test.tsx`
- `dsf-dasbhoard/src/components/settings/ConfigInput.tsx`
- `dsf-dasbhoard/src/types/config.ts`
