# Epic 5 Story Redesign - Delegation Analysis

**Date:** 2025-12-09  
**Analyst:** Amelia (Dev Agent)  
**Based On:** AI Delegation Pattern (ARCH-1), Epic 4 Retrospective  
**Decision Tree Source:** `/docs/architecture/adr-008-ai-delegation-pattern.md`

---

## Executive Summary

**Original Epic 5:** 10 stories for PM Dashboard & Project Orchestration  
**Recommendation:** Reduce to **6 stories** (40% reduction)  
**Overall Effort Reduction:** 58% (estimated)  
**Key Finding:** 70% of planned frontend work can be AI-generated

###Decision Summary Table

| Story | Original | Delegation Category | Recommendation | Effort Reduction |
|-------|----------|---------------------|----------------|------------------|
| 5.1 | PM Dashboard Frontend Foundation | HYBRID | Keep core + AI UI generation | 60% |
| 5.2 | Project List & Status Overview | HYBRID | Merge into 5.1 | 70% |
| 5.3 | Real-Time Ticket Status | BUILD | Keep (Socket.IO infrastructure) | 15% |
| 5.4 | Code Approval Workflow | HYBRID | Keep core workflow | 50% |
| 5.5 | AI Confidence Scores | BUILD | Merge into 5.4 (display logic) | 80% |
| 5.6 | Workload & Capacity Dashboard | HYBRID | Keep orchestration | 50% |
| 5.7 | Manager View - Team Capacity | HYBRID | Merge into 5.6 | 75% |
| 5.8 | Client Communication Log | DELEGATE | AI-heavy (transcription, NLP) | 60% |
| 5.9 | Sprint Review & Reporting | DELEGATE | AI-heavy (report generation) | 65% |
| 5.10| Quick Actions & Shortcuts | BUILD | Keep (simple, low complexity) | 20% |

---

## Detailed Story Analysis

### Story 5.1: PM Dashboard Frontend Foundation

**Original Scope:**
- Build responsive React/Vue/Angular dashboard
- Custom UI components (header, sidebar, cards)
- Real-time updates via Socket.IO
- Design system implementation

**Delegation Opportunities:**
1. **UI Component Generation** → DELEGATE ✅
   - Decision Tree: "Generate React components from Figma/wireframes" = NLP task
   - AI can generate 80% of UI boilerplate (components, styles, responsive layouts)
   - Example: "Generate React dashboard with sidebar, header, project cards using Tailwind"

2. **Design System CSS** → DELEGATE ✅
   - AI generates Tailwind config, theme colors, typography from design tokens
   - Reduces custom CSS from ~500 LOC to ~50 LOC oversight

**DSF Core Responsibilities:** 
- REST API endpoints (`GET /api/v1/pm-dashboard/projects`)
- Socket.IO gateway setup (real-time infrastructure)
- Authentication guards (@JwtAuthGuard)
- Database queries (Prisma)

**Recommendation:** HYBRID (60% effort reduction)
- **BUILD:** API endpoints, Socket.IO infrastructure, auth
- **DELEGATE:** UI components, styling, responsive layouts

**Rationale:** 
- Frontend UI = perfect AI delegation target (well-defined patterns, non-critical business logic)
- DSF owns data layer and real-time infrastructure (requires deterministic control)

**Estimated Effort Reduction:** 
- Original: 5 days (2 days API + 3 days frontend)
- With AI: 2 days (2 days API only, AI generates frontend in hours)
- **Reduction: 60%**

---

### Story 5.2: Project List & Status Overview

**Original Scope:**
- Project list with filters, sorting, searching
- Card/list view toggle
- Status indicators (green/yellow/red)
- Empty state handling

**Delegation Opportunities:**
1. **Filtering/Sorting Logic** → DELEGATE ✅
   - Decision Tree: "Data transformation and filtering" = can be AI-generated
   - AI generates React hooks for filters, sort, search

2. **Status Indicators** → DELEGATE ✅
   - AI generates visual components (badges, color coding)

**DSF Core Responsibilities:**
- API endpoint: `GET /api/v1/pm-dashboard/projects?pmId={id}`
- Database aggregations (ticket counts, status calculation)
- Pagination logic

