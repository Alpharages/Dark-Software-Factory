# Story 5.7: Dashboard UX Enhancements

**Status:** done

## Story
**As a PM,**  
I want keyboard shortcuts and quick actions,  
So that I can work efficiently without excessive clicking.

## Formerly
- Original Story 5.10 (Quick Actions & Keyboard Shortcuts)

## Acceptance Criteria
- [ ] **AC#1:** Keyboard shortcuts work: `A` (approve), `R` (reject), `E` (rework), `/` (search/palette), `N` (new ticket), `Esc` (close modal/palette), `?` (help).
- [ ] **AC#2:** Command palette (`Cmd+K`) shows searchable actions, recent projects, and jump-to-ticket functionality.
- [ ] **AC#3:** Tooltips display shortcuts on hover for all actionable elements (e.g., buttons in `ProjectCard`).
- [ ] **AC#4:** Shortcuts are scoped (e.g., `A/R/E` only active when a ticket is selected) and don't conflict with screen readers.
- [ ] **AC#5:** Shortcuts trigger visual feedback (loading states, toast notifications for success/failure).
- [ ] **AC#6:** Help modal (`?` key) shows a complete shortcut reference.

## Tasks

### Backend (DSF BUILDS)
- [x] **Shortcut Telemetry:** Implement Prometheus metric `dsf_keyboard_shortcut_usage_total{shortcut}` tracked in `MetricsService`.
- [x] **Ticket Search API:** Implement `GET /api/v1/pm-dashboard/tickets/search?query={q}` to support "jump-to-ticket" and palette search.
- [x] **Action Integration:** Ensure `ApprovalService` correctly handles `APPROVE`, `REJECT`, `REWORK`, `ESCALATE` (aligned with Prisma enums).
- [x] **Action Endpoint:** Confirm `POST /api/v1/executions/:id/approve` is accessible to PM/TL/ADMIN roles.

### AI DELEGATES (Frontend - dsf-dashboard)
- [x] **Library Installation:** Install `cmdk` (Command Palette) and `react-hotkeys-hook` (Shortcut management).
- [x] **Command Palette Component:** Integrate `cmdk` with searchable actions (Go to Project, Jump to Ticket, Global Search).
- [x] **Shortcut Hook-up:** Use `react-hotkeys-hook` for scoped shortcut handlers (`A`, `R`, `E`, `N`, `/`, `?`, `Esc`).
- [x] **UI Feedback:** Implement `react-hot-toast` or similar for shortcut action feedback.
- [x] **Tooltips & Help Modal:** Implement accessible tooltips and a help modal triggered by `?`.

## Dev Notes
- **Dependencies:** Story 5.1 (Dashboard foundation), Story 5.3 (Approval logic).
- **Backend API:** `POST /api/v1/executions/:id/approve` (Body: `{ decision: "APPROVE" | "REJECT" | "REWORK" | "ESCALATE", reasoning: string }`).
- **NFRs:** NFR-UX2 (critical actions <3 clicks), WCAG 2.1 AA.
- **Effort:** 1.8 days (increased from 1.6 due to extra API and telemetry).
