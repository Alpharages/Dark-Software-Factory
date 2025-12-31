# Story 7-2-UI: TL Architecture Review Queue Interface

Status: drafted

<!-- Note: Frontend implementation for Story 7-2 backend API -->

## Background & Business Value

Epic 7 enables Technical Leads to review and approve AI architecture decisions before implementation, preventing technical debt and ensuring system quality (addresses Risk R7: TL Validation Bottleneck). Story 7.2 implemented the backend API for the review queue; this story (7.2-UI) delivers the visual interface for TLs to efficiently review ADRs, prioritize high-risk decisions, and approve/reject AI's technical choices.

- **Risk Mitigation:** Prevents technical debt accumulation via systematic TL review workflow
- **Operational Scalability:** Enables single TL to review architecture decisions across 50+ projects
- **Efficiency:** Filters and sorting allow TLs to prioritize high-risk/low-confidence decisions

## Story

**As a TL,**  
I want a visual queue of pending architecture decisions with filtering and prioritization,  
So that I can efficiently review high-risk decisions first and maintain system quality at scale.

---

## Acceptance Criteria

### AC#1: ADR Review Queue Table
- **Endpoint:** `GET /api/v1/architecture-review/queue`
- **Visualization:** Sortable data table showing pending ADRs
- **Columns:** 
  - Title (with preview tooltip)
  - Risk Level (Badge: 🔴 HIGH, 🟡 MEDIUM, 🟢 LOW)
  - AI Confidence (percentage bar or number)
  - Ticket Context (ticket title + ClickUp link icon)
  - Estimated Review Time (minutes)
  - Created Date
  - Action ("Review" button)
- **Default Sort:** Risk level DESC (HIGH → MEDIUM → LOW)
- **Row Click:** Opens ADR detail modal

### AC#2: Filter Controls (NFR-UX2: <3 clicks)
- **Filter by Risk Level:** Multi-select dropdown (HIGH, MEDIUM, LOW)
- **Filter by Project:** Searchable dropdown (fetched from projects API)
- **Filter by Confidence Range:** Dual-range slider (0-100%)
- **Filter by Date:** Date range picker (last 7/30/90 days, custom)
- **Clear Filters:** Single button to reset all filters

### AC#3: Sort Controls
- **Sort Options:** Risk Level (default), Confidence (low-first), Created Date (newest-first)
- **Visual Indicator:** Up/down arrow icon on active column header
- **Persist:** Sort preference saved in localStorage

### AC#4: ADR Detail Modal (Review Interface)
- **Trigger:** Click on table row or "Review" button
- **Content Sections:**
  - **Header:** ADR title, risk badge, confidence score
  - **Context:** Why this decision is needed (expandable)
  - **Decision:** What was chosen
  - **Consequences:** Positive/negative impacts (two-column layout)
  - **Alternatives Considered:** List with AI reasoning
  - **Ticket Context:** Link to ClickUp ticket, execution ID
- **Actions:** "Approve", "Reject", "Request Modification", "Defer" buttons
- **Note:** This story displays the modal; approval workflow is Story 7.4

### AC#5: Empty State & Loading States
- **Empty Queue:** Friendly message "No pending ADRs to review 🎉" with illustration
- **Loading:** Skeleton loaders for table rows during API fetch
- **Error State:** Error message with "Retry" button if API fails

### AC#6: Responsive Design (NFR-UX1)
- **Desktop:** Full table with all columns visible
- **Tablet:** Hide "Estimated Review Time" column, compress badges
- **Mobile:** Card-based layout instead of table

---

## Tasks / Subtasks

