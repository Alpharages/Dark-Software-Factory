# Story 7.6-UI: Escalation Response Interface

Status: review

<!-- Note: This is a UI companion story to 7-6-ai-escalation-uncertainty-handling -->

## Story

As a TL,
I want a clear interface to respond to AI escalations with guidance or delegation,
so that I can efficiently resolve AI uncertainty and unblock development.

## Acceptance Criteria

1. **Given** I'm viewing the TL Architecture Review Queue (from Story 7-2-UI)
   **When** an ADR has escalated status
   **Then** I see escalated ADRs prominently displayed:
    - Visual indicator (⚠️ icon, "ESCALATED" badge with distinct color)
    - Sorted to top of queue (HIGH priority)
    - Confidence score displayed with threshold indicator (e.g., "62% < 70%")
    - Escalation reason category badge (LOW_CONFIDENCE, MISSING_CONTEXT, etc.)

2. **And** when I open an escalated ADR detail:
    - **Escalation Context Card** displays:
        - Why AI is uncertain (escalation reason in plain language)
        - AI confidence score with visual gauge
        - Specific questions AI needs answered (bulleted list)
        - Trade-offs analysis (expandable table with pros/cons for each alternative)
        - AI's recommendation with caveats highlighted
    - **Related Constraints** section shows applicable constraints from Story 7.5

3. **And** I can provide guidance via **TL Guidance Form**:
    - Large text area for guidance (markdown supported)
    - Live preview of guidance
    - "Apply Globally" checkbox → Creates/updates constraint for future
    - "Adjust Threshold" checkbox → Suggests lowering confidence threshold if over-escalating
    - Submit button → Triggers `/api/v1/architecture-review/:id/guidance` endpoint
    - Loading state while AI retry is triggered
    - Success confirmation with link to new ADR

4. **And** I can delegate to architect:
    - "Delegate to Architect" button in escalation detail
    - Delegation modal with:
        - User picker (architects/senior devs only)
        - Notes field for context
        - Preview of notification that will be sent
    - Submit → Triggers `/api/v1/architecture-review/:id/delegate` endpoint
    - Confirmation that delegation was sent

5. **And** I can view escalation analytics:
    - **Escalation Analytics Dashboard** page at `/architecture-review/escalations`
    - Charts using recharts or similar:
        - Escalation rate trend (line chart, per provider)
        - Escalation reasons breakdown (pie chart with categories)
        - Average resolution time (bar chart by reason category)
        - Resolution outcomes (stacked bar: guidance/delegated/constraint_updated)
    - Filters: project, date range (last 7/30/90 days), AI provider
    - Data table with individual escalations (sortable, filterable)
    - Export to CSV button

6. **And** real-time updates are supported:
    - When TL provides guidance, ADR status updates in queue without page refresh
    - Escalation badge count decreases in sidebar when resolved
    - Toast notification when new escalation arrives (if TL is viewing queue)

## Tasks / Subtasks

