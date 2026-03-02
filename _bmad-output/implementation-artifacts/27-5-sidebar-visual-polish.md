# Story 27.5: Sidebar & Visual Polish

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Product Manager,
I want the sidebar and dashboard to have consistent, accessible, and real-time visual feedback,
so that I can navigate the platform efficiently and trust the status information provided.

## Acceptance Criteria

1. **Given** the user is viewing the sidebar
   **When** they check the "Last sync" indicator
   **Then** it must display a dynamic relative timestamp (e.g., "less than a minute ago", "5 minutes ago") that updates automatically as time passes, rather than hardcoded text.
2. **Given** the user is using the desktop sidebar
   **When** they toggle the sidebar between expanded and collapsed states
   **Then** the toggle button must use a consistent icon pair: `PanelLeftClose` for collapse and `PanelLeftOpen` for expand (from Lucide).
3. **Given** the user is viewing the PM Dashboard in Light Mode
   **When** they look at the "Real-time Live" badge
   **Then** the text and background contrast must meet WCAG AA standards (at least 4.5:1 ratio).
4. **Given** the application layout in `App.tsx`
   **When** the app renders on desktop/laptop
   **Then** it must use the `ImprovedSidebar.tsx` component, which includes collapsible group functionality, instead of the legacy `Sidebar.tsx`.

## Tasks / Subtasks

- [ ] Migrate to `ImprovedSidebar` in `src/App.tsx` (AC: 4)
  - [ ] Replace legacy `Sidebar` import and usage with `ImprovedSidebar` from `@/components/improved/Sidebar`.
- [ ] Enhancements in `src/components/improved/Sidebar.tsx` (AC: 1, 2)
  - [ ] **Navigation Sync:** Import navigation config from `@/config/navigation` instead of using the hardcoded `navigationGroups` array within the component.
  - [ ] **Icon Consistency:** Standardize the toggle button to use `PanelLeftClose` and `PanelLeftOpen` icons.
  - [ ] **Dynamic Timestamp:** Replace hardcoded "2 minutes ago" with a dynamic value using `date-fns/formatDistanceToNow`. Use a `useEffect` timer (60s interval) to trigger re-renders and ensure the UI stays fresh.
- [ ] Accessibility Fixes in `src/pages/Dashboard.tsx` (AC: 3)
  - [ ] **Live Badge Contrast:** Update the "Real-time Live" badge styling. Use `text-emerald-700` for Light Mode and `dark:text-emerald-500` for Dark Mode to ensure WCAG AA compliance (4.5:1 ratio).

## Dev Notes

- **Architecture & Design:**
  - **Icons:** Use `lucide-react`. Standards: `PanelLeftClose` (collapse), `PanelLeftOpen` (expand).
  - **Timestamps:** Use `date-fns/formatDistanceToNow`.
  - **Theming:** Ensure WCAG AA (4.5:1) in Light Mode. Recommended: `text-emerald-700` (Light) and `dark:text-emerald-500` (Dark).
- **Implementation Strategy:**
  - **Live Updates:** In `ImprovedSidebar`, use a `useEffect` interval to re-calculate relative timestamps for "Last sync".
  - **Navigation Sync:** Ensure `ImprovedSidebar` and `MobileSidebar.tsx` remain in sync by strictly using the shared `@/config/navigation` configuration.
- **Testing Requirements:**
  - Verify `ImprovedSidebar` correctly renders navigation items from the shared config.
  - Verify the toggle state correctly swaps icons.
  - Verify the relative timestamp updates by mocking the system clock in tests.

### Project Structure Notes

- **Target Component:** `src/components/improved/Sidebar.tsx`
- **Legacy Component:** `src/components/layout/Sidebar.tsx` (Replace usage in `App.tsx`)
- **Dashboard Header:** `src/pages/Dashboard.tsx` (approx. line 312 for the "Live" badge)

### References

- [Source: epics.md#Story-27.5](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: QA-REPORT-2026-02-27.md (QA-FR25, QA-FR29, QA-FR30)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/QA-REPORT-2026-02-27.md)

## Change Log

- 2026-03-02: Created Story 27.5 for Sidebar & Visual Polish. Context extracted from Epic 27 and QA Report. Status set to `ready-for-dev`. (Khakanali)
- 2026-03-02: Applied validation improvements (UI-1 update logic, UI-7 contrast specifics, navigation sync reinforcement). (Khakanali)
