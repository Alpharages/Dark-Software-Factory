# Story 26.1: New Project Creation Dialog

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM,
I want to create a new project directly from the PM Dashboard,
so that I can onboard a new client project without navigating away from my portfolio view.

## Acceptance Criteria

1. **Given** a PM is on the PM Dashboard
   **When** they click the "New Project" button
   **Then** a `<Dialog>` or slide-in `<Sheet>` opens with the following fields: Project Name (required text), Client Name (required text), ClickUp List ID (required text, maps to backend `clickup_list_id`), GitHub Repository URL (optional text)
   **And** all required fields show inline validation errors if submitted empty

2. **Given** the PM fills in all required fields and clicks "Create Project"
   **When** the form submits
   **Then** `POST /api/v1/projects` is called with the form data (mapped to backend `CreateProjectDto` shape)
   **And** on success the dialog closes and the new project card appears in the dashboard grid
   **And** a success toast shows "Project created successfully"
   **And** on failure an error message renders inside the dialog (dialog does not close)

3. **Given** the `POST /api/v1/projects` endpoint in the backend
   **When** a PM user attempts to create a project
   **Then** they must be authorized to do so (the endpoint must allow the `Role.PM` role)

4. **Given** the PM clicks the "New Project" button
   **When** the dialog opens
   **Then** no toast stub fires as the only response — the full dialog renders

## Tasks / Subtasks

- [x] Task 1: Create the UI Component for New Project Dialog (AC: 1, 3)
  - [x] Implement a `NewProjectDialog` component using `shadcn/ui` Dialog or Sheet.
  - [x] Build the form using React Hook Form and Zod for schema validation.
  - [x] Define required fields (`name`, `client_name`, `clickup_list_id`) and optional (`github_repository_url`).
  - [x] Ensure inline validation errors are displayed for empty required fields.
- [x] Task 2: Integrate with Backend and Handle Submission (AC: 2)
  - [x] Implement the `POST /api/v1/projects` API call inside the form submission handler.
  - [x] Ensure payload structure strictly matches the backend `CreateProjectDto` (`name`, `clickup_list_id`, `client_name`, `github_repository_url`, `pm_id`). Note: `github_repository_url` is required in backend DTO, so frontend needs to handle empty gracefully or send a placeholder if not provided, or update backend DTO to be optional.
  - [x] Handle success state: close the dialog, show a success toast, and invalidate the React Query projects list to refresh the dashboard.
  - [x] Handle error state: keep the dialog open, and display the error message within the dialog (`e.response?.data?.message`).
- [x] Task 3: Update Backend Roles for Project Creation (AC: 4)
  - [x] In the backend repo, update `ProjectController.create` (`src/projects/project.controller.ts`) to include `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)`. Currently, it only allows ADMIN and MANAGER.
  - [x] _Optimization:_ Review `CreateProjectDto` to ensure frontend expectations of optional `githubRepoUrl` are supported (backend currently has `@IsNotEmpty()` on `github_repository_url`).
- [x] Task 4: Replace the stub button (AC: 3)
  - [x] In the PM Dashboard view, replace the stubbed "New Project" button's `onClick` action (which fires a toast) to open the new `NewProjectDialog`.

## Dev Notes

- **Frontend Repo**: `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React 19, Tailwind CSS v4, shadcn/ui).
- **Backend Repo**: `/Volumes/Data/project/products/alpharages/Dark Software Factory`. Ensure the `POST /api/v1/projects` endpoint is available, allows `Role.PM`, and aligns with the expected payload.
- **DTO Alert**: The frontend wants `githubRepoUrl` to be optional, but backend `CreateProjectDto.github_repository_url` requires it stringently. **Fix this** (make optional in backend or enforce in frontend). Also map "Client Name" to `client_name` and "ClickUp Workspace ID" to `clickup_list_id`. You must provide `pm_id` (from `useAuth().user?.id`) in the payload.
- Use `shadcn/ui` components (`Dialog`, `Form`, `Input`, `Button`, `useToast`).
- Use React Hook Form + Zod for structured, accessible form interactions.
- Ensure the newly created project immediately appears by calling `queryClient.invalidateQueries({ queryKey: ['projects'] })` (or whichever key is used for the PM dashboard).

### Project Structure Notes

- Place the `NewProjectDialog` in an appropriate components directory, like `src/components/dashboard` or `src/features/projects/components` within the frontend repository.
- Ensure API service functions for `/api/v1/projects` exist in the frontend API module.

### References

- [Source: docs/QA-REPORT-2026-02-27.md#PM-Dashboard-Feature-Completion] (FR16 / QA-FR16)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-26.1:-New-Project-Creation-Dialog]

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

N/A

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- ✅ Implemented NewProjectDialog in the frontend with React Hook Form and Zod validation, mapping to backend CreateProjectDto.
- ✅ Updated `CreateProjectDto.github_repository_url` to be optional in the backend, supporting the frontend requirement.
- ✅ Added `Role.PM` to the `create` endpoint in `ProjectController` to authorize PMs to create projects.
- ✅ Replaced the PM Dashboard stub button with integration for the new dialog, added success caching invalidation, and wrote unit test coverage.

### Change Log

- Date: 2026-03-02
  - Backend: Updated `CreateProjectDto` and `ProjectController` for PM assignment and optional GitHub URLs. Checked via unit tests.
  - Frontend: Created `NewProjectDialog.tsx`, test suite, and integrated into `App.tsx`. Checked via unit tests.

### File List

- `_bmad-output/implementation-artifacts/26-1-new-project-creation-dialog.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `/Volumes/Data/project/products/alpharages/Dark Software Factory/src/projects/dto/create-project.dto.ts`
- `/Volumes/Data/project/products/alpharages/Dark Software Factory/src/projects/project.controller.ts`
- `/Volumes/Data/project/products/alpharages/Dark Software Factory/src/projects/project.service.ts`
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/dashboard/NewProjectDialog.tsx`
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/__tests__/components/NewProjectDialog.test.tsx`
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/App.tsx`
