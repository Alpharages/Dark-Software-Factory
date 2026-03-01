# Story 26.2: Project Filter Panel

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM,
I want to filter my project portfolio by status, date range, and client,
so that I can focus on the subset of projects that need my attention right now.

## Acceptance Criteria

1. **Given** a PM is on the PM Dashboard (`/` route)
   **When** they click the "Filter" button
   **Then** a slide-in `<Sheet>` or popover panel opens with:
   - Project Status multi-select (Active, Paused, Archived)
   - Date Range date-picker (From / To)
   - Client name text search
     **And** the Filter button no longer does nothing on click

2. **Given** the PM selects one or more filter values and applies them
   **When** filters are active
   **Then** the project cards grid updates in real-time to show only matching projects (client-side filtering)
   **And** a filter indicator badge on the Filter button shows the count of active filters (e.g., "Filter (2)")
   **And** the active filter state is persisted in the URL query string allowing link sharing

3. **Given** the PM filters down to a state where no projects match
   **When** the project grid renders
   **Then** a clear "No projects found" empty state is displayed with a "Clear Filters" CTA button.

4. **Given** the PM clicks "Clear filters" or removes all filter values
   **When** filters are cleared
   **Then** all project cards are shown again, the URL query string is cleared, and the badge on the Filter button disappears

## Tasks / Subtasks

- [x] Task 1: Create the Filter Panel UI component (AC: 1)
  - [x] Colocate a `ProjectFilterSheet` or `ProjectFilterPopover` component inside `src/features/projects/components` (alongside `NewProjectDialog`).
  - [x] Implement the UI using `shadcn/ui` (`Sheet` or `Popover`, `Select` / `Checkbox` for Status, `Input` for Client Search, `DatePickerWithRange` for Date Range).
  - [x] Debounce the Client Search text input (e.g., 300ms) to prevent unnecessary re-renders.

- [x] Task 2: Implement URL-Persisted Filtering State (AC: 2)
  - [x] Implement filter state management using `useSearchParams` in `src/pages/Dashboard.tsx` (or the equivalent component rendering the project grid) so filters survive page reloads.
  - [x] Sync the `ProjectFilterSheet` state with the `useSearchParams` state.

- [x] Task 3: Implement Client-Side Filtering Logic (AC: 2, 3)
  - [x] Filter the React Query project data using a `useMemo` block that explicitly depends on the query data and the search params.
  - [x] Status filter logic: Exact match against selected statuses.
  - [x] Client name filter logic: Case-insensitive substring match.
  - [x] Date Range filter logic: Project `created_at` falls within the selected `From`/`To` dates.
  - [x] Implement the Empty State UI for when the filtered length is 0.

- [x] Task 4: Filter Button and Badge State (AC: 2, 4)
  - [x] Wire the "Filter" button in `src/pages/Dashboard.tsx` to open the filter component.
  - [x] Add a dynamic badge to the "Filter" button that displays the count of active filter criteria.
  - [x] Implement a "Clear filters" action inside the panel that deletes the search params directly.

## Dev Notes

- **Frontend Repo**: `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React 19, Tailwind CSS v4, shadcn/ui).
- **Backend Repo**: No backend changes expected to be required since filtering is explicitly **client-side**.
- **State Management**: It's absolutely critical to use `useSearchParams` from `react-router-dom` to persist the filters. Follow the pattern established in `src/pages/ArchitectureReviewQueuePage.tsx` if unsure.
- **Real-time updates**: Since you are filtering client-side using a `useMemo` block, the real-time Socket.IO project updates established in Epic 25 will automatically flow through your filter, as long as the `useMemo` depends on the query data.
- **Date Matching**: Integrate with `date-fns` for the `created_at` date range comparisons.

### Project Structure Notes

- Keep `ProjectFilterSheet` alongside `NewProjectDialog` in the dashboard components folder (`src/features/projects/components` or similar).

### References

- [Source: docs/QA-REPORT-2026-02-27.md#PM-Dashboard-Feature-Completion] (FR17 / QA-FR17)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-26.2:-Project-Filter-Panel]

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

N/A

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Quality Validation: Addressed URL state persistence, empty states, ambiguous date filtering targets, and target component paths to ensure flawless implementation.
- Implemented client-side filtering logic with exact match status, case-insensitive client name, and date range support using `DateRangePicker`.
- Added a `ProjectFilterSheet` UI component inside `src/components/dashboard` using `shadcn` elements to handle interactions.
- Wired filtering state centrally inside `Dashboard` component within `App.tsx` and persisted with `useSearchParams`.
- Display a dynamic empty state if no projects match criteria, along with a "Clear Filters" command.
- Verified components structure with new tests in `src/__tests__/components/ProjectFilterSheet.test.tsx`.

### File List

- `_bmad-output/implementation-artifacts/26-2-project-filter-panel.md`
- `src/components/dashboard/ProjectFilterSheet.tsx`
- `src/App.tsx`
- `src/__tests__/components/ProjectFilterSheet.test.tsx`
