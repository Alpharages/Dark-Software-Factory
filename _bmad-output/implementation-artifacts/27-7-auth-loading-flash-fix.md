# Story 27.7: Auth Loading Flash & Race Condition Fix

Status: COMPLETED
Last Updated: 2026-03-03

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any user,
I want authentication checks to complete silently on initial page load,
so that I never see a jarring full-screen loading spinner on first visit and no premature 401 errors appear in the backend logs.

## Acceptance Criteria

1. **Given** a user performs an initial cold load or hard refresh of the app
   **When** `AppContent` evaluates `isLoading = true` during the `GET /auth/me` check
   **Then** `AppContent` renders `null` (transparent, invisible) instead of the full-screen `"Checking authentication…"` spinner
   **And** no full-screen loading flash is visible on initial load for already-authenticated users
   **And** note: `isLoading` does NOT re-trigger on page-to-page navigation or background token refresh — the flash is exclusively an initial cold-load artifact

2. **Given** any data-fetching component mounts (including those in `Header`/`DashboardLayout` which render OUTSIDE `ProtectedRoute`)
   **When** the component's React Query hook activates
   **Then** all data-fetching hooks use `enabled: !!user` to ensure API calls only fire after the user object is confirmed non-null
   **And** hooks with `refetchInterval` stop polling automatically when `enabled` is `false` (user is null)
   **And** the backend logs show zero `401 Authentication required` errors caused by components mounting before the auth check completes
   **And** the existing intentional 401 errors (unauthenticated access attempts) are unaffected

## Tasks / Subtasks

- [x] Fix `AppContent` auth loading flash in `src/App.tsx` (AC: 1)
  - [x] Replace the full-screen `<Loader2>` spinner block (lines 125–134) with `return null`
  - [x] Remove the now-unused `Loader2` import from `lucide-react` (check if used elsewhere in the file first)

- [x] Clean up dead `isLoading` code in `src/components/auth/ProtectedRoute.tsx` (AC: 1)
  - [x] Remove the `isLoading` spinner block (lines 28–37) — this is dead code since `AppContent` already gates route rendering behind the `isLoading` check. Replace with `return null` or remove entirely.
  - [x] Remove the now-unused `Loader2` import from `lucide-react` if no longer needed

- [x] Add `enabled: !!user` guard to `src/hooks/useApprovals.ts` (AC: 2)
  - [x] ⚠️ NESTED HOOK STRUCTURE: `useApprovalQueue`, `useApprovalDetail`, and `useApprovalSummary` are closures defined INSIDE `useApprovals()`, not standalone exports. Call `useAuth()` ONCE at the top of `useApprovals()` and capture `user` via closure.
  - [x] Import `useAuth` from `../contexts/AuthContext` at the top of the file
  - [x] Add `const { user } = useAuth()` at the top of `useApprovals()` body (after `useQueryClient()`)
  - [x] In `useApprovalQueue` closure: add `enabled: !!user`
  - [x] In `useApprovalSummary` closure: add `enabled: !!user`
  - [x] In `useApprovalDetail` closure: change `enabled: !!executionId` → `enabled: !!executionId && !!user`

- [x] Add `enabled: !!user` guard to `src/hooks/queries/useNotifications.ts` (AC: 2) — **HIGHEST PRIORITY**
  - [x] ⚠️ These hooks are called by `NotificationCenter` which renders inside `Header.tsx` → `DashboardLayout` — OUTSIDE `ProtectedRoute`. They can fire even for unauthenticated users before redirect.
  - [x] Add `const { user } = useAuth()` and `enabled: !!user` to `useNotificationPreferences`
  - [x] Add `const { user } = useAuth()` and `enabled: !!user` to `useInAppNotifications` — this hook also has `refetchInterval: 300_000` (5 min polling); `enabled: false` will pause polling automatically
  - [x] Add `const { user } = useAuth()` and `enabled: !!user` to `useUnreadNotificationCount` — same 5 min polling; same pause behavior

- [x] Add `enabled: !!user` guard to `src/hooks/queries/useExecutions.ts` (AC: 2)
  - [x] Add `enabled: !!user` to `useActiveExecutions` (refetchInterval hook — highest risk)
  - [x] For hooks that already have `enabled: !!executionId`, combine: `enabled: !!executionId && !!user`

- [x] Add `enabled: !!user` guard to `src/hooks/useQaReview.ts` (AC: 2)
  - [x] Add `enabled: !!user` to `useQueue`
  - [x] Add `enabled: !!user` to `useWorkloadSummary`

