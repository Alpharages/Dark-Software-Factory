# Story 5.7: Dashboard UX Enhancements

**Status:** ready-to-start

## Story
**As a PM,**  
I want keyboard shortcuts and quick actions,  
So that I can work efficiently without excessive clicking.

## Formerly
- Original Story 5.10 (Quick Actions & Keyboard Shortcuts)

## Acceptance Criteria
- [ ] **AC#1:** Keyboard shortcuts work: `A` (approve), `R` (reject), `E` (escalate), `/` (search), `N` (new ticket), `Esc` (close modal).
- [ ] **AC#2:** Command palette (`Cmd+K`) shows searchable actions, recent projects, jump-to-ticket.
- [ ] **AC#3:** Tooltips display shortcuts on hover for all actionable elements.
- [ ] **AC#4:** Shortcuts don't conflict with screen reader hotkeys (accessibility tested).
- [ ] **AC#5:** Help modal (`?` key) shows complete shortcut reference.

## Tasks

### Backend (DSF BUILDS)
- [ ] Define shortcut mappings configuration.
- [ ] Integrate with existing action handlers (approve, reject, escalate).
- [ ] Accessibility considerations and mapping.
- [ ] Telemetry tracker for shortcut usage.

### AI DELEGATES
- [ ] Command palette UI component integration (`cmdk` or `kbar`).
- [ ] Keyboard shortcut hook-up (React HotKeys/Mousetrap).
- [ ] Tooltips and Help modal UI implementation.

## Dev Notes
- **Dependencies:** Story 5.1 (Dashboard foundation).
- **FRs Covered:** FR98.
- **NFRs Addressed:** NFR-UX2 (critical actions <3 clicks).
- **Effort:** 1.6 days.
