# Story 7.2-UI: Architecture Review Queue (Frontend)

**Status:** ready-for-dev  
**Epic:** Epic 7 (Architecture Decision Records & Review Queue)  
**Story ID:** 7-2-UI-architecture-review-queue  
**Priority:** Medium  
**Effort:** 2-3 days  
**Dependencies:** Story 7-2 (TL Architecture Review Queue Backend) ✅ Complete  
**Repository:** `dsf-dashboard` (React + TypeScript + Tailwind)

---

## Story

**As a TL,**  
I want a user-friendly interface to review architecture decisions made by AI,  
So that I can efficiently approve, reject, or modify ADRs with less than 3 clicks per NFR-UX2.

---

## Business Value

- **Enable TL Review Workflow:** Complete the Epic 7 architecture review loop with frontend UI
- **NFR Compliance:** \<3 clicks per review (NFR-UX2) enforced via dedicated UI components
- **Risk Prioritization:** Visual indicators for high-risk decisions requiring urgent review
- **Executive Oversight:** Architecture decision transparency for management visibility
- **Audit Trail:** UI access to AI architecture decisions with rationale and risk levels

---

## Context & Background

Epic 7 enables Technical Leads to review and approve AI architecture decisions before implementation, preventing technical debt and ensuring system quality (addresses Risk R7: TL Validation Bottleneck). Story 7.2 implemented the backend API for the review queue; this story (7.2-UI) delivers the visual interface for TLs to efficiently review ADRs, prioritize high-risk decisions, and approve/reject AI's technical choices.

**Completed Prerequisites:**
- ✅ Story 7-1: AI generates ADRs automatically during code generation
- ✅ Story 7-2: Backend API `GET /api/v1/architecture-review/queue` with filters/sort

**This Story Scope:**
- Frontend UI for TL Architecture Review Queue
- Table view with risk prioritization and filtering
- ADR detail modal for comprehensive review
- Review action buttons (integrated with Story 7-2 backend)

---

## Acceptance Criteria

### AC#1: Architecture Review Queue Page ✅

**Given** I am a TL or ADMIN  
**When** I navigate to `/architecture-review/queue`  
**Then** I should see:
- Header with page title "Architecture Review Queue"
- Table/list of pending ADRs (status: `PROPOSED`)
- Filters: Risk level, Project, Confidence score
- Sort options: Risk level (default), Date, Confidence (low → high)
- Visual risk indicators: 🔴 HIGH, 🟡 MEDIUM, 🟢 LOW
- Each ADR shows:
  - Title (e.g., "Use Redis for Session Storage")
  - Risk level badge (color-coded)
  - AI confidence score (0.0-1.0 as percentage)
  - Ticket context (feature being implemented)
  - Estimated review time (HIGH: 15min, MEDIUM: 8min, LOW: 3min)
  - "Review" button (\<3 clicks to detail view per NFR-UX2)

**Technical Requirements:**
- Route: `/architecture-review/queue`
- Sidebar navigation: "Architecture Review" 🏗️ icon (visible to TL/ADMIN only)
- Role guard: Redirect to `/` if not TL/ADMIN (use auth context)
- Responsive: Mobile (stacked cards), Tablet (2-col grid), Desktop (table view)
- Empty state: "No ADRs pending review" with illustration

---

### AC#2: Filter & Sort Interface ✅

**Given** I am viewing the review queue  
**When** I use filters and sorting  
**Then**:
- Filter dropdowns work:
  - **Risk Level:** HIGH | MEDIUM | LOW | All (default: All)
  - **Project:** Multi-select dropdown (fetched from `/api/v1/pm-dashboard/projects`)
  - **AI Confidence:** Slider 0-100% or min/max inputs (default: 0-100%)
- Sort dropdown works:
  - **Risk Level:** HIGH → MEDIUM → LOW (default)
  - **Date:** Newest → Oldest
  - **Confidence:** Lowest → Highest (prioritize low-confidence reviews)
- "Clear Filters" button resets to defaults
- URL params update for bookmarkable filters (e.g., `?risk=HIGH&project=abc`)
- Results update immediately (React Query or SWR cache invalidation)

**Technical Requirements:**
- Query params in URL for filter state persistence
- Filter state stored in React state or Zustand store
- API call: `GET /api/v1/architecture-review/queue?risk_level=HIGH&project_id=...&sort_by=risk_level`

