# Story 26.3: Project Sort & View Mode Toggle

Status: ready-for-dev

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

- [ ] Implement `Sort` Dropdown (AC: 1, 3, 4)
  - [ ] Add `DropdownMenu` (shadcn/ui) with sorting options (Last Activity desc, Name A-Z, Ticket Count desc, Blocked Count desc).
  - [ ] Add client-side state for sort preference with `localStorage` persistence.
  - [ ] Implement array sorting safely (handle `.length === 0`).
- [ ] Implement View Mode Toggle (AC: 2, 3, 4)
  - [ ] Add `ToggleGroup` (shadcn/ui) for Grid/List switch and persist choice to `localStorage`.
  - [ ] Restrict List view on mobile (`<768px`) using CSS media queries or React window width checks.
  - [ ] Create `ProjectCardListView` using native HTML table elements for a11y.
  - [ ] Add smooth opacity/transform CSS transitions when switching view modes.

## Dev Notes

- **Architecture Patterns**: Use React hooks (`useState`, `useEffect` for `localStorage`, `useMemo` for sorting).
- **Design System**: Use `shadcn/ui` (`DropdownMenu`, `ToggleGroup`).
- **Layout Constraint**: Ensure the table view acts as a no-op or falls back to grid on `<768px` screens per UX specs (NFR-UX1).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-26.3-Project-Sort-&-View-Mode-Toggle]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
