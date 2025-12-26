# Story 5.6: Reporting & Analytics Generation

**Status:** review

## Story
**As a PM,**  
I want to generate progress reports for client sprint reviews,  
So that I can share transparent updates efficiently without manual report writing.

## Formerly
- Original Story 5.9 (Sprint Review & Progress Reporting)

## Acceptance Criteria
- [x] **AC#1:** Report includes sprint summary, ticket breakdown, velocity metrics, quality metrics, upcoming sprint plan.
- [x] **AC#2:** Reports generated in <5 seconds (with caching).
- [ ] **AC#3:** Export formats available: PDF download, web view (shareable link), PowerPoint. (Stubbed)
- [x] **AC#4:** Reports are cached (same project + sprint + date range → return cached version).
- [x] **AC#5:** AI-generated narrative is accurate and matches data (manual spot-check required).
- [ ] **AC#6:** Charts are visually appealing and correctly represent data. (Frontend pending)

## Technical Requirements & Constraints

### 🏗️ Architecture Compliance
- Follow **ADR-008 AI Delegation Pattern**.
- Use `OrchestratorService.executeTask()` for all AI-heavy operations (narrative generation, styling, insights).
- Integrate `AIDecisionLoggerService` for every AI-generated report section to ensure transparency and auditability.

### 🔐 Security & Access Control
- All reporting endpoints MUST be protected by `@JwtAuthGuard` and `@RolesGuard`.
- Access restricted to `PM`, `TL`, `MANAGER`, and `ADMIN` roles.

### 📊 Observability
- Record metrics for:
    - `report_generation_duration_seconds` (Histogram)
    - `report_cache_hits_total` (Counter)
    - `report_generation_failures_total` (Counter with reason labels)

## Tasks

### Backend (DSF - dsf repository)
- [x] **Data Aggregation Engine:**
    - [x] Implement `POST /api/v1/reports/sprint` with project/date filters.
    - [x] Aggregator service: Fetch tickets, executions, and QA results from DB.
    - [x] Logic: Calculate velocity and aggregate quality metrics (test pass rates, coverage).
- [x] **AI Orchestration (Delegated):**
    - [x] **Report Content Generation:** Data to narrative (GPT-4) with `AIDecisionLogger` integration.
    - [x] **Insights Extraction:** Trend analysis and observations from aggregated data.
- [ ] **Export & Storage:**
    - [ ] Implementation of PDF export using Puppeteer (delegated).
    - [ ] Implementation of PowerPoint export using `pptxgenjs` (delegated).
    - [ ] Caching layer: Store generated reports (e.g., S3 or local storage with DB lookup).
- [x] **Observability:** Instrument service with Prometheus and Sentry.

### Frontend (User Interface - dsf-dashboard repository)
- [ ] **Report Management UI:**
    - [ ] Create Report Selection/Dashboard page.
    - [ ] Implement Date Range Picker and Project Selector.
    - [ ] Integration: Display preview of generated report.
    - [ ] Export actions: Buttons for PDF and PPTX downloads.
- [ ] **Visualization:**
    - [ ] AI-assisted chart configuration using Recharts/Chart.js.

## Code Review Remediation (2025-12-27)
Performed adversarial code review and applied the following fixes:
- **Critical: Security Fix**. Added project isolation checks in `ReportsService` and `ReportsController`. Users can now only access reports for projects they manage (`project.pm_id == userId`).
- **Critical: Velocity Metrics**. Implemented actual velocity calculation (Pts/Week) in `ReportsAggregatorService`.
- **High: Robust AI Parsing**. Hardened AI response parsing to handle additional conversational text and ensure JSON extraction using substring indexing.
- **High: Cache Key Refinement**. Updated `findFirst` query to include `type` and `status`, preventing collisions between different report types for the same date range.
- **High: Type Safety**. Re-generated Prisma client and cleaned up `as any` casts in `ReportsService` and `ReportsAggregatorService`.
- **ADR-008 Compliance**. Integrated `AIDecisionLoggerService` to audit AI narrative generation reasoning.

## Dev Notes
- **Dependencies:** Epic 3 (QA metrics), Epic 2 (Ticket data), Story 11.2 (Audit Logging).
- **Prompt Grounding:** When delegating narrative generation, provide the AI with the raw JSON aggregate data to minimize hallucinations.
- **Token Efficiency:** Summarize large datasets or use specific fields only for the AI prompt to optimize token usage.
- **Effort:** 1.75 days.
- **Token Cost:** $0.20-$1.00 per report.