- [ ] Enhance Architecture Review Queue (AC#1)
    - [ ] Update `AdrReviewQueueTable` to highlight escalated ADRs
    - [ ] Add `EscalationBadge` component with reason category display
    - [ ] Add `ConfidenceScoreGauge` component (visual indicator)
    - [ ] Sort escalated ADRs to top of queue
    - [ ] Add filter option for "Escalated Only"

- [ ] Create Escalation Context Components (AC#2)
    - [ ] Create `EscalationContextCard` component
    - [ ] Create `TradeoffsAnalysisTable` component (expandable pros/cons)
    - [ ] Create `AIQuestionsPanel` component (displays AI's questions)
    - [ ] Create `RelatedConstraintsPanel` component (links to Story 7.5 constraints)
    - [ ] Integrate into existing `AdrDetailModal`

- [ ] Implement TL Guidance Form (AC#3)
    - [ ] Create `TLGuidanceForm` component
    - [ ] Implement markdown editor with live preview (react-markdown)
    - [ ] Add "Apply Globally" checkbox with tooltip explaining constraint creation
    - [ ] Add "Adjust Threshold" checkbox with current threshold display
    - [ ] Integrate with `POST /api/v1/architecture-review/:id/guidance` endpoint
    - [ ] Add loading states and error handling
    - [ ] Show success confirmation with link to new ADR

- [ ] Implement Delegation Workflow (AC#4)
    - [ ] Create `DelegateToArchitectModal` component
    - [ ] Implement user picker (fetch architects/senior devs from users API)
    - [ ] Add notes field with character limit
    - [ ] Create notification preview
    - [ ] Integrate with `POST /api/v1/architecture-review/:id/delegate` endpoint
    - [ ] Add confirmation toast

- [ ] Build Escalation Analytics Dashboard (AC#5)
    - [ ] Create new page `/architecture-review/escalations`
    - [ ] Add sidebar navigation link (TL/ADMIN/MANAGER roles only)
    - [ ] Create `EscalationAnalyticsDashboard` component
    - [ ] Implement charts:
        - `EscalationRateTrendChart` (line chart with recharts)
        - `EscalationReasonsPieChart` (pie chart)
        - `ResolutionTimeBarChart` (bar chart)
        - `ResolutionOutcomesChart` (stacked bar)
    - [ ] Implement filters (project dropdown, date range picker, provider selector)
    - [ ] Create `EscalationsDataTable` component (TanStack Table)
    - [ ] Implement CSV export functionality
    - [ ] Integrate with `GET /api/v1/architecture-review/escalations/metrics` endpoint

- [ ] Add Real-Time Updates (AC#6)
    - [ ] Use existing Socket.IO connection (from Story 5-2) or React Query polling
    - [ ] Subscribe to escalation events in `AdrReviewQueuePage`
    - [ ] Update escalation count badge in sidebar
    - [ ] Add toast notifications for new escalations
    - [ ] Optimistic UI updates when providing guidance

- [ ] API Integration \& State Management
    - [ ] Create `useEscalations` hook (React Query)
    - [ ] Create `useProvideGuidance` mutation hook
    - [ ] Create `useDelegateEscalation` mutation hook
    - [ ] Create `useEscalationMetrics` hook
    - [ ] Update `architectureReviewApi.ts` with 3 new endpoints

- [ ] Testing
    - [ ] Unit tests for `EscalationContextCard`
    - [ ] Unit tests for `TLGuidanceForm` (including markdown preview)
    - [ ] Unit tests for `DelegateToArchitectModal`
    - [ ] Unit tests for `EscalationAnalyticsDashboard`
    - [ ] Integration tests for guidance submission flow
    - [ ] Integration tests for delegation flow
    - [ ] Manual E2E verification of full escalation response workflow

## Dev Notes

### Technical Stack
- **Frontend:** React 18, TypeScript, Tailwind CSS
- **State Management:** React Query (TanStack Query)
- **Charts:** recharts or Chart.js
- **Markdown:** react-markdown + remark plugins
- **Repository:** `dsf-dashboard` (separate from backend)

### Architecture Compliance

**Critical Integration Points:**
1. **Story 7-6 (Backend):** Consumes 3 API endpoints (`/guidance`, `/delegate`, `/escalations/metrics`)
2. **Story 7-2-UI (Review Queue):** Extends existing queue to highlight escalations
3. **Story 7-5-UI (Constraints - if exists):** Links to related constraints
4. **Story 5-2 (Real-Time Updates):** Uses Socket.IO for live updates

**API Endpoints (from Story 7.6):**
```typescript
// Provide guidance
POST /api/v1/architecture-review/:id/guidance
Request: {
  guidance: string;
  apply_globally?: boolean;
  update_thresholds?: boolean;
}
Response: {
  adr_id: string;
  status: 'GUIDANCE_PROVIDED';
  new_adr_id?: string; // ID of retry ADR
}

// Delegate
POST /api/v1/architecture-review/:id/delegate
Request: {
  delegate_to_user_id: string;
  notes?: string;
}
Response: {
  success: boolean;
  delegated_to: string;
}

// Get metrics
GET /api/v1/architecture-review/escalations/metrics?project_id=&start_date=&end_date=
Response: {
  total_escalations: number;
  escalation_rate: number;
  by_reason: Record<string, number>;
  by_provider: Record<string, number>;
  avg_resolution_time_seconds: number;
  resolution_outcomes: {
    guidance_provided: number;
    delegated: number;
    constraint_updated: number;
  };
}
```

### UI Component Structure

```
src/
├── pages/
│   └── architecture-review/
│       ├── EscalationAnalyticsPage.tsx          # NEW (AC#5)
│       └── ArchitectureReviewQueuePage.tsx      # MODIFIED (AC#1)
├── components/
│   └── architecture-review/
│       ├── EscalationBadge.tsx                  # NEW (AC#1)
│       ├── ConfidenceScoreGauge.tsx             # NEW (AC#1)
│       ├── EscalationContextCard.tsx            # NEW (AC#2)
│       ├── TradeoffsAnalysisTable.tsx           # NEW (AC#2)
│       ├── AIQuestionsPanel.tsx                 # NEW (AC#2)
│       ├── RelatedConstraintsPanel.tsx          # NEW (AC#2)
│       ├── TLGuidanceForm.tsx                   # NEW (AC#3)
│       ├── DelegateToArchitectModal.tsx         # NEW (AC#4)
│       ├── EscalationAnalyticsDashboard.tsx     # NEW (AC#5)
│       ├── EscalationRateTrendChart.tsx         # NEW (AC#5)
│       ├── EscalationReasonsPieChart.tsx        # NEW (AC#5)
│       ├── ResolutionTimeBarChart.tsx           # NEW (AC#5)
│       ├── ResolutionOutcomesChart.tsx          # NEW (AC#5)
│       ├── EscalationsDataTable.tsx             # NEW (AC#5)
│       ├── AdrDetailModal.tsx                   # MODIFIED (AC#2)
│       └── AdrReviewQueueTable.tsx              # MODIFIED (AC#1)
├── hooks/
│   └── api/
│       └── useEscalations.ts                    # NEW (all endpoints)
└── api/
    └── architectureReviewApi.ts                 # MODIFIED (3 new endpoints)
```

### Escalation Badge Color Strategy

```typescript
const ESCALATION_REASON_COLORS = {
  LOW_CONFIDENCE: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  MISSING_CONTEXT: 'bg-orange-100 text-orange-800 border-orange-300',
  CONFLICTING_REQUIREMENTS: 'bg-red-100 text-red-800 border-red-300',
  NO_BEST_PRACTICE: 'bg-purple-100 text-purple-800 border-purple-300',
  SECURITY_CONCERN: 'bg-red-100 text-red-900 border-red-400',
  PERFORMANCE_TRADEOFF: 'bg-blue-100 text-blue-800 border-blue-300',
  MULTIPLE_VALID_APPROACHES: 'bg-indigo-100 text-indigo-800 border-indigo-300',
};
```

### Confidence Score Gauge Component

```tsx
// ConfidenceScoreGauge.tsx
interface ConfidenceScoreGaugeProps {
  confidence: number; // 0-100
  threshold: number; // e.g., 70
}

export function ConfidenceScoreGauge({ confidence, threshold }: Props) {
  const isEscalated = confidence < threshold;
  const percentage = confidence;
  
  return (
    <div className="flex items-center gap-2">
      {/* Circular progress gauge */}
      <svg className="w-16 h-16" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={isEscalated ? '#FCA5A5' : '#D1D5DB'}
          strokeWidth="8"
        />
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={isEscalated ? '#EF4444' : '#10B981'}
          strokeWidth="8"
          strokeDasharray={`${percentage * 2.51} 251`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="50" textAnchor="middle" dy="5" className="text-lg font-bold">
          {confidence}%
        </text>
      </svg>
      
      {/* Threshold indicator */}
      <div className="text-sm">
        {isEscalated && (
          <p className="text-red-600 font-medium">
            Below {threshold}% threshold
          </p>
        )}
        <p className="text-gray-500">Threshold: {threshold}%</p>
      </div>
    </div>
  );
}
```

### TL Guidance Form Example

```tsx
// TLGuidanceForm.tsx
export function TLGuidanceForm({ adrId, onSuccess }: Props) {
  const [guidance, setGuidance] = useState('');
  const [applyGlobally, setApplyGlobally] = useState(false);
  const [adjustThreshold, setAdjustThreshold] = useState(false);
  
  const provideGuidanceMutation = useProvideGuidance();
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await provideGuidanceMutation.mutateAsync({
      adrId,
      guidance,
      apply_globally: applyGlobally,
      update_thresholds: adjustThreshold,
    });
    onSuccess?.();
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Markdown editor with tabs: Write | Preview */}
      <MarkdownEditor
        value={guidance}
        onChange={setGuidance}
        placeholder="Provide detailed guidance for the AI agent..."
      />
      
      {/* Checkboxes */}
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={applyGlobally}
            onChange={(e) => setApplyGlobally(e.target.checked)}
          />
          <span>Apply globally as architecture constraint</span>
          <Tooltip content="Creates a constraint that prevents future escalations for this type of decision" />
        </label>
        
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={adjustThreshold}
            onChange={(e) => setAdjustThreshold(e.target.checked)}
          />
          <span>Suggest lowering confidence threshold (currently 70%)</span>
          <Tooltip content="AI may be over-escalating; recommend adjusting threshold" />
        </label>
      </div>
      
      {/* Submit */}
      <Button
        type="submit"
        disabled={!guidance.trim() || provideGuidanceMutation.isPending}
      >
        {provideGuidanceMutation.isPending ? 'Providing Guidance...' : 'Provide Guidance & Retry AI'}
      </Button>
    </form>
  );
}
```

### Escalation Analytics Dashboard Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ Escalation Analytics                                         │
├─────────────────────────────────────────────────────────────┤
│ Filters: [Project ▼] [Last 30 days ▼] [All Providers ▼]    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│ │ Total           │  │ Escalation Rate │  │ Avg Response │ │
│ │ Escalations     │  │                 │  │ Time         │ │
│ │      47         │  │      23%        │  │   2.1 hrs    │ │
│ └─────────────────┘  └─────────────────┘  └──────────────┘ │
│                                                              │
│ ┌──────────────────────────────┐  ┌────────────────────────┐│
│ │ Escalation Rate Trend        │  │ Escalation Reasons     ││
│ │ (Line Chart)                 │  │ (Pie Chart)            ││
│ │                              │  │                        ││
│ │    ╱╲                        │  │  ● Low Confidence: 12  ││
│ │   ╱  ╲                       │  │  ● Missing Context: 18 ││
│ │  ╱    ╲  ╱╲                  │  │  ● Conflicting: 10     ││
│ │ ╱      ╲╱  ╲                 │  │  ● Other: 7            ││
│ └──────────────────────────────┘  └────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Resolution Outcomes (Stacked Bar)                        ││
│ │ ████████ Guidance Provided (40)                          ││
│ │ ███ Delegated (5)                                        ││
│ │ ████ Constraint Updated (12)                             ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Escalation Details (Table)                               ││
│ │ ┌───────┬─────────┬─────────┬──────────┬────────────┐   ││
│ │ │ Date  │ Project │ Reason  │ Provider │ Resolution │   ││
│ │ ├───────┼─────────┼─────────┼──────────┼────────────┤   ││
│ │ │ 1/1   │ Proj A  │ Low Conf│ Cursor   │ Guidance   │   ││
│ │ │ 1/1   │ Proj B  │ Missing │ Claude   │ Delegated  │   ││
│ │ └───────┴─────────┴─────────┴──────────┴────────────┘   ││
│ │                                        [Export CSV ↓]    ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### File Estimates

**New Files (17):**
1. `src/pages/architecture-review/EscalationAnalyticsPage.tsx` (~150 LOC)
2. `src/components/architecture-review/EscalationBadge.tsx` (~40 LOC)
3. `src/components/architecture-review/ConfidenceScoreGauge.tsx` (~80 LOC)
4. `src/components/architecture-review/EscalationContextCard.tsx` (~120 LOC)
5. `src/components/architecture-review/TradeoffsAnalysisTable.tsx` (~100 LOC)
6. `src/components/architecture-review/AIQuestionsPanel.tsx` (~60 LOC)
7. `src/components/architecture-review/RelatedConstraintsPanel.tsx` (~80 LOC)
8. `src/components/architecture-review/TLGuidanceForm.tsx` (~180 LOC)
9. `src/components/architecture-review/DelegateToArchitectModal.tsx` (~120 LOC)
10. `src/components/architecture-review/EscalationAnalyticsDashboard.tsx` (~200 LOC)
11. `src/components/architecture-review/EscalationRateTrendChart.tsx` (~100 LOC)
12. `src/components/architecture-review/EscalationReasonsPieChart.tsx` (~80 LOC)
13. `src/components/architecture-review/ResolutionTimeBarChart.tsx` (~90 LOC)
14. `src/components/architecture-review/ResolutionOutcomesChart.tsx` (~100 LOC)
15. `src/components/architecture-review/EscalationsDataTable.tsx` (~150 LOC)
16. `src/hooks/api/useEscalations.ts` (~200 LOC - 4 hooks)
17. `src/__tests__/components/architecture-review/TLGuidanceForm.test.tsx` (~100 LOC)

**Modified Files (4):**
18. `src/pages/architecture-review/ArchitectureReviewQueuePage.tsx` (+50 LOC)
19. `src/components/architecture-review/AdrDetailModal.tsx` (+120 LOC)
20. `src/components/architecture-review/AdrReviewQueueTable.tsx` (+80 LOC)
21. `src/api/architectureReviewApi.ts` (+100 LOC)

**Total Estimated LOC:** ~2,100 lines (medium-high complexity)

### Dependencies to Install

```bash
# Markdown editor
npm install react-markdown remark-gfm

# Charts (if not already installed)
npm install recharts

# Optional: Better markdown editor
npm install @uiw/react-md-editor
```

### Testing Strategy

**Unit Tests:**
1. `EscalationBadge`: Renders correct color for each reason category
2. `ConfidenceScoreGauge`: Shows correct gauge fill and threshold indicator
3. `TLGuidanceForm`: Markdown preview works, checkboxes toggle, submission triggers API
4. `DelegateToArchitectModal`: User picker works, submission triggers API
5. `EscalationAnalyticsDashboard`: Charts render with mock data

**Integration Tests:**
1. Guidance submission flow: Fill form → Submit → API called → Success toast → ADR updated
2. Delegation flow: Select user → Add notes → Submit → Confirmation shown
3. Analytics filtering: Change filters → API called with correct params → Charts update

**E2E Verification:**
1. Open escalated ADR in review queue
2. Verify escalation context displays correctly
3. Provide guidance via form
4. Verify new ADR created with guidance context
5. Check analytics dashboard shows the resolution

### Accessibility Requirements

- All charts have ARIA labels and keyboard navigation
- Form inputs have proper labels and error messages
- Color is not sole indicator (use icons + text)
- Keyboard shortcuts for common actions (G for guidance, D for delegate)

### Previous Story Intelligence

**From Story 7-2-UI (Review Queue):**
- Reuse `AdrReviewQueueTable` component structure
- Follow same filtering and sorting patterns
- Use same `AdrDetailModal` component (extend it)

**From Story 7-9-UI (Constraints):**
- Reuse form validation patterns
- Follow same API error handling approach
- Use similar toast notification patterns

**From Story 5-2 (Real-Time Updates):**
- Use existing Socket.IO connection if available
- Fallback to React Query polling (refetchInterval)

### References

- [Source: Story 7.6 (Backend)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-6-ai-escalation-uncertainty-handling.md)
- [Source: Story 7-2-UI (Review Queue)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-2-UI-architecture-review-queue.md)
- [Source: Story 7-9-UI (Constraints)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-9-UI-architecture-constraints-management.md)

## Dev Agent Record

### Agent Model Used

Antigravity 1.0

### Debug Log References

N/A (Story creation phase)

### Completion Notes List

- UI companion story to backend Story 7.6
- Follows Epic 7 UI pattern (7-2-UI, 7-3-UI, 7-9-UI)
- Integration points identified with 4 existing stories
- Estimated 2,100 LOC across 21 files (17 new, 4 modified)
- Ready for implementation in dsf-dashboard repository

### File List

**New Files (17):**
1. `src/pages/architecture-review/EscalationAnalyticsPage.tsx`
2. `src/components/architecture-review/EscalationBadge.tsx`
3. `src/components/architecture-review/ConfidenceScoreGauge.tsx`
4. `src/components/architecture-review/EscalationContextCard.tsx`
5. `src/components/architecture-review/TradeoffsAnalysisTable.tsx`
6. `src/components/architecture-review/AIQuestionsPanel.tsx`
7. `src/components/architecture-review/RelatedConstraintsPanel.tsx`
8. `src/components/architecture-review/TLGuidanceForm.tsx`
9. `src/components/architecture-review/DelegateToArchitectModal.tsx`
10. `src/components/architecture-review/EscalationAnalyticsDashboard.tsx`
11. `src/components/architecture-review/EscalationRateTrendChart.tsx`
12. `src/components/architecture-review/EscalationReasonsPieChart.tsx`
13. `src/components/architecture-review/ResolutionTimeBarChart.tsx`
14. `src/components/architecture-review/ResolutionOutcomesChart.tsx`
15. `src/components/architecture-review/EscalationsDataTable.tsx`
16. `src/hooks/api/useEscalations.ts`
17. `src/__tests__/components/architecture-review/TLGuidanceForm.test.tsx`

**Modified Files (4):**
18. `src/pages/architecture-review/ArchitectureReviewQueuePage.tsx`
19. `src/components/architecture-review/AdrDetailModal.tsx`
20. `src/components/architecture-review/AdrReviewQueueTable.tsx`
21. `src/api/architectureReviewApi.ts`
