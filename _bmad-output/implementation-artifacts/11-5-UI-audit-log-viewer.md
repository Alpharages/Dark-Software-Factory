# Story 11.5: UI-audit-log-viewer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Tech Lead or QA Engineer,
I want a comprehensive UI to view and search AI decision audit logs,
so that I can understand why the AI made specific decisions, review low-confidence actions, and debug complex multi-step execution chains.

## Acceptance Criteria

1. **Decision Timeline Component**:
   - **Input**: `ticketId`
   - **Action**: Fetch data from `GET /api/v1/audit/timeline/:ticketId` mapped to `['audit-timeline', ticketId]` query key.
   - **Data Mapping**: Use the `AIDecisionLog` schema fields (`reasoning`, `confidence_score`, `model_used`, `prompt_tokens`, `completion_tokens`).
   - **Display**: Use a vertical timeline component (e.g., from `shadcn/ui` or custom).
   - **Content**: Show `timestamp`, `agent_name`, `action`, and `confidence` (badge colored by score).
   - **Drill-down**: Clicking an event opens a flyout/modal showing full `reasoning`. Use a proper Syntax Highlighter component to display the `input_data`, and `output_data` formatted JSON. Also expose token costs (`prompt_tokens`, `completion_tokens`).
   - **Real-Time Integration**: Listen for `audit.created` websocket events to invalidate the `['audit-timeline', ticketId]` query key.
2. **Low-Confidence Review Queue**:
   - **View**: A dedicated tab or page for "Review Required".
   - **Action**: Fetch data from `GET /api/v1/audit/low-confidence` mapped to `['audit-low-confidence']`.
   - **Display**: A list/table of decisions with confidence < 0.5.
   - **Filtering**: Allow adjusting the threshold slider (0.1 to 0.9) to refresh the view.
   - **Workflow (Rework)**: Integrate a "Request Rework" mutation to allow a PM to send the ticket back to the AI for clarification.
   - **Real-Time Integration**: Invalidate `['audit-low-confidence']` on websocket `audit.created` events if the incoming confidence breaches the threshold.
3. **Global Audit Search**:
   - **Endpoint**: Integrated with `GET /api/v1/audit/search` mapped to `['audit-search', filters]`.
   - **Filters**: UI for Agent Name, Action, Date Range, and Ticket ID.
   - **Results**: Paginated `@tanstack/react-table` with "View Detail" links for each record.

## Tasks / Subtasks

- [x] Task 1 (AC: 1,2,3) Setup Audit Log Viewer Feature Module
  - [x] Subtask 1.1: Create basic layout and routing for Audit Logs
  - [x] Subtask 1.2: Define shared TypeScript interfaces for Audit Log data aligning with `AIDecisionLog`
- [x] Task 2 (AC: 1) Implement Decision Timeline Component
  - [x] Subtask 2.1: Implement TanStack Query hook `useAuditTimeline(ticketId)` including Socket.IO `audit.created` invalidation
  - [x] Subtask 2.2: Build layout for vertical timeline with colored confidence badges
  - [x] Subtask 2.3: Implement `DecisionDetailModal` for JSON drill-down featuring Syntax Highlighting and token usage display
- [x] Task 3 (AC: 2) Implement Low-Confidence Review Queue
  - [x] Subtask 3.1: Create query hook `useLowConfidenceAudits()`
  - [x] Subtask 3.2: Build TanStack Table for "Review Required" items and threshold slider
  - [x] Subtask 3.3: Implement "Request Rework" mutation and UI
- [x] Task 4 (AC: 3) Implement Global Audit Search
  - [x] Subtask 4.1: Create advanced filtering form (Agent, Action, Date, Ticket ID)
  - [x] Subtask 4.2: Build paginated data table for search results

## Dev Notes

### 🚨 CRITICAL GUARDRAILS 🚨

1. **Immutability (NFR-S6)**: Audit logs are explicitly immutable. Do not introduce any edit or delete mutation capabilities.
2. **Tech Stack Constraints**: React 19, Tailwind CSS v4, and shadcn/ui.
3. **Data Management**: Rely entirely on TanStack Query (`@tanstack/react-query`) for API integrations and caching state. Use `@tanstack/react-table` for data grids (AC2 and AC3). No component-level fetching logic.

### Project Structure Notes

- **Repository**: `dsf-dashboard`
- Alignment with unified project structure:
  - Components location: `src/features/audit-logs/components/`
  - Hooks location: `src/features/audit-logs/hooks/`
  - Types/Interfaces: `src/features/audit-logs/types/`

### References

- NFR-S6: Audit logs must be immutable and tamper-proof [Source: prd.md]
- Architecture Integration details [Source: architecture.md]
- See skill `dashboard-ui-engineering` for architectural and component implementation requirements.

## Dev Agent Record

### Agent Model Used

Antigravity Create Story Optimizer (BMad)

### Debug Log References

- Extracted specific functional UI context from existing drafted story content.
- Ensured architectural guardrails map to `dsf-dashboard` capabilities.
- Verified absence of mutating actions (respecting NFR-S6 immutability rule).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- [AI-Review] Replaced plain <pre> tags with react-syntax-highlighter in DecisionDetailModal.
- [AI-Review] Removed duplicate junk components in `src/components/audit` and `src/pages/audit`.
- [AI-Review] Refactored LowConfidenceQueue performance and restored 0.1-0.9 slider range.
- [AI-Review] Added Date Range, View Detail links, and Pagination to AuditSearchForm.

### File List

- package.json (done)
- pnpm-lock.yaml (done)
- src/App.tsx (done)
- src/features/audit-logs/components/AuditTimeline.tsx (done)
- src/features/audit-logs/components/DecisionDetailModal.tsx (done)
- src/features/audit-logs/components/LowConfidenceQueue.tsx (done)
- src/features/audit-logs/components/AuditSearchForm.tsx (done)