**Recommendation:** MERGE INTO STORY 5.1 (70% effort reduction when combined)
- Project list is a feature of the dashboard, not a separate story
- API + UI can be completed together

**Rationale:**
- This is not a separate deliverable, it's part of dashboard foundation
- Merging reduces context switching and duplicate work (API setup, auth, etc.)

**Estimated Effort Reduction:**
- Original: 4 days standalone
- With AI + Merged: 1 day (incremental to 5.1)
- **Reduction: 75%**

---

### Story 5.3: Real-Time Ticket Execution Status

**Original Scope:**
- Socket.IO event subscriptions (execution-progress-update)
- Real-time status updates in UI (QUEUED → IN_PROGRESS → DEPLOYED)
- Progress indicators, spinners, estimated time

**Delegation Opportunities:**
1. **Progress UI Components** → DELEGATE ✅
   - AI generates progress bars, spinners, status badges
   
2. **Socket Event Handlers** → PARTIAL DELEGATE
   - AI can generate boilerplate Socket.IO client code
   - DSF must review Socket.IO event contracts for correctness

 **DSF Core Responsibilities:**
- Socket.IO server infrastructure (**CRITICAL** - Epic 10 dependency)
- Event emission logic (when to emit execution-progress-update)
- Database state management (update execution.status)

**Recommendation:** BUILD (15% effort reduction)
- **BUILD:** Socket.IO infrastructure, event contracts, state management
- **DELEGATE:** Progress UI components only

**Rationale:**
- Real-time infrastructure is DSF's core responsibility (NFR-P2: 2-second load times depend on efficient Socket.IO)
- Can't delegate infrastructure, only presentation layer

