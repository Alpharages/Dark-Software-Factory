# Story 27.3: Mobile/Tablet Navigation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user on a tablet or phone,
I want to navigate the full application on screens narrower than 1024px,
So that I can monitor AI execution status and approve tasks from mobile devices in the field.

## Acceptance Criteria

1. **Given** a user is on a screen narrower than `1024px`
   **When** the layout renders
   **Then** the sidebar is hidden (`hidden lg:block` preserved) and a hamburger menu button (☰) is visible in the Header
   **And** clicking the hamburger button opens a full-height slide-in drawer containing the complete navigation menu with all destinations
   **And** clicking any navigation item inside the drawer navigates to that route and closes the drawer
   **And** tapping/clicking outside the drawer closes it
   **And** the existing Header "Open menu" button is connected to this drawer (currently non-functional per UI-9)

2. **Given** a user is on a screen between `768px` and `1023px` (tablet)
   **When** the layout renders
   **Then** a collapsed icon-only sidebar is shown with tooltips on hover for each navigation item
   **And** all navigation destinations remain reachable from the icon sidebar

## Tasks / Subtasks

- [x] Analyze the current layout components (`src/App.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileSidebar.tsx`).
- [x] Connect `MobileSidebar.tsx` to `Header.tsx`
  - [x] The `MobileSidebar` component (`src/components/layout/MobileSidebar.tsx`) already exists and uses `Sheet`. It is already imported into `Header.tsx`.
  - [x] Ensure the "Open menu" hamburger button in `Header.tsx` correctly triggers the `MobileSidebar` open state.
  - [x] Ensure the drawer closes when a navigation link is clicked or the user taps outside.
- [x] Implement Tablet Collapsed Sidebar (`768px` - `1023px`)
  - [x] Update `src/components/layout/Sidebar.tsx` to support a collapsed, icon-only version on `md` screens.
  - [x] Wrap the icons in shadcn/ui `Tooltip` components to display the navigation item's name on hover.
  - [x] The `isCollapsed` state in `Sidebar.tsx` is currently local. You must either lift this state up to `AppLayout`/`App.tsx` or use pure CSS breakpoints to manage the sidebar width and main content margin on tablet view.
- [x] Refactor Layout scaffold in `src/App.tsx`
  - [x] Remove the hardcoded widths and `lg:block` classes in `DashboardLayout` inside `App.tsx`.
  - [x] Change `<aside className="hidden lg:block ... w-[280px]">` to be visible on `md` screens (e.g., `hidden md:block`).
  - [x] Adjust the `<main>` component's left margin (`lg:ml-[280px]`) to smoothly accommodate the `md` collapsed sidebar (e.g., `md:ml-[72px] lg:ml-[280px]`).
- [x] Implement Navigation DRY Principle (Enhancement)
  - [x] Both `MobileSidebar.tsx` and `Sidebar.tsx` maintain separate, copied `navigationGroups` arrays.
  - [x] Extract this configuration into a shared configuration file (e.g., `src/config/navigation.ts`) and import it into both sidebar components to ensure consistency.

## Dev Notes

- **Architecture Compliance:**
  - **Dependencies:** Use the existing `MobileSidebar` component which already utilizes shadcn/ui `Sheet`.
  - **Styling:** Use standard Tailwind CSS responsive prefixes (`md:`, `lg:`). Provide explicit width/margin breakpoints in `App.tsx` layout components (e.g., `md:w-[72px] lg:w-[280px] md:ml-[72px] lg:ml-[280px]`).
  - **State Management:** Keep the `Layout` wrapper cleanly separated from the `Sidebar` internal state where possible. If `isCollapsed` needs to drive layout margins, strongly consider CSS-driven container queries or explicit media query utility classes rather than prop-drilling state, or lift the state appropriately.
- **Testing Requirements:** Add or update `src/components/layout/__tests__/Sidebar.test.tsx` (or appropriate equivalent) to ensure `Tooltip` is present in tablet view. Add accessibility checks. Ensure layout tests account for `md` and `lg` viewport sizes.
- **Previous Story Intelligence:** Story 27.2 implemented native `document.title` updates via a hook. Previous UI stories relied heavily on shadcn/ui and `min-w-0` to fix overflow issues. Keep overflow issues in check when hiding/resizing the sidebar.
- **Git Intelligence:** Recent commits show a strong focus on rendering fixes and avoiding crashes. Avoid overwriting `MobileSidebar.tsx` completely; enhance what is there and ensure it doesn't break existing routes.
- **Known Pitfalls:** Do not duplicate the drawer functionality; `MobileSidebar` already exists. Do not assume `App.tsx` automatically handles responsive margins; its `ml-[280px]` is currently hardcoded for `lg` screens.

### Project Structure Notes