- [x] Add `enabled: !!user` guard to `src/hooks/queries/useSystemConfig.ts` (AC: 2)
  - [x] Add `enabled: !!user` to the primary `useQuery` call inside the hook

- [x] Tests — all are NEW tests (no existing ProtectedRoute or AppContent tests exist)
  - [x] Create `src/__tests__/AppContent.test.tsx`: assert `null` is rendered (container is empty, no spinner text) when `useAuth` returns `{ isLoading: true }` — use MemoryRouter + mock `useAuth`
  - [x] Create `src/components/auth/__tests__/ProtectedRoute.test.tsx` (new file — none exists): assert no spinner is rendered when `auth.isLoading = true`; assert redirect to `/login` when `isAuthenticated = false`; assert children render when authenticated
  - [x] Add hook guard test: render `useApprovals` in a test component with `useAuth` mocked to return `{ user: null }`, assert no network requests are made (mock `apiClient`); then re-render with `user` set, assert requests fire
- [x] Initialize story 27-7-auth-loading-flash-fix
  - [x] Create dedicated task file [x]
  - [x] Mark story as in-progress in sprint-status.yaml [x]
- [x] Research & Planning
  - [x] Analyze current auth flash mechanism in App.tsx [x]
  - [x] Identify hooks requiring enabled: !!user guards [x]
- [x] Implementation
  - [x] Modify App.tsx to return null during loading [x]
  - [x] Remove dead isLoading spinner from ProtectedRoute.tsx [x]
  - [x] Add enabled: !!user guards to Approval hooks [x]
  - [x] Add enabled: !!user guards to Notification hooks [x]
  - [x] Add enabled: !!user guards to Execution hooks [x]
  - [x] Add enabled: !!user guards to System Config hook [x]
  - [x] Add enabled: !!user guards to QA Review hooks [x]
- [x] Verification
  - [x] Create unit tests for AppContent loading state [x]
  - [x] Create unit tests for ProtectedRoute loading state [x]
  - [x] Create hook tests for auth guards [x]
  - [x] Verify no 401 errors are thrown during initial cold load [x]
- [x] Completion
  - [x] Update story file tasks and status [x]
  - [x] Mark story as done in sprint-status.yaml [x]

## Dev Notes

### Root Cause Analysis

**Part 1 — Visual flash (initial cold load only):**
`isLoading` initializes to `true` in `AuthContext` (line 76) and is set to `false` only after `GET /auth/me` resolves. It is NOT re-set to `true` during background token refresh (confirmed: `refreshTokenInternal` never touches `isLoading`). The only other time it re-triggers is during the active `login()` form submission — irrelevant here. Fix: replace the full-screen spinner in `AppContent` (lines 125–134) with `return null`.

**Part 2 — Premature API calls producing 401s:**
`QueryClientProvider` is mounted inside the `isLoading` gate (line 137 `App.tsx`), so hooks can't fire while `isLoading === true`. The race is at the transition boundary: `setUser(userData)` and `setIsLoading(false)` are separate async calls in `checkAuth()` — React 18 auto-batches them, but the `enabled: !!user` guard makes the behavior explicit and eliminates the risk. More critically, `NotificationCenter` (called from `Header.tsx` inside `DashboardLayout`) renders OUTSIDE `ProtectedRoute`, meaning its hooks fire even for unauthenticated users who are about to be redirected.

### Architecture & Constraints

- **Do NOT move `QueryClientProvider`**: It lives inside `AppContent` for a reason — all query state is intentionally scoped to post-auth. Do not hoist it outside the auth context boundary.
- **Do NOT change `isLoading` initialization**: `isLoading` starts as `true` in `AuthContext.tsx` intentionally to suppress the login-page flash during cold load. Leave it as-is.
- **`ProtectedRoute` isLoading block is dead code**: Since `AppContent` returns early while `isLoading === true`, `ProtectedRoute` is never rendered during loading. The `isLoading` check on lines 28–37 of `ProtectedRoute.tsx` is unreachable and should be removed.
- **Combining `enabled` conditions**: For hooks that already have `enabled: !!someId`, combine logically: `enabled: !!someId && !!user`. Do not replace — add the conjunction.
- **`refetchInterval` + `enabled: false`**: When `enabled` is `false`, React Query automatically pauses polling intervals too. No separate interval management is needed — this is the correct behavior for all three polling hooks (`useApprovalQueue`, `useApprovalSummary`, `useActiveExecutions` at 30s; `useInAppNotifications`, `useUnreadNotificationCount` at 5min).
- **`useAuth()` import path**: Use `@/contexts/AuthContext` or the relative path matching the existing imports in each hook file (check the file first — some use `../contexts/AuthContext`, others `../../contexts/AuthContext`).