---

### AC#3: ADR Detail View Modal ✅

**Given** I click "Review" on an ADR in the queue  
**When** the detail modal opens  
**Then** I should see:

**Header Section:**
- ADR title (large)
- Status badge (PROPOSED in yellow)
- Risk level badge (🔴🟡🟢 with label)
- AI confidence score (e.g., "85% confident")
- Created date + Ticket context (clickable link to ticket)

**Content Sections:**
1. **Context:** Why this decision is needed (from AI)
2. **Decision:** What was chosen (from AI)
3. **Consequences:** Positive/negative impacts (from AI)
4. **Alternatives Considered:** Other options AI evaluated (from AI)

**Action Buttons (Footer):**
- "Approve" button (green) → Updates status to `APPROVED`
- "Reject" button (red) → Updates status to `REJECTED`, prompts for rejection reason
- "Request Modification" button (yellow) → Updates status to `MODIFIED`, prompts for modification notes
- "Defer" button (gray) → Updates status to `DEFERRED`, prompts for defer reason
- "Close" button (cancel action)

**Technical Requirements:**
- Modal overlay (shadcn/ui Dialog component)
- Markdown rendering for ADR content sections
- API call on action: `POST /api/v1/architecture-review/{id}/review`
- Toast notification on success: "✅ ADR Approved" or "❌ ADR Rejected"
- Modal closes and queue refreshes after action
- Keyboard shortcut: ESC to close, A to approve, R to reject (accessibility)

---

### AC#4: Review Action Workflow ✅

**Given** I click an action button (Approve/Reject/Modify/Defer)  
**When** I submit the action  
**Then**:
- If **Approve**: No prompt, instant status update
- If **Reject**: Modal prompts for rejection reason (required text input)
- If **Modify**: Modal prompts for modification notes (required text input)
- If **Defer**: Modal prompts for defer reason (optional text input)
- API call sent to backend: `POST /api/v1/architecture-review/{adrId}/review`
  - Request body: `{ action: 'APPROVE'|'REJECT'|'MODIFY'|'DEFER', notes?: string }`
- Success toast shows confirmation message
- ADR removed from queue (status changes from PROPOSED)
- Queue re-fetches to reflect updated list

**Technical Requirements:**
- Validation: Reject/Modify requires notes (min 10 characters)
- Loading spinner on action button during API call
- Error handling: Display API error messages (e.g., "ADR already reviewed")
- Optimistic UI update: Remove ADR from list before API response (rollback on error)

---

### AC#5: Empty States & Loading ✅

**Given** I am viewing the queue  
**When** the data is loading or empty  
**Then**:
- **Loading State:** Skeleton loaders for 3-5 placeholder rows
- **Empty State:** "🎉 No ADRs pending review! All architecture decisions approved."
  - Illustration or icon
  - "View All ADRs" link → Navigate to `/architecture-review/all`
- **No Results State:** "No ADRs match your filters. Try adjusting filter criteria."
  - "Clear Filters" button visible

**Technical Requirements:**
- React suspense or loading state boolean
- Skeleton component reused from other dashboard pages (consistency)

---

### AC#6: Responsive Design & Accessability ✅

**Given** I am using the page on any device  
**When** I interact with the UI  
**Then**:
- **Responsive Breakpoints:**
  - Mobile (640px): Stacked card layout, 1 column, compact filters
  - Tablet (1024px): 2-column grid, collapsible filter panel
  - Desktop (1920px): Full table view, side-by-side filters
- **Accessibility (WCAG 2.1 AA):**
  - ARIA labels on interactive elements
  - Keyboard navigation (Tab, Enter, Escape support)
  - Screen reader announcements for actions ("ADR approved")
  - Color contrast meets AA standards (risk badges, buttons)
- **Dark Mode:** Respects user's theme preference (if design system supports)

**Technical Requirements:**
- Tailwind responsive classes (`sm:`, `md:`, `lg:`, `xl:`)
- ARIA attributes: `aria-label`, `aria-labelledby`, `role="dialog"`
- Keyboard event handlers for shortcuts

---

## Tasks / Subtasks

### 1. Page Setup & Routing (AC: #1)

