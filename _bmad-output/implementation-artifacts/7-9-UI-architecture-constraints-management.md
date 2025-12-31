# Story 7.9: UI Architecture Constraints Management

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TL or Admin,
I want a user interface to define and manage architecture constraints,
so that I can easily configure rules for allowed technologies and patterns without manually editing the database.

## Acceptance Criteria

1. **Given** I am on the Architecture Constraints page
   **When** I view the list of constraints
   **Then** I see all defined constraints grouped by Scope (Global/Project) and Type (Allowed Tech, Forbidden Tech, Pattern).

2. **Given** I want to create a new constraint
   **When** I click "Add Constraint"
   **Then** I can specify:
    - Scope (Global vs Project)
    - Type (Allowed Tech, Forbidden Tech, Pattern, Coding Standard)
    - Rules (Dynamic form based on type):
        - Tech: List of package names
        - Pattern: Regex and file glob
    - Save action persists to backend.

3. **Given** I am editing a Pattern constraint
   **When** I enter a regex
   **Then** the UI validates that the regex is valid.

## Tasks / Subtasks

- [ ] Task 1: API Integration (AC: 1, 2)
  - [ ] Create `useArchitectureConstraints` hook (fetch, create, update, delete).
  - [ ] Add API client methods in `src/api/architectureReviewApi.ts`.

- [ ] Task 2: Constraints List UI (AC: 1)
  - [ ] Create `ConstraintsDataGrid` using Shadcn Table.
  - [ ] Grouping/Filtering by Scope and Type.

- [ ] Task 3: Constraint Editor Modal (AC: 2, 3)
  - [ ] Create `ConstraintForm` resource.
  - [ ] Implement dynamic rule inputs:
    - `TechListInput` (Tag input for packages)
    - `PatternInput` (Regex field with validation)

- [ ] Task 4: Integration & RBAC
  - [ ] Add route `/architecture-review/constraints`.
  - [ ] Ensure only TL/ADMIN can write.

## Dev Notes

- **Backend**: Story 7-5 implemented `ArchitectureConstraintsService` and `ArchitectureConstraintsController` (check if Controller CRUD endpoints exist, if not, they might need to be added or verified in 7-5 scope). *Self-correction: Story 7-5 focused on Validator Service. Needs confirmation if CRUD Controller was implemented. If not, Task 1 must include Backend Controller Implementation.*
- **UI Stack**: React, Shadcn UI, React Query, React Hook Form.

### Project Structure Notes

- UI Components: `src/pages/architecture-review/constraints/`
- Hooks: `src/hooks/api/`

### References

- [Backend Implementation: Story 7-5](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-5-architecture-patterns-constraints.md)
- [Design System: Shadcn UI](https://ui.shadcn.com)

## Dev Agent Record

### Agent Model Used

Antigravity 1.0

### File List

- src/pages/architecture-review/constraints/ConstraintsPage.tsx
- src/components/architecture-review/ConstraintList.tsx
- src/components/architecture-review/ConstraintForm.tsx
- src/api/architectureReviewApi.ts
- src/server/modules/architecture-review/architecture-constraints.controller.ts (If missing)
