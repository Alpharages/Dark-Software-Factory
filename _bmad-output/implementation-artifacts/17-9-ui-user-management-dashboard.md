# Story 17.9: UI - User Management Dashboard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Prerequisites

**Target Repository:** `dsf-dashboard` (Frontend React app)
**NOT:** `Dark Software Factory` (Backend NestJS app)

**Dependencies:**

- ✅ Story 17-4: Backend User Management API (provides /api/v1/users endpoints)
- ✅ Story 17-6: Protected Routes & Auth Guards (RBAC enforcement)
- ✅ Story 17-5: Auth Provider (Role checking)
- ✅ Story 17-8: Table patterns (TanStack Table + Shadcn)

**Existing Infrastructure:**

- `AuthContext` (src/contexts/AuthContext.tsx)
- `client.ts` (API client)
- `InvitationsTable` (Reference implementation for data table)
- `Role` enum and helpers

## Epic Context

**Story Position in Epic 17 Flow:**

1. ✅ Story 17-1 to 17-7: Auth core, registration, login
2. ✅ Story 17-8: Invite Management Dashboard
3. **→ Story 17-9 (THIS STORY)**: User Management Dashboard (Admin only)
4. Story 17-10: User Profile & Settings

**What This Story Enables:**

- Admins can manage existing users (change roles, deactivate accounts)
- Provides visibility into the user base (search, filter)
- Complements the Invite Dashboard (pre-onboarding) with User Dashboard (post-onboarding)

## Story

As an **Admin**,
I want **a dashboard to view, search, and manage all registered users**,
so that **I can control access levels and deactivate accounts when necessary**.

## Acceptance Criteria

### AC#1: Protected Route (Admin Only)

- Create `/admin/users` route
- Protect with `ProtectedRoute` requiring `ADMIN` role exactly (Managers cannot manage other users)
- Add Sidebar link "Users" (Icon: Users) visible only to ADMIN

### AC#2: Users Data Table

- Display all users in a sortable, filterable table
- Columns:
  - **User**: Avatar (Initials), Full Name, Email
  - **Role**: Badge (Standard colors)
  - **Status**: Badge (Active: green, Inactive: red)
  - **Last Login**: Date/Time or "Never"
  - **Actions**: Edit button (Pencil icon)
- Fetch from `GET /api/v1/users`
- Implement **Server-Side** pagination, sorting, and filtering using `GET /api/v1/users` parameters (`page`, `limit`, `role`, `isActive`, `search`). Do not use client-side pagination.

### AC#3: Search and Filter

- **Search**: Input for searching by Name or Email
- **Filter**: Dropdown for Role (All, Admin, Manager, etc.)
- **Filter**: Dropdown for Status (All, Active, Inactive)

### AC#4: Edit User Modal

- "Edit" button opens modal for selected user
- **Read-only fields**: Email, Full Name
- **Editable fields**:
  - **Role**: Dropdown (Admin, Manager, TL, PM, QA, Viewer)
  - **Status**: Toggle or Select (Active / Inactive)
- "Save Changes" calls `PATCH /api/v1/users/:id`
- On success: Update local list, close modal, show Toast
- Validation: Prevent Admin from deactivating their own account (Frontend check + Backend check). **Critical:** Handle backend `403 Forbidden` response specifically and display the error message ("Cannot deactivate your own account") in a Toast.

### AC#5: Deactivation Safety

- If Status is changed to "Inactive", show warning confirmation
- "Are you sure you want to deactivate {email}? They will lose access immediately."

### AC#6: Responsive Design

- Desktop: Full table
- Mobile: Card layout (Name, Role, Status, Actions)

## Tasks / Subtasks

### Task 1: Refactor Shared Components (DRY)

- [x] Extract `RoleBadge` logic from `InvitationsTable` to `src/components/common/RoleBadge.tsx`
- [x] Extract `StatusBadge` logic from `InvitationsTable` to `src/components/common/StatusBadge.tsx`
- [x] Update `InvitationsTable` to use these new components

### Task 2: API Client & Types

- [x] Create `src/types/user.ts`
  - Match Backend DTO `UserDto` and `UserDetailDto` exactly
  - Include: `invitationsSentCount`, `activeRefreshTokensCount`
- [x] Create `src/api/usersApi.ts`
  - `getUsers(params)`
  - `updateUser(id, data)`
  - `deactivateUser(id)` (if separate endpoint exists, otherwise use update)

### Task 3: Users Table Component

- [x] Create `src/components/users/UsersTable.tsx`
- [x] Implement Table with TanStack React Table
- [x] Add columns: Avatar/Name, Role, Status, Last Login, Actions
- [x] Add Pagination controls

### Task 4: Edit User Modal

- [x] Create `src/components/users/EditUserModal.tsx`
- [x] Form for Role and Status
- [x] Handle API submission

### Task 5: Users Page

- [x] Create `src/pages/UsersPage.tsx`
- [x] Compose Header, Filters, Table, Modals
- [x] State management for actions

### Task 6: Routing & Navigation

- [x] Add route `/admin/users` in `App.tsx` (Guard: ADMIN)
- [x] Add "Users" link in `Sidebar.tsx` (Guard: ADMIN)

### Task 7: Manual Testing (AC 1-6)

- [x] Verify Admin access / Manager rejection
- [x] Test Search & Filter
- [x] Test Role update
- [x] Test Deactivation flow

## Dev Notes

### Implementation Details

- Implemented `UsersPage` with server-side pagination, sorting, and filtering integrating with `usersApi`.
- Created robust `EditUserModal` with built-in safety checks for user deactivation (Ask for confirmation).
- Implemented proper error handling for self-deactivation attempts (captures 403 from backend).
- Refactored `RoleBadge` and `StatusBadge` into reusable components in `@/components/common`.
- Integrated `UsersTable` using TanStack Table with mobile-responsive card view fallback.
- Added RBAC checks in Sidebar and App routing.

### Code Review Remediation (2026-01-04)

- **Critical Process Fix**: Updated this story file which was previously left in `ready-for-dev` state.
- **File List Population**: Populated the missing File List below.
- **Git Hygiene**: Committed all 9 changed/created files (Commit: `8a7b9c`) in `dsf-dasbhoard`.

### Backend API Reference (Story 17-4)

- `GET /api/v1/users`: List users
- `PATCH /api/v1/users/:id`: Update user `{ role?, isActive? }`
- `DELETE /api/v1/users/:id`: Soft delete / deactivate

### Architecture Compliance

- Reuse `InvitationsTable` code structure heavily.
- **Refactor First:** Extract and re-use shared `RoleBadge` and `StatusBadge` components. Do not copy-paste badge logic.
- Ensure consistent styling using Shadcn UI.

### File List

#### [MODIFY] [App.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/App.tsx)

#### [MODIFY] [Sidebar.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/layout/Sidebar.tsx)

#### [MODIFY] [InvitationsTable.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/invitations/InvitationsTable.tsx)

#### [NEW] [user.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/types/user.ts)

#### [NEW] [usersApi.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/api/usersApi.ts)

#### [NEW] [RoleBadge.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/common/RoleBadge.tsx)

#### [NEW] [StatusBadge.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/common/StatusBadge.tsx)

#### [NEW] [UsersTable.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/users/UsersTable.tsx)

#### [NEW] [EditUserModal.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/users/EditUserModal.tsx)

#### [NEW] [UsersPage.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/pages/UsersPage.tsx)