- [ ] **Create Architecture Review Queue Page:** `src/pages/ArchitectureReviewQueuePage.tsx`
  - [ ] Header with title, breadcrumbs, filter section
  - [ ] Table/grid layout for ADR list
  - [ ] Role-based access guard (useAuth hook)

- [ ] **Add Route:** Update `src/App.tsx` (or Next.js `/app` directory)
  - [ ] Route: `<Route path="/architecture-review/queue" element={<ArchitectureReviewQueuePage />} />`
  - [ ] Protected route wrapper: `<ProtectedRoute requiredRole="TL" />` or equivalent

- [ ] **Sidebar Navigation:** Update `src/components/layout/Sidebar.tsx`
  - [ ] Add "Architecture Review" link with 🏗️ icon (lucide-react `Building` or `FileCheck`)
  - [ ] Conditional rendering: Show only for TL/ADMIN roles
  - [ ] Active state when on `/architecture-review/queue`

---

### 2. ADR Queue List Component (AC: #1, #2, #3)

- [ ] **Create ADR Queue Table:** `src/components/architecture-review/AdrReviewQueueTable.tsx`
  - [ ] Table columns: Title, Risk Level, Confidence, Project, Ticket, Review Time, Actions
  - [ ] Risk level badge component (color-coded)
  - [ ] Confidence score as percentage (e.g., `85%`)
  - [ ] "Review" button per row → Opens detail modal
  - [ ] Empty state: "No ADRs pending"
  - [ ] Loading skeleton for data fetch
  - [ ] **REUSE PATTERN:** Refer to `src/components/financial/ExportableDataTable.tsx` for sortable table implementation

- [ ] **Create Filter Panel:** `src/components/architecture-review/AdrQueueFilters.tsx`
  - [ ] Risk level dropdown (ALL, HIGH, MEDIUM, LOW)
  - [ ] Project multi-select (fetch from `/api/v1/pm-dashboard/projects`)
  - [ ] Confidence range slider or min/max inputs
  - [ ] Sort dropdown (risk_level, created_at, confidence)
  - [ ] "Clear Filters" button
  - [ ] Filter state management with React hooks or Zustand

- [ ] **Create Risk Badge Component:** `src/components/architecture-review/RiskBadge.tsx`
  - [ ] HIGH: Red badge with 🔴 icon
  - [ ] MEDIUM: Yellow badge with 🟡 icon
  - [ ] LOW: Green badge with 🟢 icon
  - [ ] Reusable across table and modal

---

### 3. ADR Detail Modal Component (AC: #3, #4)

- [ ] **Create ADR Detail Modal:** `src/components/architecture-review/AdrDetailModal.tsx`
  - [ ] Modal overlay (shadcn/ui `Dialog` component or custom)
  - [ ] Header section: Title, status badge, risk badge, confidence score
  - [ ] Content sections with markdown rendering:
    - [ ] Context (collapsible card)
    - [ ] Decision (highlighted card)
    - [ ] Consequences (2-column positive/negative)
    - [ ] Alternatives (expandable list)
  - [ ] Footer action buttons: Approve, Reject, Modify, Defer, Close
  - [ ] Keyboard shortcuts: ESC (close), A (approve), R (reject)

- [ ] **Create Review Action Buttons:** `src/components/architecture-review/ReviewActionButtons.tsx`
  - [ ] Approve button (green, instant action)
  - [ ] Reject button (red, prompts for reason)
  - [ ] Modify button (yellow, prompts for notes)
  - [ ] Defer button (gray, optional reason)
  - [ ] Loading spinner during API call
  - [ ] Success/error Toast notifications

- [ ] **Create Rejection/Modification Prompts:** `src/components/architecture-review/ReviewReasonModal.tsx`
  - [ ] Text area for rejection reason (required, min 10 chars)
  - [ ] Text area for modification notes (required, min 10 chars)
  - [ ] Text area for defer reason (optional)
  - [ ] "Confirm" and "Cancel" buttons
  - [ ] Validation error display

---

### 4. API Integration (AC: All)

- [ ] **Create API Client Functions:** `src/api/architectureReviewApi.ts`
  ```typescript
  export async function getAdrQueue(
    filters: AdrQueueFilters
  ): Promise<AdrQueueResponse> {
    return apiClient.get('/api/v1/architecture-review/queue', { params: filters });
  }

  export async function submitAdrReview(
    adrId: string, 
    action: 'APPROVE' | 'REJECT' | 'MODIFY' | 'DEFER',
    notes?: string
  ): Promise<void> {
    return apiClient.post(`/api/v1/architecture-review/${adrId}/review`, {
      action,
      notes
    });
  }
  ```