### 1. Repository Setup & Routing (dsf-dashboard)
- [ ] **Create API Wrapper:** `src/api/architectureReviewApi.ts` (AC: #1, #2)
  - [ ] Implement `getReviewQueue(filters)` using established `axios` pattern
  - [ ] Define TypeScript interfaces: `AdrQueueItem`, `AdrQueueFilters`
- [ ] **Define Routes:** Update `src/App.tsx` (AC: #1)
  - [ ] Add route: `/architecture-review/queue`
  - [ ] Wrap in `ProtectedRoute` (TL/ADMIN roles only)
- [ ] **Navigation:** Update `src/components/layout/Sidebar.tsx` (AC: #1)
  - [ ] Add "Architecture Review" link using `FileCheck` or `Shield` icon (lucide-react)
  - [ ] Role-based visibility: Show only for TL/ADMIN

### 2. Data Table Components
- [ ] **AdrReviewQueueTable:** Main sortable/filterable table component (AC: #1, #3)
  - [ ] **REUSE PATTERN:** Refer to `src/components/financial/ExportableDataTable.tsx` for sortable table implementation
  - [ ] Columns: Title, Risk Badge, Confidence, Ticket Context, Review Time, Created Date, Actions
  - [ ] Row click handler to open detail modal
  - [ ] Sort handlers for each column
- [ ] **RiskBadge:** Reusable badge component (AC: #1)
  - [ ] Color coding: RED (HIGH), YELLOW (MEDIUM), GREEN (LOW)
  - [ ] Icon + text format
- [ ] **ConfidenceIndicator:** Progress bar or percentage display (AC: #1)
  - [ ] Color logic: <70% yellow, >70% green

### 3. Filter Components
- [ ] **AdrQueueFilters:** Filter control panel (AC: #2)
  - [ ] Risk level multi-select (react-select or headlessui Listbox)
  - [ ] Project searchable dropdown (data from `/api/v1/projects`)
  - [ ] Confidence range slider (rc-slider or custom range input)
  - [ ] Date range picker (react-datepicker)
  - [ ] "Clear Filters" button
- [ ] **FilterChips:** Active filter display chips (AC: #2)
  - [ ] Show applied filters as removable chips
  - [ ] Click to remove individual filter

### 4. ADR Detail Modal
- [ ] **AdrDetailModal:** Full ADR preview modal (AC: #4)
  - [ ] Modal header with risk badge and confidence score
  - [ ] Expandable sections for Context, Decision, Consequences, Alternatives
  - [ ] Two-column layout for Consequences (Positive | Negative)
  - [ ] Ticket context with ClickUp link icon
  - [ ] Action buttons (placeholder for Story 7.4 approval workflow)
  - [ ] Close on ESC key or backdrop click

### 5. Empty States & Error Handling
- [ ] **EmptyState:** No ADRs found component (AC: #5)
  - [ ] Use illustration or icon (FileCheck with checkmark)
  - [ ] Message: "No pending ADRs to review 🎉"
- [ ] **LoadingSkeletons:** Skeleton loaders for table rows (AC: #5)
  - [ ] Shimmer effect using Tailwind CSS
- [ ] **ErrorBoundary:** Error state with retry button (AC: #5)

### 6. Integration & State Management
- [ ] **API Integration:** Connect to backend queue API (AC: #1, #2, #3)
  - [ ] Use `react-query` (TanStack Query) for data fetching and caching
  - [ ] Stale time: 2 minutes (ADR queue changes less frequently)
  - [ ] Refetch on window focus
- [ ] **Filter State:** Manage filter state and URL params
  - [ ] Use `useState` for local filter state
  - [ ] Sync filters to URL query params for shareable links
- [ ] **Sort State:** Persist sort preference in localStorage (AC: #3)

### 7. Responsive Design
- [ ] **Desktop Layout:** Full table with all columns (AC: #6)
- [ ] **Tablet Layout:** Hide "Estimated Review Time" column (AC: #6)
- [ ] **Mobile Layout:** Card-based layout instead of table (AC: #6)
  - [ ] Create `AdrQueueCard` component for mobile view

---

## Dev Notes / Developer Context

### Architecture & Tech Stack
- **Frontend:** React + TypeScript + Tailwind CSS
- **Repository:** `dsf-dashboard` (separate from backend NestJS app)
- **Layout Pattern:** Follow `src/pages/FinancialMetricsPage.tsx` for page structure
- **Table Pattern:** Reuse `ExportableDataTable.tsx` pattern for sortable columns
- **Icons:** Use `lucide-react` icons (`FileCheck`, `Shield`, `AlertTriangle`, `ExternalLink`)

### API Contracts (from Story 7.2 Backend)

**Endpoint:** `GET /api/v1/architecture-review/queue`

**Query Parameters:**
- `status` (optional): `PROPOSED` | `APPROVED` | `REJECTED` | `MODIFIED` | `DEFERRED` (default: `PROPOSED`)
- `risk_level` (optional): `LOW` | `MEDIUM` | `HIGH`
- `project_id` (optional): UUID
- `min_confidence` (optional): Float 0.0-1.0
- `max_confidence` (optional): Float 0.0-1.0
- `sort_by` (optional): `risk_level` | `created_at` | `confidence` (default: `risk_level`)
- `sort_order` (optional): `ASC` | `DESC` (default: `DESC`)

**Response:**
```typescript
{
  items: Array<{
    id: string;
    title: string;
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'DEFERRED';
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
    confidence: number; // 0.0-1.0
    created_at: string; // ISO 8601
    estimated_review_time_minutes: number;
    ticket: {
      id: string;
      title: string;
      clickup_id: string;
    } | null;
    execution_id: string;
  }>;
  total: number;
}
```

### TypeScript Interfaces

```typescript
// src/api/architectureReviewApi.ts
export interface AdrQueueItem {
  id: string;
  title: string;
  status: AdrStatus;
  risk_level: RiskLevel;
  confidence: number;
  created_at: string;
  estimated_review_time_minutes: number;
  ticket: {
    id: string;
    title: string;
    clickup_id: string;
  } | null;
  execution_id: string;
}

export type AdrStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'DEFERRED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AdrQueueFilters {
  status?: AdrStatus;
  risk_level?: RiskLevel;
  project_id?: string;
  min_confidence?: number;
  max_confidence?: number;
  sort_by?: 'risk_level' | 'created_at' | 'confidence';
  sort_order?: 'ASC' | 'DESC';
}

export interface AdrQueueResponse {
  items: AdrQueueItem[];
  total: number;
}
```

### UI Rules (NFR-UX Alignment)
- **NFR-UX1:** Responsive design - table must adapt to mobile/tablet/desktop
- **NFR-UX2:** Critical actions <3 clicks - "Review" button accessible in table
- **NFR-UX3:** Actionability - all UI elements must have clear purpose
- **NFR-UX8:** Visual cues - risk level color coding (RED/YELLOW/GREEN)

### Project Structure Notes
- Place components in `src/components/architecture-review/`
- API wrapper in `src/api/architectureReviewApi.ts`
- Page component: `src/pages/ArchitectureReviewQueuePage.tsx`
- Reuse existing table patterns from Financial Metrics dashboard

### Component Reuse Patterns

**From Financial Metrics (Story 6-R-3-UI):**
- `ExportableDataTable.tsx` → Sortable table pattern
- Badge components → Risk level badges
- Filter controls → Multi-select and range filters

**From Workload Dashboard (Story 5-4-UI):**
- Modal patterns → ADR detail modal
- Loading states → Skeleton loaders
- Error boundaries → Error handling

### References
- [Backend Story 7.2](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-2-tl-architecture-review-queue.md)
- [Epic 7: TL Architecture Review](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-7)
- [UI Pattern: Financial Metrics](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/6-R-3-UI-financial-metrics-dashboard-page.md)
- [UI Pattern: Workload Dashboard](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/5-4-UI-workload-capacity-dashboard.md)

### Known Dependencies
- **Backend Prerequisite:** Story 7.2 must be complete and deployed
- **Story 7.4 Integration:** Approval workflow buttons will be wired in Story 7.4
- **Future Enhancement:** Real-time Socket.IO updates when new ADRs are created (Epic 10)

---

## Dev Agent Record

### Agent Model Used

Antigravity (via Create-Story Workflow)

### Completion Notes List

<!-- Dev agent will populate this during implementation -->

### File List

**Expected New Files:**
- `src/api/architectureReviewApi.ts`
- `src/components/architecture-review/AdrReviewQueueTable.tsx`
- `src/components/architecture-review/RiskBadge.tsx`
- `src/components/architecture-review/ConfidenceIndicator.tsx`
- `src/components/architecture-review/AdrQueueFilters.tsx`
- `src/components/architecture-review/FilterChips.tsx`
- `src/components/architecture-review/AdrDetailModal.tsx`
- `src/components/architecture-review/AdrQueueCard.tsx` (mobile)
- `src/pages/ArchitectureReviewQueuePage.tsx`

**Expected Modified Files:**
- `src/App.tsx` (routing)
- `src/components/layout/Sidebar.tsx` (navigation)
