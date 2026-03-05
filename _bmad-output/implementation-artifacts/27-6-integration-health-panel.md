# Story 27.6: Integration Health Panel in Settings

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Administrator,
I want to see the health status of all third-party integrations in the Settings panel,
so that I immediately know which integrations are missing configuration without reading backend logs.

## Acceptance Criteria

1. **Given** an ADMIN navigates to the new `/settings/integrations` panel
   **When** the Integration Health section renders
   **Then** status cards for Docker, SendGrid (email), OpenAI (transcription), and Slack (notifications) are displayed.
   **And** each card shows configuration status (✅ Configured or ⚠️ Not Configured) and a description of affected features.
2. **Given** the backend API is running
   **When** `GET /api/v1/health/integrations` is called by an authorized user (ADMIN or MANAGER)
   **Then** it returns Docker connectivity status (can connect to `/var/run/docker.sock`).
   **And** it returns boolean flags indicating the presence of `SENDGRID_API_KEY`, `OPENAI_API_KEY`, and `SLACK_BOT_TOKEN`.
   **And** no actual secret values are exposed in the JSON response.
3. **Given** an integration is "Not Configured"
   **When** the user views its status card
   **Then** it must clearly state which platform features are disabled (e.g., "User invitations disabled" for SendGrid).

## Tasks / Subtasks

- [x] **Backend: Integration Health Endpoint** (AC: 2)
  - [x] Create `src/common/dto/integration-health.dto.ts` with `IntegrationHealthResponseDto`.
  - [x] Add `GET /health/integrations` to `AppController` with `RolesGuard` (ADMIN/MANAGER).
  - [x] Implement health check logic in `AppService` to check Docker via `DockerService` and env vars via `ConfigService`.
- [x] **Frontend: Integration Health UI** (AC: 1, 3)
  - [x] Create `useIntegrationHealth` hook in `src/hooks/queries/useIntegrationHealth.ts`.
  - [x] Implement `IntegrationHealthPanel` in `src/pages/settings/panels/AllPanels.tsx` (or as a separate component if preferred).
  - [x] Add the new panel to the settings navigation in `SettingsLayout.tsx`.
  - [x] Design high-quality status cards using `lucide-react` icons and `shadcn/ui` components.

## Dev Notes

- **Backend Health Check:**
  - Docker check: Use `this.dockerService.isHealthy()`.
  - Env var checks: Use `!!this.configService.get('VARIABLE_NAME')`.
- **Frontend UI:**
  - Status Icons: `CheckCircle2` (Green) for configured, `AlertTriangle` (Amber) for not configured.
  - Descriptions:
    - Docker: "AI agents (Cursor, Claude) require Docker for isolated code execution."
    - SendGrid: "Required for user invitations, password resets, and email alerts."
    - OpenAI: "Required for AI-driven conversation transcription and analysis."
    - Slack: "Required for real-time system alerts and team notifications."
  - Routing: Do NOT use `/settings/health`, as that route is occupied by `HealthPanel` (Deployment Health). Add a new `integrations` option to `panels` array in `SettingsLayout.tsx` and map it to `IntegrationHealthPanel`.
- **Testing:**
  - Backend: `GET /api/v1/health/integrations` should return 401/403 for PM/TL roles and 200 for ADMIN.
  - Frontend: Verify cards reflect the boolean flags returned by the API.

### Project Structure Notes

- **Backend:** `src/app.controller.ts`, `src/common/dto/`
- **Frontend:** `src/pages/settings/panels/AllPanels.tsx`, `src/pages/settings/SettingsLayout.tsx`

### References

- [Source: epics.md#Story-27.6](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: architecture.md#Health-Monitoring](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md)

## Dev Agent Record

### File List

**Backend (`Dark Software Factory`):**

- `src/app.controller.ts` — Added `GET /health/integrations` endpoint with `@UseGuards(RolesGuard)` and `@Roles(ADMIN, MANAGER)`
- `src/app.service.ts` — Added `getIntegrationHealth(): Promise<IntegrationHealthResponseDto>` using `DockerService` and `ConfigService`
- `src/common/dto/integration-health.dto.ts` — New: `IntegrationHealthResponseDto` with Swagger decorators
- `src/common/dto/index.ts` — Added re-export for `integration-health.dto.ts`
- `src/app.controller.spec.ts` — Added `getIntegrationHealth` controller test
- `src/app.service.spec.ts` — New: Unit tests for `AppService.getIntegrationHealth()` (Docker throw, env var presence, no secret leakage)

**Frontend (`dsf-dasbhoard`):**

- `src/hooks/queries/useIntegrationHealth.ts` — New: TanStack Query hook (`queryKey: ['integration-health']`, `refetchInterval: 30000`)
- `src/pages/settings/panels/AllPanels.tsx` — Added `IntegrationHealthPanel` component with loading, error, and status card states
- `src/pages/settings/SettingsLayout.tsx` — Added `{ id: 'integrations', label: 'Third-Party Integrations', icon: Blocks }` to panels array
- `src/App.tsx` — Imported `IntegrationHealthPanel`; registered `/settings/integrations` route with `ProtectedRoute requiredRoles={['ADMIN', 'MANAGER']}`

## Change Log

- 2026-03-02: Created Story 27.6 for Integration Health Panel. Context extracted from Epic 27 and Architecture requirements. (Khakanali)
- 2026-03-03: Code review applied fixes — added frontend RBAC guard on /settings/integrations, explicit return type on AppService method, error state in IntegrationHealthPanel, AppService unit tests, and Dev Agent Record. (Code Review)
