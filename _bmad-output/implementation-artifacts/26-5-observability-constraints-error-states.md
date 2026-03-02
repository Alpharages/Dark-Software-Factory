# Story 26.5: Observability Constraints & Error States

Status: ready-for-dev

## Story

As an Operator or Technical Lead,
I want the Observability and Architecture Constraints pages to show clear, non-contradictory states,
so that I understand at a glance whether data is unavailable due to missing configuration or a fetch failure.

## Acceptance Criteria

1. **Given** Docker is not running in the development environment
   **When** a user navigates to `/observability`
   **Then** the page renders a single graceful degradation banner: `"Metrics unavailable — Docker is not running. Start Docker Desktop to enable observability features."`
   **And** no dual-error state ("Data Loading Error" AND "Connection Lost") appears simultaneously

2. **Given** the architecture constraints API fetch succeeds but returns an empty array
   **When** `/architecture-review/constraints` renders
   **Then** only the empty state shows: `"No constraints defined. Add your first constraint."`
   **And** the "Failed to load constraints" error does NOT render at the same time

3. **Given** the architecture constraints API fetch fails with an error
   **When** `/architecture-review/constraints` renders
   **Then** only the error state shows: `"Failed to load constraints. Please try again."`
   **And** the empty state does NOT render at the same time

## Tasks / Subtasks

- [ ] Fix dual-error state on Observability page
  - [ ] Intercept Docker down API responses or use the health endpoint to determine Docker status.
  - [ ] Render a specific graceful degradation banner if Docker is down.
  - [ ] Prevent other generic connection/loading error components from rendering simultaneously.
- [ ] Fix mutual exclusion of empty and error states on Architecture Constraints page
  - [ ] Check API response state (loading, error, success with empty data).
  - [ ] Ensure conditional rendering logic strictly shows only one of: empty state OR error state.
  - [ ] Remove overlapping error banners and empty messages.

## Dev Notes

- **Frontend Repository Context:** The changes will primarily be in the `dsf-dashboard` React application.
- **Components to Touch:**
  - `src/pages/Observability.tsx` (or related route component)
  - `src/pages/ArchitectureConstraints.tsx` (or related route component)
- **Recharts Fix Context:** Apply Recharts dimension fixes (`min-w-0` classes or specific `height`) if any charts on the Observability page are missing them, as per previous QA-FR11 fixes. Recharts `<ResponsiveContainer>` zero-dimension issues should be prevented.
- **Testing Standards:**
  - Add or update tests to simulate API empty array response to ensure only the empty state renders.
  - Add or update tests to simulate API error response to ensure only the error state renders.

### Project Structure Notes

- Alignment with unified project structure: Follow the existing React/Vite/Tailwind structure in `dsf-dashboard`.
- Use React Query's `isError`, `isLoading`, and `data` states properly to handle conditional rendering.

### References

- Code Quality Standards from `architecture.md`
- Frontend Repository: `dsf-dashboard`
- Source: `docs/QA-REPORT-2026-02-27.md` (FR22, FR23; FE-10, FE-11)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
