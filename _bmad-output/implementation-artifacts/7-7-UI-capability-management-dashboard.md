# Story 7.7-UI: Capability Management Dashboard

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TL,
I want a dashboard to visualize AI capability metrics and manage limitations,
so that I can make data-driven decisions on what to delegate to AI.

## Acceptance Criteria

1. **Given** I am on the Capability Dashboard
   **When** I view the "Capability Metrics" section
   **Then** I see:
   - Success rate charts by `TaskType` (Visual trend: Up/Down)
   - List of most frequent failure modes (e.g., "GraphQL Schema Generation: 40% fail")
   - "AI Confidence" trend over time

2. **Given** I identify a new limitation
   **When** I click "Add Limitation"
   **Then** I can:
   - Select a `TaskType` (from dynamic list)
   - Describe the limitation (Markdown supported)
   - Define a workaround (Markdown supported)
   - Toggle "Disable AI for this task type" (Critical switch)
   - Save to backend (creates `AiCapability` record)

3. **Given** a limitation exists
   **When** I edit it
   **Then** I can:
   - Update the workaround
   - Mark it as "Resolved" (if AI improves)
   - See a history of when this limitation was detected/added

4. **Given** I am a PM (not TL)
   **When** I view the dashboard
   **Then** I see:
   - Read-only view of "Known Limitations"
   - "Recommended Workarounds" for my tickets (e.g., "Don't assign DB migrations to AI")

## Tasks / Subtasks

- [ ] UI Setup & Routing
  - [ ] Create route `/architecture/capabilities`
  - [ ] Add sidebar link "AI Capabilities" (TL/Admin/PM access only)

- [ ] Component: Capability Metrics Widgets (AC#1)
  - [ ] Create `CapabilityTrendChart` (using Recharts/visx)
  - [ ] Create `TaskTypeSuccessGrid` (Cards showing success rate per type)
  - [ ] Integrate with `GET /api/v1/capabilities/dashboard`

- [ ] Component: Limitation Management (AC#2, #3)
  - [ ] Create `LimitationListTable` (filtering by TaskType, Status)
  - [ ] Create `LimitationFormModal` (Add/Edit capability)
  - [ ] Implement form validation (Description required)
  - [ ] API Integration: `POST/PUT /api/v1/capabilities/limitations`

- [ ] Component: Knowledge Base View (AC#4)
  - [ ] Create `PublicLimitationsView` for PMs (Simplified read-only list)
  - [ ] Add "Copy to Clipboard" for workarounds

- [ ] Integration & Testing
  - [ ] Unit tests for `LimitationFormModal` logic
  - [ ] E2E test: User adds a limitation -> appears in list
  - [ ] Verify RBAC (PM cannot edit, TL can)

## Dev Notes

- **Tech Stack**:
  - React (Vite/Next.js per project)
  - Recharts for metrics
  - React Hook Form for data entry
  - Shadcn UI for components (Cards, Dialogs, Forms)

- **API Dependencies**:
  - Backend Story 7.7 must be complete (or mocked)
  - `AiCapabilityService` API contract defined in Story 7.7

### Project Structure Notes

- Place components in `src/frontend/components/capabilities/` (or equivalent React structure)
- Use standard `api-client` types from backend DTOs

### References

- [Story 7.7 (Backend)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-7-tl-capability-management-ai-limitations.md)