**Estimated Effort Reduction:**
- Original: 5 days (3 days Socket.IO + 2 days UI)
- With AI: 4 days (3 days Socket.IO + 1 day AI-generated UI)
- **Reduction: 20%** (limited because infrastructure can't be delegated)

**BLOCKER:** Socket.IO infrastructure deferred to Epic 10 (per sprint-status.yaml)

---

### Story 5.4: Code Approval Workflow Interface

**Original Scope:**
- Code diff viewer (files changed, additions/deletions highlighted)
- QA results summary display
- Approval action buttons (Approve, Reject, Request Rework, Escalate)
- Side-by-side ticket and AC display

**Delegation Opportunities:**
1. **Code Diff Rendering** → DELEGATE ✅
   - Decision Tree: "Formatting and rendering" = AI strength
   - AI can integrate `diff2html` or `react-diff-viewer` library

2. **QA Summary Formatting** → DELEGATE ✅
   - AI generates visual representation of QA results (tables, badges, charts)

3. **Form UI (Approve/Reject)** → DELEGATE ✅
   - AI generates React forms with validation

**DSF Core Responsibilities:**
- Approval state machine (business logic)
- API endpoints:
  - `POST /api/v1/executions/{id}/approve`
  - `POST /api/v1/executions/{id}/reject`
  - `POST /api/v1/executions/{id}/escalate`
- Database persistence (approval decisions, audit trail)
- RabbitMQ queue publishes (trigger next step in pipeline)

**Recommendation:** HYBRID (50% effort reduction)
- **BUILD:** Approval workflow logic, API endpoints, state machine
- **DELEGATE:** Diff rendering, QA summary display, form UI

**Rationale:**
- Approval decisions are critical business logic (DSF must own)
- Presentation layer (diff viewer, forms) is perfect for AI generation

**Estimated Effort Reduction:**
- Original: 6 days (3 days backend logic + 3 days frontend)
- With AI: 3 days (3 days backend only, AI generates frontend)
- **Reduction: 50%**

---

### Story 5.5: AI Confidence Scores & Uncertainty Flags

**Original Scope:**
- Display confidence score (0-100%) with color coding
- Uncertainty flags list (ambiguous requirements, edge cases)
- Automatic escalation logic for low confidence

**Delegation Opportunities:**
1. **Score Display UI** → DELEGATE ✅
   - AI generates confidence meters, gauges, color-coded badges

2. **Uncertainty Flags UI** → DELEGATE ✅
   - AI generates expandable/collapsible list components

**DSF Core Responsibilities:**
- Confidence score calculation (already exists in Epic 2 - ComplexityScorerService)
- Database storage (executions.confidence_score)
- Escalation business logic (if confidence < 70% → auto-escalate to TL)

**Recommendation:** MERGE INTO STORY 5.4 (80% effort reduction)
- Confidence score is part of approval workflow, not standalone
- Backend logic already exists (from Epic 2 Story 2.3)
- Only needs UI display (AI-delegated)

**Rationale:**
- This is a display-only story, not a separate feature
- Confidence scores are shown during approval workflow
- Merging eliminates story overhead

**Estimated Effort Reduction:**
- Original: 3 days
- With AI + Merged: 0.5 day (small increment to Story 5.4)
- **Reduction: 83%**

---

### Story 5.6: Workload & Capacity Dashboard

**Original Scope:**
- Calculate PM utilization % (active_tickets / max_tickets * 100)
- Burnout risk indicator (green/yellow/red)
- Workload metrics (tickets created, approved, revision rate)
- Alerts (\u003e80% utilization → notify Manager)

**Delegation Opportunities:**
1. **Utilization Calculation** → PARTIAL DELEGATE
   - Formula is simple (can be DSF or AI)
   - AI can generate SQL/Prisma aggregation queries

2. **Dashboard UI (Gauges, Charts)** → DELEGATE ✅
   - AI generates utilization meters, burnout risk indicators, trend charts

3. **Workload Metrics Aggregation** → BUILD
   - DSF owns this (business logic for ticket quality, revision rate)

**DSF Core Responsibilities:**
- Utilization calculation API endpoint
- Database aggregations (count tickets per PM, calculate rates)
- Alert logic (check thresholds, send notifications)
- Prometheus metrics (`pm_utilization_percent` gauge)

**Recommendation:** HYBRID (50% effort reduction)
- **BUILD:** Utilization API, aggregation logic, alerts, metrics
- **DELEGATE:** Dashboard UI, charts, gauges

**Rationale:**
- Utilization metrics = business logic with specific thresholds (DSF owns)
- Visualization = AI strength (generate Chart.js/Recharts components)

**Estimated Effort Reduction:**
- Original: 5 days (3 days backend + 2 days frontend)
- With AI: 2.5 days (2.5 days backend, AI generates charts/UI)
- **Reduction: 50%**

---

### Story 5.7: Manager View - Team Capacity Overview

**Original Scope:**
- View all PMs' utilization (bar chart)
- Reassign projects between PMs (drag-and-drop)
- Capacity trends over time
- Unbalanced workload alerts

**Delegation Opportunities:**
1. **Bar Chart Visualization** → DELEGATE ✅
   - AI generates React components with Chart.js/Recharts

2. **Drag-and-Drop UI** → DELEGATE ✅
   - AI can integrate `react-beautiful-dnd` or `dnd-kit` library

**DSF Core Responsibilities:**
- Same utilization API as Story 5.6 (but fetch all PMs, not just one)
- Project reassignment logic:
  - `POST /api/v1/projects/{id}/reassign`
  - Update projects.pm_id in database
  - Notify old PM and new PM
- RBAC enforcement (@Roles('MANAGER', 'ADMIN'))

**Recommendation:** MERGE INTO STORY 5.6 (75% effort reduction when combined)
- Manager view is an extension of workload dashboard, not separate story
- Same backend API, just different query scope (all PMs vs. one PM)
- UI-only differences (AI can generate team view alongside individual view)

**Rationale:**
- Reduces duplication (same metrics, same API, same charts)
- Manager view = RBAC-guarded version of PM workload dashboard

**Estimated Effort Reduction:**
- Original: 5 days standalone
- With AI + Merged: 1 day (incremental to 5.6)
- **Reduction: 80%**

---

### Story 5.8: Client Communication Log

**Original Scope:**
- Log client meeting details (date, duration, attendees)
- Upload meeting transcripts
- Link conversations to projects/tickets
- Tag conversation topics

**Delegation Opportunities:**
1. **Auto-Generated Summary** → DELEGATE ✅
   - Decision Tree: "Summarization" = NLP task
   - AI can summarize meeting transcripts (Whisper, GPT-4)

2. **Action Items Extracted** → DELEGATE ✅
   - Decision Tree: "Extraction" = NLP task
   - AI parses transcript and extracts action items

3. **Sentiment Analysis** → DELEGATE ✅
   - Decision Tree: "Sentiment analysis" = NLP task
   - AI analyzes client satisfaction/concern from tone

4. **Auto-Ticket Creation** → DELEGATE ✅
   - AI can draft tickets from action items (requires human approval)

**DSF Core Responsibilities:**
- Conversation storage (new table: client_conversations)
- API endpoints:
  - `POST /api/v1/conversations` (create conversation record)
  - `POST /api/v1/conversations/{id}/link-project`
- File upload handling (transcripts)
- Link conversations to projects/tickets (database relations)

**Recommendation:** DELEGATE (60% effort reduction)
- **BUILD:** Conversation storage, linking logic, file upload, API
- **DELEGATE:** Transcription, summarization, action extraction, sentiment analysis, ticket drafting

**Rationale:**
- NLP tasks (summarization, extraction, sentiment) are AI's core strengths
- DSF only needs to store results and provide UI for review/approval

**Estimated Effort Reduction:**
- Original: 6 days (2 days storage + 4 days NLP services)
- With AI: 2.5 days (2 days storage + 0.5 day AI integration)
- **Reduction: 58%**

**CRITICAL:** This is the highest ROI delegation opportunity in Epic 5

---

### Story 5.9: Sprint Review & Progress Reporting

**Original Scope:**
- Generate progress reports for client sprint reviews
- Report includes: sprint summary, ticket breakdown, velocity, quality metrics
- Export formats: PDF, web view, PowerPoint

**Delegation Opportunities:**
1. **Report Content Generation** → DELEGATE ✅
   - Decision Tree: "Generate report text" = NLP task
   - AI can write sprint summary, ticket descriptions, insights

2. **Chart Creation** → DELEGATE ✅
   - AI can generate Chart.js/Recharts visualizations
   - Velocity trends, quality metrics charts

3. **PDF/PowerPoint Export** → DELEGATE ✅
   - AI can use Puppeteer to convert HTML → PDF
   - AI can generate PowerPoint slides using libraries

**DSF Core Responsibilities:**
- Data aggregation:
  - Fetch tickets, executions, QA results from database
  - Calculate velocity (tickets completed vs. planned)
  - Aggregate quality metrics (test pass rate, coverage, defects)
- API endpoint: `GET /api/v1/reports/sprint?projectId={id}&startDate={}&endDate={}`
- Template storage (configurable per client)

**Recommendation:** DELEGATE (65% effort reduction)
- **BUILD:** Data aggregation API, template configuration
- **DELEGATE:** Report generation, chart creation, PDF/PowerPoint export

**Rationale:**
- Report generation (text, charts, formatting) = AI's strength
- DSF just needs to provide structured data and templates

**Estimated Effort Reduction:**
- Original: 5 days (2 days data aggregation + 3 days report generation/export)
- With AI: 1.75 days (1.5 days data + 0.25 days AI integration)
- **Reduction: 65%**

---

### Story 5.10: Quick Actions & Keyboard Shortcuts

**Original Scope:**
- Keyboard shortcuts (A = Approve, R = Reject, / = Search, etc.)
- Command palette (Cmd+K for searchable actions)
- Tooltips showing shortcuts on hover

**Delegation Opportunities:**
1. **Shortcut UI Implementation** → PARTIAL DELEGATE
   - AI can generate hook-up code for keyboard shortcut libraries (Mousetrap, React HotKeys)
   - But configuration is simple (not much to delegate)

2. **Command Palette Component** → DELEGATE ✅
   - AI can integrate `cmdk` or `kbar` library
   - Generate React component with search and actions

**DSF Core Responsibilities:**
- Define shortcut mappings (which keys trigger which actions)
- Integrate with existing action handlers (approve, reject, escalate)
- Accessibility considerations (must not conflict with screen readers)

**Recommendation:** BUILD (20% effort reduction)
- **BUILD:** Shortcut configuration, action handler integration, accessibility
- **DELEGATE:** Command palette UI component only

**Rationale:**
- This story is already low complexity (~2 days)
- Keyboard shortcuts are simple JavaScript event handlers
- Not enough complexity to justify heavy AI delegation

**Estimated Effort Reduction:**
- Original: 2 days
- With AI: 1.6 days (small UI component generation)
- **Reduction: 20%**

---

## Delegation Summary by Pattern

### DELEGATE (AI-Heavy)
- **Story 5.8:** Client Communication Log (NLP: transcription, summarization, extraction, sentiment)
- **Story 5.9:** Sprint Review & Reporting (report generation, chart creation, export)

### HYBRID (DSF Orchestration + AI Execution)
- **Story 5.1:** PM Dashboard Frontend (API + Socket.IO = DSF, UI = AI)
- **Story 5.4:** Code Approval Workflow (workflow logic = DSF, diff rendering = AI)
- **Story 5.6:** Workload & Capacity (metrics = DSF, charts = AI)

### BUILD (DSF Core Responsibility)
- **Story 5.3:** Real-Time Ticket Status (Socket.IO infrastructure)
- **Story 5.10:** Quick Actions (simple, low effort)

### MERGE CANDIDATES
- **5.2 → 5.1:** Project list is part of dashboard foundation
- **5.5 → 5.4:** Confidence scores displayed in approval workflow
- **5.7 → 5.6:** Manager view is extension of workload dashboard

---

## Effort Reduction Calculation

| Story | Original Effort (days) | With AI (days) | Reduction % |
|-------|------------------------|----------------|-------------|
| 5.1 + 5.2 (merged) | 9 (5+4) | 3 | 67% |
| 5.3 | 5 | 4 | 20% |
| 5.4 + 5.5 (merged) | 9 (6+3) | 3.5 | 61% |
| 5.6 + 5.7 (merged) | 10 (5+5) | 3.5 | 65% |
| 5.8 | 6 | 2.5 | 58% |
| 5.9 | 5 | 1.75 | 65% |
| 5.10 | 2 | 1.6 | 20% |
| **TOTALS** | **46 days** | **19.35 days** | **58%** |

**Validation:** ✅ Exceeds 30-40% reduction target (achieved 58%)

---

## FR Coverage Validation

### FR8-FR14 (PM Orchestration)
- ✅ FR8: View all projects (Story 5.1 - Dashboard API)
- ✅ FR9: Real-time status monitoring (Story 5.3 - Socket.IO)
- ✅ FR10: Completion notifications (Story 5.3 - Socket.IO events)
- ✅ FR11: Approve AI code (Story 5.4 - Approval workflow)
- ✅ FR12: Request AI rework (Story 5.4 - Rejection with feedback)
- ✅ FR13: View confidence scores (Story 5.4 - Merged from 5.5)
- ✅ FR14: Escalate tickets (Story 5.4 - Escalation action)

### FR15-FR19 (Workload Management)
- ✅ FR15: View utilization % (Story 5.6 - Workload dashboard)
- ✅ FR16: Burnout risk indicators (Story 5.6 - Red/yellow/green alerts)
- ✅ FR17: Capacity limit alerts (Story 5.6 - Alert logic)
- ✅ FR18: Manager workload distribution (Story 5.6 - Merged from 5.7)
- ✅ FR19: Manager reassign projects (Story 5.6 - Reassignment API)

### FR20-FR23 (Client Communication)
- ✅ FR20: Log conversations with AI transcription (Story 5.8 - NLP delegation)
- ✅ FR21: Share progress reports (Story 5.9 - Report generation)
- ✅ FR22: Schedule sprint reviews (Story 5.9 - Report templates)
- ✅ FR23: Document client feedback (Story 5.8 - Link to tickets)

### FR96-FR99 (PM Dashboard)
- ✅ FR96: PM dashboard with project portfolio (Story 5.1)
- ✅ FR97: Project status at-a-glance (Story 5.1 - Status cards)
- ✅ FR98: Quick actions (Story 5.10 - Shortcuts)
- ✅ FR99: Real-time updates (Story 5.3 - Socket.IO)

**Result:** ✅ All 27 FRs covered (no gaps detected)

---

## Risks & Concerns

### 1. Socket.IO Dependency (Story 5.3)
- **Risk:** Socket.IO infrastructure deferred to Epic 10 per sprint-status.yaml
- **Impact**: Story 5.3 cannot be implemented until Epic 10 completes
- **Mitigation:** Keep Story 5.3 in Epic 5 plan, but mark as BLOCKED until Epic 10 delivers

### 2. AI-Generated UI Quality
- **Risk:** AI may generate non-accessible or poorly-performing UI components
- **Impact:** Accessibility (NFR-UX7) and performance (NFR-P2) requirements may not be met
- **Mitigation:** 
  - Include accessibility requirements in AI prompts
  - Manual review of AI-generated components before merging
  - Performance testing with Lighthouse

### 3. Frontend Technology Stack Not Chosen
- **Risk:** Epics.md says "choose React/Vue/Angular based on team preference"
- **Impact:** Can't finalize frontend delegation strategy without tech stack decision
- **Mitigation:** Recommend React (most AI-friendly for code generation, largest ecosystem)

### 4. Report Generation Cost
- **Risk:** AI-generated reports (Story 5.9) may incur high token costs if run frequently
- **Impact:** Cost tracking (Epic 6) may flag reports as expensive
- **Mitigation:** 
  - Cache report generation (don't regenerate for same sprint/date range)
  - Offer "draft" vs "final" report modes (draft = cheaper AI model)

---

## Recommendations for Next Steps

1. **User Review Required:**
   - Story count reduction (10 → 6: acceptable?)
   - Merged stories (5.2→5.1, 5.5→5.4, 5.7→5.6: acceptable?)
   - Socket.IO dependency (5.3 blocked until Epic 10: acceptable?)

2. **Frontend Tech Stack Decision:**
   - Recommend: **React** + **Tailwind CSS** + **TypeScript**
   - Rationale: Best AI code generation support, modern patterns

3. **Epic 10 Coordination:**
   - Confirm Socket.IO will deliver FR9, FR10, FR99 requirements before Epic 5 needs them
   - OR: Implement polling fallback temporarily

4. **Prototype AI Delegation:**
   - Before full Epic 5 development, prototype Story 5.8 (Client Communication Log)
   - Validate AI transcription, summarization works as expected
   - Measure token costs and quality

---

## Appendix: Decision Tree Applied

**Decision Tree (from ARCH-1):**

```
START: New feature requirement
  │
  ├─ Does the task involve executing existing CLI tools?
  │   YES → DELEGATE TO AI ✅
  │   NO → Continue
  │
  ├─ Does the task require parsing/interpreting tool outputs?
  │   YES → DELEGATE TO AI ✅
  │   NO → Continue
  │
  ├─ Does the task involve natural language processing?
  │   YES → DELEGATE TO AI ✅  ← Stories 5.8, 5.9
  │   NO → Continue
  │
  ├─ Is this a business logic decision?
  │   YES → BUILD CUSTOM SERVICE ⚠️  ← Stories 5.4, 5.6
  │   NO → Continue
  │
  ├─ Is this data storage/retrieval?
  │   YES → BUILD CUSTOM SERVICE ⚠️  ← All stories (API layer)
  │   NO → Continue
  │
  ├─ Is this observability?
  │   YES → BUILD CUSTOM SERVICE ⚠️  ← Metrics in 5.3, 5.6
  │   NO → Consider delegation
  │
  └─ DEFAULT: Prototype with AI delegation first
```

**Application Results:**
- **DELEGATE (2 stories):** 5.8 (NLP), 5.9 (NLP)
- **HYBRID (3 stories):** 5.1+5.2 (API+UI), 5.4+5.5 (workflow+UI), 5.6+5.7 (metrics+UI)
- **BUILD (1 story):** 5.3 (Socket.IO infrastructure)
- **SIMPLE BUILD (1 story):** 5.10 (keyboard shortcuts - too simple to delegate)

---

**Analysis Complete:** 2025-12-09  
**Next Step:** Create redesigned story outlines (Day 2)
