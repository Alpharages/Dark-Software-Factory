# Story 27.1: Proper 404 Page & Route Catch-All Fix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any user,
I want unknown URLs to display a clear 404 error page,
so that navigating to a broken or mistyped link makes the problem immediately obvious rather than silently rendering the wrong page.

## Acceptance Criteria

1. **Given** an authenticated user navigates to a URL that matches no defined route (e.g., `/unknown`, `/some-typo`)
   **When** React Router evaluates the URL
   **Then** the `path="*"` catch-all route renders a dedicated `<NotFoundPage>` component — NOT `<Dashboard />`
2. **And** the 404 page displays: a "404 — Page Not Found" heading, the requested URL, and a "Go to Dashboard" CTA button that navigates to `/`
3. **And** the browser tab title reads `"404 Not Found — DSF"`
4. **Given** the `/cost` route was previously caught by the catch-all (from Story 25.4)
   **When** a user navigates to any remaining unregistered path
   **Then** they always see the 404 page, never the PM Dashboard

## Tasks / Subtasks

- [x] Create `NotFoundPage` component (`src/pages/NotFoundPage.tsx`) (AC: 1, 2, 3)
  - [x] Implement UI with "404 — Page Not Found" heading and CTA using shadcn `<Button>` and `lucide-react` icons.
  - [x] Use React Router `<Link to="/">` for the CTA navigation.
  - [x] Apply Tailwind classes (e.g., `flex flex-col items-center justify-center min-h-[60vh]`) to center the content within the dashboard layout.
  - [x] Implement `useEffect(() => { document.title = "404 Not Found — DSF"; }, [])` on mount.
- [x] Update App Router (`src/App.tsx`) (AC: 1, 4)
  - [x] Replace `<Route path="*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />` with `<Route path="*" element={<ProtectedRoute><NotFoundPage /></ProtectedRoute>} />` inside the `<Route element={<DashboardLayout />}>` nested routing structure.

## Dev Notes

- **Architecture Compliance:**
  - **Routing:** `<NotFoundPage>` must be rendered within the existing `<DashboardLayout>` context so it retains the sidebar and header. Ensure you replace the exact `<Route path="*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />` line inside `App.tsx` (around line 383) rather than appending at the end of the file.
  - **Document Title:** Use `useEffect(() => { document.title = "404 Not Found — DSF"; }, []);` on component mount to handle the title change natively. Do NOT use `react-helmet` or external dependencies for this.
  - **UI Implementation:** Use the pre-existing shadcn/ui `<Button>` component for the call-to-action to match design consistency, alongside `lucide-react` for any icons. The layout should be centered using Tailwind (`flex flex-col items-center justify-center min-h-[60vh]`).
- **Dependencies:** `react-router-dom` (for `<Link>`), `lucide-react`
- **Testing Requirements:** Add unit tests to ensure `<NotFoundPage>` renders correctly when visiting an unknown URL and the CTA link works.

### Project Structure Notes

- Place the new component in `src/pages/NotFoundPage.tsx` or similar standard pages directory.
- Update routing logic inside `src/App.tsx`.

### References

- [Source: epics.md#Story-27.1](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: QA-REPORT-2026-02-27.md (QA-FR24 / S-1)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/QA-REPORT-2026-02-27.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Frontend tests: `cd ../dsf-dasbhoard && pnpm test src/__tests__/pages/NotFoundPage.test.tsx src/__tests__/pages/AppNotFoundRoute.test.tsx`
- Frontend lint (targeted): `cd ../dsf-dasbhoard && pnpm exec eslint src/App.tsx src/pages/NotFoundPage.tsx src/__tests__/pages/NotFoundPage.test.tsx src/__tests__/pages/AppNotFoundRoute.test.tsx` (reports pre-existing `@typescript-eslint/no-explicit-any` in `src/App.tsx`)

### Completion Notes List

- Added a new `NotFoundPage` with required 404 heading, requested URL display, and a `Go to Dashboard` CTA using shadcn `Button`, `Link`, and lucide icons.
- Implemented `document.title = "404 Not Found — DSF"` on `NotFoundPage` mount.
- Replaced the protected `path="*"` catch-all route in `App.tsx` to render `<NotFoundPage />` instead of `<Dashboard />`.
- Added unit tests validating `NotFoundPage` UI/title behavior and catch-all route wiring to prevent fallback-to-dashboard regressions.

### Senior Developer Review (AI)

**Reviewer:** Claude Sonnet 4.6 — 2026-03-02

**Outcome:** ✅ Approved (1 HIGH fixed, 2 MEDIUM noted)

**Issues Fixed:**

- [x] [HIGH] `AppNotFoundRoute.test.tsx` rewrote from `readFileSync` source-text approach to proper `MemoryRouter`+`Routes` rendering — 3 behaviour-driven tests now exercise real React Router routing (5/5 pass)

**Design Notes (not blocking):**

- [MEDIUM] All frontend implementation files are untracked in the frontend git repo — a `git add` + commit is required before merging; no code defect
- [MEDIUM] `ForbiddenPage` (403) uses full-screen standalone layout while `NotFoundPage` (404) renders inside `DashboardLayout` — inconsistent error-page chrome; spec was followed correctly for this story but the discrepancy should be resolved in a future design pass

**Low issues (deferred, not blocking):**

- `useMemo` on trivial string concatenation in `NotFoundPage.tsx:9` — unnecessary overhead
- `|| '/'` fallback at `NotFoundPage.tsx:11` is dead code (`pathname` is always ≥ `'/'`)
- `document.title` not cleaned up on unmount — deferred to Story 27-2 (per-page titles)

### File List

- \_bmad-output/implementation-artifacts/27-1-proper-404-page.md
- \_bmad-output/implementation-artifacts/sprint-status.yaml
- ../dsf-dasbhoard/src/App.tsx
- ../dsf-dasbhoard/src/pages/NotFoundPage.tsx
- ../dsf-dasbhoard/src/**tests**/pages/NotFoundPage.test.tsx
- ../dsf-dasbhoard/src/**tests**/pages/AppNotFoundRoute.test.tsx

## Change Log

- 2026-03-02: Implemented Story 27.1 proper 404 page, updated catch-all routing, added regression tests, and moved status to `review`.
- 2026-03-02: Code review by Claude Sonnet 4.6 — rewrote `AppNotFoundRoute.test.tsx` with proper rendering tests; all ACs verified; status moved to `done`.
