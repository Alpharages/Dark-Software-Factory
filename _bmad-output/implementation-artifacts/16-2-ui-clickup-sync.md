# Story 16-2: UI implementation for ClickUp Sync Dashboard

**Epic**: 16
**Status**: done
**Priority**: High
**Effort**: 3 days
**Type**: Feature
**Repository**: `dsf-dashboard`

## Context

Users need a visual interface to manage which ClickUp lists are being synced to the system. This involves a Dashboard view of projects and a "Sync/Import" flow to add new ones.

## Acceptance Criteria

1.  **Projects List**: Table shows "Provider" column (Icon). ✅
2.  **Sync Modal**: "Add Project" button opens modal. ✅
3.  **Provider Selection**: First step of modal allows selecting "ClickUp" (Jira/Asana disabled/coming soon). ✅
4.  **Hierarchy Browser**: After provider selection, show relevant hierarchy (ClickUp Spaces/Lists). ✅
5.  **Generic Import**: Import action sends provider + ID to backend. ✅

## Technical Notes

- **Components**:
  - `ProjectsTable`: Add Monitoring column with `Switch` component.
  - `ClickUpImportModal`: New component for browsing hierarchy.
- **State**: Use React Query for fetching projects and hierarchy.
- **Route**: Added to existing Projects page or a new `/configuration/sync` page.

## Tasks

- [x] Update `ProjectsTable` with Monitoring Toggle <!-- id: 0 -->
- [x] Create `ClickUpImportModal` component <!-- id: 1 -->
- [x] Implement `useClickUpHierarchy` hook (React Query) <!-- id: 2 -->
- [x] Implement `useImportProject` mutation <!-- id: 3 -->
- [x] Integrate Modal into Projects Dashboard <!-- id: 4 -->
- [x] Add E2E/Component tests for Sync flow <!-- id: 5 -->
- [x] Code Review Remediation <!-- id: 6 -->

## Dev Agent Record

### Implementation Notes

Implemented full UI for ClickUp Sync Dashboard with:

1. **ProjectsTable Component**: Displays projects in a table with:
   - Provider icon column (Cloud icon for ClickUp, Database icons for others)
   - Monitoring toggle switch (calls `PATCH /api/v1/projects/:id`)
   - Expandable rows showing project details
   - Empty state message

2. **ClickUpImportModal Component**: Two-step modal flow:
   - Step 1: Provider selection (ClickUp enabled, Jira/Asana "Coming soon")
   - Step 2: Hierarchy browser (Spaces → Lists)
   - Loading states, error handling, toast notifications
   - Calls `POST /api/v1/projects/import` with provider and resourceId

3. **React Query Hooks**:
   - `useClickUpHierarchy`: Fetches hierarchy from `GET /api/v1/integrations/clickup/hierarchy`
   - `useImportProject`: Mutation for importing projects with auto-refetch

4. **ProjectsSyncPage**: Main page component with:
   - Projects table display
   - Add Project button triggering modal
   - Refresh functionality
   - Info panel explaining features

5. **Shadcn UI Components Created**:
   - `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`
   - `Switch` (using @radix-ui/react-switch)
   - `Badge`
   - `Dialog` components (using @radix-ui/react-dialog)

6. **Router Integration**:
   - Added route `/projects/sync` to `App.tsx`
   - Updated sidebar navigation to point to new route

7. **Dependencies Installed**:
   - `@radix-ui/react-switch@1.2.6`
   - `@radix-ui/react-dialog@1.1.15`

8. **Tests Created**:
   - `ProjectsTable.test.tsx`: 9 test cases (5 original + 4 comprehensive)
   - `ClickUpImportModal.test.tsx`: 6 test cases

### Code Review Remediation (2026-01-02)

**Issues Fixed**: 6 HIGH, 4 MEDIUM

**H2: Fragment Key Warning** ✅ FIXED

- Changed empty fragment `<>` to `<React.Fragment key={project.id}>`
- Added React import for Fragment support

**H3/H4: Error Handling & Toast Messages** ✅ FIXED

- Added `ApiErrorResponse` interface for type safety
- Extract actual error messages from API responses: `message` or `error` fields
- Fallback to generic messages if no custom error
- Files: `ProjectsTable.tsx`, `ClickUpImportModal.tsx`

**H6: Test Coverage** ✅ ENHANCED

- Added 4 new comprehensive test cases to `ProjectsTable.test.tsx`:
  - `calls API and updates when monitoring is toggled` - Tests actual API integration
  - `handles API error with custom message` - Tests error extraction from API response
  - `handles API error without custom message` - Tests fallback error handling
  - `disables switch during API call` - Tests loading state during async operation
- Total tests: 5 → 9 test cases

**M1: Provider Default Logic** ✅ FIXED

- Changed `getProviderLabel()` default from `'CLICKUP'` to `'Unknown'`
- More accurate representation for projects without provider set

### Build Status

✅ TypeScript compilation passing for Story 16-2 files
✅ All routing and navigation working
✅ Components properly typed
✅ Code review issues remediated
⚠️ Note: Pre-existing TypeScript errors in other files (unused imports in architecture-review components) not related to this story

### File List

**New Files**:

- `src/components/projects/ProjectsTable.tsx`
- `src/components/projects/ClickUpImportModal.tsx`
- `src/hooks/useClickUpHierarchy.ts`
- `src/hooks/useImportProject.ts`
- `src/pages/ProjectsSyncPage.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/dialog.tsx`
- `src/__tests__/components/ProjectsTable.test.tsx`
- `src/__tests__/components/ClickUpImportModal.test.tsx`

**Modified Files**:

- `src/App.tsx` (added route and imports)
- `src/components/layout/Sidebar.tsx` (updated Projects nav link)
- `package.json` (added Radix UI dependencies)

### Change Log

- **2026-01-02**: Created all UI components for ClickUp Sync Dashboard (Antigravity)
- **2026-01-02**: Installed Radix UI dependencies for Switch and Dialog components
- **2026-01-02**: Added routing and navigation integration
- **2026-01-02**: Created unit tests for main components
- **2026-01-02**: CODE REVIEW REMEDIATION - Fixed React Fragment keys, improved error handling with typed API responses, changed provider default to 'Unknown', enhanced test coverage from 5 to 9 comprehensive test cases (Antigravity)
