# Story 7.3-UI: Architecture Risk Visualization

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> [!IMPORTANT]
> **Adversarial Review Completed (2026-01-01)**
> **Result:** ✅ APPROVED WITH REMEDIATION
> **Findings:** 
> - RiskBadge used native `title` instead of Shadcn `Tooltip`. [FIXED]
> - Tooltip integration required dependency installation. [FIXED]

## Story

As a TL,
I want to see the detailed risk factors (Scope, Reversibility, Complexity) for each architecture decision,
So that I understand *why* AI flagged a decision as High Risk without having to dig through the code myself.

## Acceptance Criteria

1. **Given** I am viewing an ADR in the Detail Modal
   **When** I look at the header or context section
   **Then** I see a "Risk Analysis" summary that details:
   - **Scope:** (e.g., "Cross-Module Impact")
   - **Reversibility:** (e.g., "Irreversible / Hard Migration")
   - **Domain Complexity:** (e.g., "High - Security Critical")
   - **Confidence:** (e.g., "75% - Moderate")

2. **And** risk factors are visually distinct:
   - Alert/Warning icons for high-risk specific factors (e.g., "Irreversible" gets a warning icon).
   - Tooltops explain what each factor means.

3. **And** the Queue Table "Risk" badge:
   - Shows a tooltip on hover with a 1-line summary (e.g., "High Risk: Irreversible schema change").

## Tasks / Subtasks

- [x] Task 1: Update Types & API (AC: #1)
  - [x] Update `AdrQueueItem` type in `src/types/architectureReview.ts` to include `risk_factors` (match backend interface).
  - [x] Update mock data/fixtures if used.

- [x] Task 2: Create Risk Analysis Component (AC: #1, #2)
  - [x] Create `RiskAnalysisCard.tsx` or `RiskReasoning.tsx`.
  - [x] Use icons (Lucide React) for factors:
    - Scope: `Box` / `Boxes`
    - Reversibility: `Undo2` (crossed out if irreversible)
    - Complexity: `Brain` / `Activity`
  - [x] Style with alerting colors (Red for high-risk factors).

- [x] Task 3: Integrate into Detail Modal (AC: #1)
  - [x] Add `RiskAnalysisCard` to `AdrDetailModal.tsx` (below Header, above Context).
  - [x] Ensure layout handles missing factors gracefully (backward compatibility).

- [x] Task 4: Update Queue Table Badge (AC: #3)
  - [x] Update `RiskBadge.tsx` to support `Tooltip` (Shadcn UI).
  - [x] passing `risk_factors` summary to the badge.

## Dev Notes

### Dependencies
- **Backend:** Story 7.3 (Risk Assessment) - Provides the `risk_factors` JSON data.
- **Frontend Codebase:** Story 7.2-UI (Existing `AdrDetailModal`).

### Data Structure (Expected from Backend)
```typescript
interface RiskFactors {
  scope: 'single-file' | 'module' | 'cross-module';
  reversibility: 'easy' | 'migration-required' | 'irreversible';
  confidence: number;
  domain_complexity: 'low' | 'medium' | 'high';
}
```

### UX Guidelines
- Don't clutter the view. Use progressive disclosure (Tooltips/Collapsibles) if the analysis is verbose.
- **Red Flags:** Highlight "Irreversible" and "Security" factors prominently.

### File List
- src/types/architectureReview.ts
- src/components/architecture-review/RiskAnalysisCard.tsx
- src/components/architecture-review/AdrDetailModal.tsx
- src/components/architecture-review/RiskBadge.tsx
- src/components/architecture-review/AdrReviewQueueTable.tsx
- src/components/architecture-review/AdrDetailModal.test.tsx
- src/components/architecture-review/AdrReviewQueueTable.test.tsx