- [ ] **TypeScript Types:** `src/types/architectureReview.ts`
  ```typescript
  export interface AdrQueueItem {
    id: string;
    title: string;
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'DEFERRED';
    risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
    confidence: number; // 0.0-1.0
    context: string;
    decision: string;
    consequences: string;
    alternatives: string;
    created_at: string;
    estimated_review_time_minutes: number;
    ticket: {
      id: string;
      title: string;
      clickup_task_id: string;
    };
    execution_id: string;
  }

  export interface AdrQueueFilters {
    risk_level?: 'HIGH' | 'MEDIUM' | 'LOW';
    project_id?: string;
    min_confidence?: number;
    max_confidence?: number;
    sort_by?: 'risk_level' | 'created_at' | 'confidence';
    sort_order?: 'asc' | 'desc';
  }
  ```

- [ ] **React Query Hooks:** `src/hooks/useAdrQueue.ts`
  ```typescript
  export function useAdrQueue(filters: AdrQueueFilters) {
    return useQuery({
      queryKey: ['adrQueue', filters],
      queryFn: () => getAdrQueue(filters),
      staleTime: 30000, // 30s cache
    });
  }

  export function useSubmitAdrReview() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ adrId, action, notes }) => submitAdrReview(adrId, action, notes),
      onSuccess: () => {
        queryClient.invalidateQueries(['adrQueue']); // Refresh queue
        toast.success('ADR review submitted successfully');
      },
      onError: (error) => {
        toast.error(`Failed to submit review: ${error.message}`);
      }
    });
  }
  ```

---

### 5. State Management & URL Params (AC: #2)

- [ ] **Filter State Management:** Use React state or Zustand
  - [ ] Store: `riskLevel`, `projectId`, `minConfidence`, `maxConfidence`, `sortBy`
  - [ ] Sync state with URL query params (React Router or Next.js router)
  - [ ] "Clear Filters" resets to defaults

- [ ] **URL Param Handling:**
  - [ ] Read params on page load: `const [searchParams] = useSearchParams();`
  - [ ] Update URL when filters change: `setSearchParams({ risk: 'HIGH', project: 'abc' })`
  - [ ] Bookmarkable filter states

---

### 6. Testing & Validation (AC: All)

#### Unit Tests (Jest + React Testing Library)

- [ ] `ArchitectureReviewQueuePage.test.tsx`
  - [ ] Test rendering with mock data
  - [ ] Test filter changes update query
  - [ ] Test role guard redirects non-TLs

- [ ] `AdrDetailModal.test.tsx`
  - [ ] Test modal open/close
  - [ ] Test action buttons trigger API calls
  - [ ] Test rejection reason required validation

- [ ] `AdrReviewQueueTable.test.tsx`
  - [ ] Test table rendering with ADRs
  - [ ] Test "Review" button opens modal
  - [ ] Test empty state display

#### E2E Tests (Playwright or Cypress)

- [ ] **Review Workflow:**
  1. Navigate to `/architecture-review/queue`
  2. Click "Review" on first ADR
  3. Click "Approve" button
  4. Verify toast notification
  5. Verify ADR removed from queue

- [ ] **Filter Workflow:**
  1. Select "HIGH" risk filter
  2. Verify only HIGH-risk ADRs displayed
  3. Clear filters
  4. Verify all ADRs displayed again

---

### 7. Documentation & Polish (AC: #6)

- [ ] Update PM Dashboard README with Architecture Review feature
- [ ] Add component Storybook stories (if applicable)
- [ ] Screenshot examples for design review
- [ ] Accessibility audit (keyboard navigation, screen reader testing)

---

## File List

### TO BE CREATED:

**Main Page:**
- `src/pages/ArchitectureReviewQueuePage.tsx` - Main queue page (300-350 LOC)