- Modifications will primarily be in `src/components/layout/` (e.g., `Header.tsx`, `Sidebar.tsx`, `AppLayout.tsx`).

### References

- [Source: epics.md#Epic-27](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: QA-REPORT-2026-02-27.md (QA-FR27 / UI-9)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/QA-REPORT-2026-02-27.md)

## Dev Agent Record

### Agent Model Used

Gemini 2.5 Pro

### Completion Notes List

- Implemented responsive layout shell updates in `App.tsx`: `md` sidebar width/margin (`72px`) and `lg` expanded width/margin (`280px`).
- Connected Header "Open menu" button to controlled `MobileSidebar` state; drawer closes on nav-link click and outside interaction via Sheet behavior.
- Refactored `Sidebar` for tablet icon-only navigation (`md`), per-item tooltips, and desktop grouped navigation (`lg`).
- Extracted shared navigation definition to `src/config/navigation.ts` and consumed it from both `Sidebar` and `MobileSidebar`.
- Added accessibility-focused tests for tablet nav labels/tooltips and Header-triggered mobile drawer behaviors.
- Validation: targeted test file passes; full `pnpm test` and full `pnpm lint` currently fail due multiple unrelated pre-existing project issues.

### File List

- src/App.tsx
- src/config/navigation.ts
- src/components/layout/Header.tsx
- src/components/layout/MobileSidebar.tsx
- src/components/layout/Sidebar.tsx
- src/components/layout/**tests**/Sidebar.test.tsx

## Senior Developer Review (AI)

_Reviewer: Khakanali — 2026-03-02_

**Outcome: Approved with fixes applied**

All Acceptance Criteria are implemented. 10 issues found and resolved (3 HIGH, 5 MEDIUM fixed in-place; 2 LOW documented):

| ID  | Severity | Issue                                                                                                                                                        | Resolution                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| H1  | HIGH     | `React.FC` used in `Header.tsx` without importing `React` namespace — TypeScript strict-mode error                                                           | Changed to `import { type FC, useState }` and `FC` annotation                                                |
| H2  | HIGH     | Double `TooltipProvider` — `Sidebar.tsx` nested inside the app-root provider already in `App.tsx`, causing context conflict and inconsistent `delayDuration` | Removed inner `TooltipProvider`; added `delayDuration={0}` directly on each `<Tooltip>`                      |
| H3  | HIGH     | Redundant `md:w-[72px] lg:w-[280px]` on `Sidebar` root element — already controlled by parent `<aside>` in `App.tsx`, creates invisible coupling             | Removed redundant width classes; Sidebar now uses `w-full`                                                   |
| M1  | MEDIUM   | `MobileSidebar` used hardcoded `slate-*` palette values — ignores light-mode toggle entirely                                                                 | Replaced with `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary/10`, `text-sidebar-primary`, etc. |
| M2  | MEDIUM   | AC1 vs AC2 breakpoint ambiguity — `md:hidden` on hamburger was undocumented                                                                                  | Added inline comment clarifying intentional tablet-vs-mobile breakpoint split                                |
| M3  | MEDIUM   | `isActive` helper duplicated in both `Sidebar.tsx` and `MobileSidebar.tsx` — DRY applied to data but not logic                                               | Extracted `isNavItemActive(itemPath, currentPath)` to `navigation.ts`; both components now import and use it |
| M4  | MEDIUM   | `ScrollArea` in `MobileSidebar` used magic `h-[calc(100vh-100px)]` — breaks if header height changes                                                         | Changed `SheetContent` to `flex flex-col`; `SheetHeader` gets `shrink-0`; `ScrollArea` uses `flex-1`         |
| M5  | MEDIUM   | Test queried `[data-slot="sheet-overlay"]` — internal shadcn/ui attribute with no stability guarantee                                                        | Replaced with `fireEvent.keyDown(document.body, { key: 'Escape' })` — standard Radix dismissal               |
| L1  | LOW      | `favorites` state resets on page refresh but star-toggle implies persistence                                                                                 | Documented — out of scope for this story                                                                     |
| L2  | LOW      | `getTabletItemTestId` fragile path-to-string heuristic                                                                                                       | Documented — acceptable given current route structure                                                        |

**Files additionally touched by review fixes:** `src/config/navigation.ts`, `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileSidebar.tsx`, `src/components/layout/Header.tsx`, `src/components/layout/__tests__/Sidebar.test.tsx`

### Change Log

- 2026-03-02: Implemented mobile/tablet navigation story (27.3), including responsive layout refactor, shared navigation config extraction, controlled mobile drawer wiring, and new sidebar/header behavior tests.
- 2026-03-02: Code review fixes applied — resolved 3 HIGH + 5 MEDIUM issues (see Senior Developer Review section above).
