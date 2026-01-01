# Story 16-2: UI implementation for ClickUp Sync Dashboard

**Epic**: 16
**Status**: ready-for-dev
**Priority**: High
**Effort**: 3 days
**Type**: Feature
**Repository**: `dsf-dashboard`

## Context
Users need a visual interface to manage which ClickUp lists are being synced to the system. This involves a Dashboard view of projects and a "Sync/Import" flow to add new ones.

## Acceptance Criteria
1.  **Projects List**: Table shows "Provider" column (Icon).
2.  **Sync Modal**: "Add Project" button opens modal.
3.  **Provider Selection**: First step of modal allows selecting "ClickUp" (Jira/Asana disabled/coming soon).
4.  **Hierarchy Browser**: After provider selection, show relevant hierarchy (ClickUp Spaces/Lists).
5.  **Generic Import**: Import action sends provider + ID to backend.

## Technical Notes
- **Components**:
    - `ProjectsTable`: Add Monitoring column with `Switch` component.
    - `ClickUpImportModal`: New component for browsing hierarchy.
- **State**: Use React Query for fetching projects and hierarchy.
- **Route**: Added to existing Projects page or a new `/configuration/sync` page.

## Tasks
- [ ] Update `ProjectsTable` with Monitoring Toggle <!-- id: 0 -->
- [ ] Create `ClickUpImportModal` component <!-- id: 1 -->
- [ ] Implement `useClickUpHierarchy` hook (React Query) <!-- id: 2 -->
- [ ] Implement `useImportProject` mutation <!-- id: 3 -->
- [ ] Integrate Modal into Projects Dashboard <!-- id: 4 -->
- [ ] Add E2E/Component tests for Sync flow <!-- id: 5 -->
