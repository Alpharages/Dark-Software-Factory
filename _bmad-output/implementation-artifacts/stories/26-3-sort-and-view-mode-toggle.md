# Story 26.3: Project Sort & View Mode Toggle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM,
I want to sort my projects and switch between a card grid and a compact list layout,
so that I can organize and view my portfolio in the way that best matches my current workflow.

## Acceptance Criteria

1. **Sort Dropdown Options**:
   **Given** a PM clicks the "Sort" button
   **When** the sort dropdown opens
   **Then** it shows these options: Last Activity (descending, default), Name A–Z, Ticket Count (desc), Blocked Count (desc).
   **And** selecting an option re-orders the project cards immediately without a page reload.
   **And** sorting must safely handle empty project arrays without errors.

2. **List View Toggle**:
   **Given** a PM toggles between Grid and List view
   **Then** project cards transition smoothly between card grid and compact table row layouts.
   **And** the List view table layout uses semantic native `<table>`, `<thead>`, `<tbody>`, `<tr>` for accessibility.
   **And** the table rows display: Project Name, Status badge, Client, Ticket count, Blocked count, Last activity timestamp.

3. **Mobile Constraints**:
   **Given** the user is viewing the dashboard on a mobile screen (`<768px`)
   **Then** the "List View" layout is disabled, and the dashboard enforces the "Card/Grid View" layout to prevent horizontal scrolling issues.

4. **Preference Persistence**:
   **Then** the selected `viewMode` and `sortPreference` are saved to `localStorage` and persist across page reloads.

## Tasks / Subtasks

- [x] Implement `Sort` Dropdown (AC: 1, 3, 4)
  - [x] Add `DropdownMenu` (shadcn/ui) with sorting options (Last Activity desc, Name A-Z, Ticket Count desc, Blocked Count desc).
  - [x] Add client-side state for sort preference with `localStorage` persistence.
  - [x] Implement array sorting safely (handle `.length === 0`).
- [x] Implement View Mode Toggle (AC: 2, 3, 4)
  - [x] Add `ToggleGroup` (shadcn/ui) for Grid/List switch and persist choice to `localStorage` (Using custom styled buttons to replicate ToggleGroup).
  - [x] Restrict List view on mobile (`<768px`) using CSS media queries or React window width checks.
  - [x] Create `ProjectCardListView` using native HTML table elements for a11y.
  - [x] Add smooth opacity/transform CSS transitions when switching view modes.

## Dev Notes

- **Architecture Patterns**: Use React hooks (`useState`, `useEffect` for `localStorage`, `useMemo` for sorting).
- **Design System**: Use `shadcn/ui` (`DropdownMenu`, `ToggleGroup`).
- **Layout Constraint**: Ensure the table view acts as a no-op or falls back to grid on `<768px` screens per UX specs (NFR-UX1).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-26.3-Project-Sort-&-View-Mode-Toggle]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md]

## Dev Agent Record

### Agent Model Used

BMad-Dev-Agent-v6

### Debug Log References

- Handled undefined sort cases safely by checking `tickets.total` and `.blocked`.
- Fixed several existing frontend TypeScript errors (e.g. `dropdown-menu.tsx`, `notification-stability.test.ts`) that were preventing successful builds.
- Code review (2026-03-02): Fixed column order AC violation, null guards, isMobile init flash, type alias scope, aria-pressed a11y, view transition classes, extracted sort utility for testability.

### Completion Notes List

- Implemented standard `DropdownMenu` for the sort options. Used localStorage for `dsf_project_sort`.
- Implemented `ProjectCardListView` native table to show compact view on larger screens.
- Fallback to Grid View and disabled the switch button if `<768px`.
- Built and TypeChecked successfully.
- Code review fixes applied: AC 2 column order corrected (Status before Client); `project.tickets` null guards added; `isMobile` lazy-initialised to avoid flash; `SortOption`/`ViewMode` types moved to module scope; `aria-pressed` added to toggle buttons; `animate-in` transition now triggers on view-mode switch; sort logic extracted to `src/utils/projectSort.ts`.
- Tests added: `src/__tests__/utils/projectSort.test.ts` (13 tests), `src/__tests__/components/ProjectCardListView.test.tsx` (18 tests). All pass.

### File List

- `src/pages/Dashboard.tsx`
- `src/components/dashboard/ProjectCardListView.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/__tests__/notifications/notification-stability.test.ts`
- `src/components/financial/page/CostSectionContainer.tsx`
- `src/components/ui/command.tsx`
- `src/features/projects/components/GithubRepoSelector.tsx`
- `src/utils/projectSort.ts`
- `src/__tests__/utils/projectSort.test.ts`
- `src/__tests__/components/ProjectCardListView.test.tsx`