### Current Code: What to Change

**`src/App.tsx` (PRIMARY CHANGE — lines 124–134):**

```tsx
// BEFORE (remove this block):
if (isLoading) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground mt-4">Checking authentication...</p>
      </div>
    </div>
  );
}

// AFTER (replace with):
if (isLoading) {
  return null;
}
```

Also remove `Loader2` from line 11 import if it has no other uses in `App.tsx`.

**`src/components/auth/ProtectedRoute.tsx` (DEAD CODE REMOVAL — lines 28–37):**

```tsx
// BEFORE (remove this block):
if (auth.isLoading) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
        <p className="text-slate-400 mt-4">Checking authentication...</p>
      </div>
    </div>
  );
}

// AFTER:
// Remove entirely. No replacement needed.
// Also remove Loader2 import if unused.
```

**`useApprovals.ts` — nested closure pattern (ACTUAL file structure):**

```tsx
// BEFORE:
export const useApprovals = () => {
  const queryClient = useQueryClient();

  const useApprovalQueue = () => {
    return useQuery({ queryKey: [...], queryFn: ..., refetchInterval: 30000 });
  };
  const useApprovalDetail = (executionId: string | null) => {
    return useQuery({ ..., enabled: !!executionId });
  };
  const useApprovalSummary = () => {
    return useQuery({ queryKey: [...], queryFn: ..., refetchInterval: 30000 });
  };
  return { useApprovalQueue, useApprovalDetail, useApprovalSummary, useSubmitDecision };
};

// AFTER — call useAuth() ONCE at top, captured by all closures:
export const useApprovals = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth(); // ← add here, ONE call for all nested hooks

  const useApprovalQueue = () => {
    return useQuery({ ..., refetchInterval: 30000, enabled: !!user }); // ← add
  };
  const useApprovalDetail = (executionId: string | null) => {
    return useQuery({ ..., enabled: !!executionId && !!user }); // ← conjunction
  };
  const useApprovalSummary = () => {
    return useQuery({ ..., refetchInterval: 30000, enabled: !!user }); // ← add
  };
  return { useApprovalQueue, useApprovalDetail, useApprovalSummary, useSubmitDecision };
};
```

**Hook fix pattern for standalone hooks (all other files):**

```tsx
// BEFORE:
export function useActiveExecutions(filters?, options?) {
  return useQuery({ queryKey: [...], queryFn: ..., refetchInterval: 30 * 1000 });
}

// AFTER:
export function useActiveExecutions(filters?, options?) {
  const { user } = useAuth();
  return useQuery({ ..., refetchInterval: 30 * 1000, enabled: !!user, ...options });
}
```

### Project Structure Notes

- **Primary change:** `src/App.tsx` — `AppContent` function, lines 124–134
- **Secondary cleanup:** `src/components/auth/ProtectedRoute.tsx` — lines 28–37
- **Hook files to update (6 files):**
  - `src/hooks/useApprovals.ts` — nested closure pattern; add `useAuth()` at top of `useApprovals()`, add `enabled: !!user` to `useApprovalQueue` + `useApprovalSummary`, combine to `enabled: !!executionId && !!user` in `useApprovalDetail`
  - `src/hooks/queries/useNotifications.ts` — **highest priority** (called from `NotificationCenter` which is OUTSIDE `ProtectedRoute`); add `enabled: !!user` to `useNotificationPreferences`, `useInAppNotifications`, `useUnreadNotificationCount`
  - `src/hooks/queries/useExecutions.ts` — `useActiveExecutions` (and conjoin on `useExecution`, `useExecutionLogs` where `enabled: !!id` already exists)
  - `src/hooks/useQaReview.ts` — `useQueue`, `useWorkloadSummary`
  - `src/hooks/queries/useSystemConfig.ts` — main query
- **Reference component:** `src/components/notifications/NotificationCenter.tsx` — renders `useInAppNotifications` + `useUnreadNotificationCount`; called by `Header.tsx` outside `ProtectedRoute`; no changes needed here (hook fix is sufficient)
- **No backend changes required**
- **No new components, routes, or API endpoints**
- **No migrations, schema changes, or environment variable changes**

### Previous Story Intelligence (27-6 not yet created; context from 27-5)

From story 27-5 dev pattern:

- Navigation config is shared via `src/config/navigation.ts` — do not duplicate in component files
- `useAuth()` is available from `@/contexts` (re-exported barrel) or directly from `@/contexts/AuthContext`
- Lucide icons: always check if an icon is used elsewhere in a file before removing its import
- Tests live in `src/components/layout/__tests__/` for layout components; for hooks, test in their corresponding `__tests__/` or inline