**Components:**
- `src/components/architecture-review/AdrReviewQueueTable.tsx` - Queue table/grid (150 LOC)
- `src/components/architecture-review/AdrQueueFilters.tsx` - Filter controls (120 LOC)
- `src/components/architecture-review/RiskBadge.tsx` - Risk level badge (30 LOC)
- `src/components/architecture-review/AdrDetailModal.tsx` - ADR detail modal (200 LOC)
- `src/components/architecture-review/ReviewActionButtons.tsx` - Action buttons (100 LOC)
- `src/components/architecture-review/ReviewReasonModal.tsx` - Reason prompt (80 LOC)
- `src/components/architecture-review/AdrQueueCard.tsx` - Mobile card layout (80 LOC)

**API & Types:**
- `src/api/architectureReviewApi.ts` - API client functions (50 LOC)
- `src/types/architectureReview.ts` - TypeScript types (80 LOC)
- `src/hooks/useAdrQueue.ts` - React Query hooks (60 LOC)

### TO BE MODIFIED:

- `src/App.tsx` - Add route for `/architecture-review/queue`
- `src/components/layout/Sidebar.tsx` - Add navigation link with role guard

---

## Technical Notes

### API Endpoints (Story 7-2 Backend)

- `GET /api/v1/architecture-review/queue` ✅ Available
  - Query params: `status`, `risk_level`, `project_id`, `min_confidence`, `max_confidence`, `sort_by`, `sort_order`
  - Response: `{ items: AdrQueueItem[], total: number }`

### Backend Endpoint (Story 7-2 Expansion)

✅ **AVAILABLE:** `POST /api/v1/architecture-review/{adrId}/review`
- Implemented in Story 7-2 expansion (2026-01-01)
- Supports all 4 review actions: APPROVE, REJECT, MODIFY, DEFER
- Validates that only PROPOSED ADRs can be reviewed
  - Request body: `{ action: 'APPROVE'|'REJECT'|'MODIFY'|'DEFER', notes?: string }`
  - Response: `{ success: boolean, message: string }`

### Frontend Repository Context

- **Repo:** `/Volumes/Data/project/products/alpharages/dsf-dashboard`
- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui (Button, Card, Badge, Dialog, Select, Toast)
- **Data Fetching:** React Query or SWR
- **Routing:** React Router v6
- **State:** React Context + hooks (or Zustand for complex state)

### Component Reuse Patterns

**From Financial Metrics (Story 6-R-3-UI):**
- `ExportableDataTable.tsx` → Sortable table pattern
- Badge components → Risk level badges
- Filter controls → Multi-select and range filters

**From Workload Dashboard (Story 5-4-UI):**
- Modal patterns → ADR detail modal
- Loading states → Skeleton loaders
- Error boundaries → Error handling

**From Conversation Intelligence (Story 5.5.2):**
- React Router routing patterns
- React Query data fetching
- Toast notification patterns
- Markdown rendering for AI content

### Known Risks & Considerations

1. **Backend Endpoint Missing:** `POST /api/v1/architecture-review/{adrId}/review`
   - **Mitigation:** Create stub or mock until backend ready (Story 7-4)

2. **Modal Content Length:** ADR content can be very long
   - **Mitigation:** Collapsible sections, scrollable content, markdown rendering

3. **Filter Performance:** Client-side vs server-side filtering
   - **Mitigation:** Backend API supports all filter params

4. **Empty Queue:** No ADRs with status `PROPOSED`
   - **Mitigation:** Empty state with "View All ADRs" link

5. **Mobile UX:** Complex review workflow on small screens
   - **Mitigation:** Bottom sheet modal, larger touch targets

---

## Dev Agent Record

### Agent Model Used

Antigravity (via Create-Story Workflow)

### Debug Log References

N/A

### Completion Notes List

\u003c!-- Dev agent will populate during implementation --\u003e

### File List

\u003c!-- Dev agent will populate during implementation --\u003e

---

## References

- [Story 7-2 Backend API](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-2-tl-architecture-review-queue.md)
- [Story 7-1 ADR Generation](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-1-architecture-decision-records-adr-generation.md)
- [Story 5.5.2 Conversation UI Patterns](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/5-5-2-conversation-intelligence-ui.md)
- [Story 6-R-3-UI Financial Metrics Patterns](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/6-R-3-UI-financial-metrics-dashboard-page.md)
- [Epic 7 Overview](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-7)
- [Architecture.md#TL-Capabilities](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#FR24-FR29)

---
