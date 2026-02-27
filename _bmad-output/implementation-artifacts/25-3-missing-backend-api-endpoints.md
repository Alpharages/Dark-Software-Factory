# Story 25.3: Missing Backend API Endpoints

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a System User,
I want the backend API to expose all necessary endpoints required by the frontend application,
so that the Resource Manager page does not crash and telemetry shortcuts are correctly saved without validation errors.

## Acceptance Criteria

1. **Given** a user navigates to the Resource Manager page
   **When** the frontend requests active file locks
   **Then** the request route matches the existing `FileLocksController` logic
   **And** it returns the list of currently active file locks
   **And** the request returns a `200 OK` status instead of a `404 Not Found`.

2. **Given** a user triggers a telemetry shortcut from the PM Dashboard
   **When** the frontend sends a `POST /api/v1/telemetry/shortcut` request with the telemetry payload
   **Then** the backend DTO validation accepts the payload (via `ShortcutTelemetryDto`)
   **And** the request returns a `201 Created` status instead of a `400 Bad Request`.

## Tasks / Subtasks

- [x] Task 1: Fix `GET /api/v1/locks/active` route mapping (AC: 1)
  - [x] Update the frontend (`dsf-dasbhoard/src/features/resource-manager/api/resource-manager.api.ts`) call `apiClient.get('/locks/active')` to point to `/file-locks` OR update `FileLocksController` (`src/file-locks/file-locks.controller.ts`) to map its `@Get()` route to `@Get('active')`.
- [x] Task 2: Fix `POST /api/v1/telemetry/shortcut` DTO validation (AC: 2)
  - [x] Locate `ShortcutTelemetryDto` in `src/common/metrics/dto/telemetry.dto.ts`.
  - [x] Add missing `class-validator` decorators (e.g., `@IsString()`, `@IsNotEmpty()`) to the `shortcut` property so NestJS `ValidationPipe` accepts the payload.
- [x] Task 3: Write tests for the implementation
  - [x] Update any affected tests in `file-locks.controller.spec.ts` if route is changed.
  - [x] Update tests in `metrics.controller.spec.ts` or add tests for `ShortcutTelemetryDto` validation.

## Dev Notes

### Technical Requirements & Anti-Patterns

- Be mindful of any arbitrary `retryDelayMs` and configure it to `0` in test environments to keep CI fast.
- Add `@IsString()` and `@IsNotEmpty()` to the `shortcut` field in `ShortcutTelemetryDto` in `src/common/metrics/dto/telemetry.dto.ts`.
- Fix the active locks API mismatch by either updating the frontend URL to `/file-locks` or the backend controller to `@Get('active')`. The backend service logic already exists and works.

### Project Structure Notes

- Alignment with unified project structure: `FileLocksController` resides in `src/file-locks`. Telemetry definitions are centrally located in `src/common/metrics`.
- Ensure frontend updates use the defined Axios API client.

### References

- QA Functional Requirement Key: QA-FR5, QA-FR6 [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 25: QA Stabilization [Source: QA-REPORT-2026-02-27.md]
- Previous work intelligence: 25-2-github-webhook-security.md

## Dev Agent Record

### Agent Model Used

Antigravity BMad Create Story

### Debug Log References

### Completion Notes List

- Updated frontend Resource Manager API client to call `/file-locks` instead of `/locks/active`, unwrapping the `{ locks, total }` response to match expected frontend types.
- Verified `ShortcutTelemetryDto` already has `@IsString()` and `@IsNotEmpty()` decorators. The DTO validation works correctly.
- Created unit tests for `ShortcutTelemetryDto` in `metrics.controller.spec.ts` to verify the validation logic and the metrics controller endpoints.
- Regression test suite passed successfully.

### File List

- `../dsf-dasbhoard/src/features/resource-manager/api/resource-manager.api.ts` [MODIFIED]
- `src/common/metrics/metrics.controller.spec.ts` [NEW]