### Git Intelligence

Recent commits confirm the project structure and patterns:

- `feat(routes): centralize page title management` — confirms App.tsx is actively maintained; follow its import style
- `feat(routes): add NotFoundPage and tests for 404 behavior` — confirms MemoryRouter is used in route tests
- `fix(observability): update tests and error handling` — confirms React Testing Library + Vitest test patterns are the standard
- `fix(26-4): resolve code review findings for Role Guards & Reactive Auth` — confirms `useAuth()` pattern and role guard patterns are well-established

### Testing Requirements

- **Framework:** Vitest + React Testing Library (same as all existing tests)
- **Test scope:**
  1. `AppContent` renders `null` (not a spinner) when `isLoading = true` — mock `useAuth` to return `{ isLoading: true }`
  2. `ProtectedRoute` does NOT render a spinner when `isLoading = true` — confirm it renders null or nothing
  3. `useApprovalQueue`: mock `useAuth` with `user = null`, assert `useQuery` is called with `enabled: false` (or verify no API call is made)
  4. `useActiveExecutions`: same pattern as above
- **No existing `ProtectedRoute` or `App.tsx` tests exist** — all tests in this story are new. The closest existing test is `src/__tests__/components/DashboardAuth.test.tsx` which tests Dashboard role-gating via mocked `useAuth` — use it as a reference pattern for mocking `useAuth` in new tests.

### References

- [Source: epics.md#Story-27.7](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: App.tsx#AppContent-isLoading-block](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/App.tsx) — lines 124–134
- [Source: ProtectedRoute.tsx#isLoading-block](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/auth/ProtectedRoute.tsx) — lines 28–37
- [Source: AuthContext.tsx#isLoading-initialization](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/contexts/AuthContext.tsx) — line 76
- [Source: sprint-status.yaml#27-7-notes](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml) — `UI-8 — null render during auth re-evaluation + enabled:!!user guards. QA-NFR5.`
- QA Report reference: QA-NFR5

## Dev Agent Record

### Agent Model Used

claude-4.6-sonnet-medium-thinking

### Debug Log References

### Completion Notes List

- Code review fixes applied 2026-03-03: (H-1) moved `...options` spread after `enabled` guard in 8 hooks across `useExecutions.ts` and `useNotifications.ts` to prevent auth guard bypass; (H-2) rewrote ProtectedRoute test to assert correct redirect-not-spinner behavior with `/login` route defined; (M-1) filled Dev Agent Record File List; (M-2) mocked `AuthProvider`/`SocketProvider` in AppContent test to prevent async side effects; (M-3) added `useApprovals` nested-closure hook guard tests with `apiClient` mock; (M-4) removed duplicate unchecked task entries from story. LOW: fixed stale JSDoc in ProtectedRoute.tsx, `any` types in useQaReview.ts, misleading comment in App.tsx.

### File List

- `src/App.tsx` — replaced auth loading spinner with `return null`; removed `Loader2` import; fixed misleading comment
- `src/components/auth/ProtectedRoute.tsx` — removed dead `isLoading` spinner block and `Loader2` import; removed stale JSDoc line
- `src/hooks/useApprovals.ts` — added `useAuth()` at parent scope; `enabled: !!user` to `useApprovalQueue`, `useApprovalSummary`; conjunction to `useApprovalDetail`
- `src/hooks/queries/useNotifications.ts` — added `enabled: !!user` (after `...options` spread) to `useNotificationPreferences`, `useInAppNotifications`, `useUnreadNotificationCount`
- `src/hooks/queries/useExecutions.ts` — added `enabled: !!user` (after `...options` spread) to `useActiveExecutions`; conjunction with `!!executionId` for `useExecution`, `useExecutionLogs`, `useExecutionActivities`, `useLatestExecutionActivities`
- `src/hooks/useQaReview.ts` — added `enabled: !!user` to `useQueue`, `useWorkloadSummary`; conjunction for `useSampleDetail`; fixed `any` types
- `src/hooks/queries/useSystemConfig.ts` — added `enabled: !!user` to main query
- `src/__tests__/AppContent.test.tsx` (new) — tests null render when `isLoading: true`; mocks `AuthProvider`/`SocketProvider`
- `src/__tests__/ProtectedRoute.test.tsx` (new) — tests redirect-not-spinner when unauthenticated, redirect to login, children render when authenticated
- `src/__tests__/useAuthGuards.test.tsx` (new) — tests `enabled: !!user` guard on `useActiveExecutions` and `useApprovalQueue` (nested closure pattern)
