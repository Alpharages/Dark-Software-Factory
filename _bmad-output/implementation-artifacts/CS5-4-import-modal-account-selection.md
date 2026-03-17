# Story CS5.4: Import Modal — Account Selection & Inline OAuth

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want the **ClickUp import modal to show my connected accounts and let me connect one inline if I haven't already**,
so that **I can import projects without any pre-setup in Settings**.

## Acceptance Criteria

1. **Step 0 Added:** `ClickUpImportModal` gains a new Step 0 "Select Account" before the existing org/space/list steps. The `type Step` changes from `'provider' | 'organization' | 'hierarchy'` to `'account' | 'organization' | 'hierarchy'` — the "provider" selection step is replaced by the account selection step (provider is implicitly ClickUp). Step indicator still shows 3 circles.
2. **Accounts Loaded:** Step 0 fetches connected ClickUp accounts via `useConnectedApps()` hook (at `src/hooks/queries/useConnectedApps.ts` — already deployed by CS5-3). Accounts display as selectable radio-card buttons showing `workspace_name` and `bot_username`.
3. **Single Account — Auto-select:** If exactly one account exists, it is auto-selected and Step 0 renders in a collapsed "confirmed" state showing `workspace_name` with a "Change account" link to expand the selector.
4. **Multiple Accounts:** All accounts shown as selectable cards. "Connect another ClickUp account" link at the bottom initiates OAuth with `returnTo: "import"`.
5. **No Accounts — Inline OAuth:** If zero accounts, Step 0 shows: ClickUp icon + "No ClickUp accounts connected" + "Connect ClickUp" button. Clicking stores `{ returnedFromOAuth: true }` in `localStorage` key `dsf:pendingImport`, then calls `connectedAppsApi.getClickUpConnectUrl('import')` and redirects via `window.location.href`.
6. **Auto-Reopen After OAuth:** On mount, `ProjectsSyncPage` (`/projects/sync`) checks `?openImport=true` query param. If present: auto-opens modal, removes param from URL (`replace: true`), clears `localStorage.removeItem('dsf:pendingImport')`.
7. **Hierarchy Uses Account Token:** Steps 1–2 (org → space → list) call `GET /api/v1/apps/:accountId/hierarchy` using selected account's ID. `useClickUpHierarchy` hook (called `/integrations/clickup/hierarchy`) is removed if no other callers; marked `@deprecated` if callers remain.
8. **Next Button Gated:** Footer "Next"/"Import" on Step 0 disabled until account selected. Footer "Back" button is **hidden** on Step 0 (no previous step).
9. **Loading/Error States:** `SkeletonCard count={2}` during account fetch. Error alert with "Retry" button on failure.
10. **API Client:** `connectedAppsApi` object gains `getAppHierarchy(accountId, teamId?)` method calling `GET /api/v1/apps/:accountId/hierarchy`.

## Tasks / Subtasks

- [x] Task 1: Add `getAppHierarchy` to `connectedAppsApi` (AC: #10)
  - [x] Open `src/api/connectedAppsApi.ts` (already exists from CS5-3)
  - [x] Add `HierarchyResponse` import: `import type { HierarchyResponse } from '@/types/integrations'`
  - [x] Add `getAppHierarchy` to the `connectedAppsApi` object (same pattern as existing methods — see Architecture section)
  - [x] Path must be `/api/v1/apps/${accountId}/hierarchy` (matches CS5-3 full-path convention used throughout the file)
- [x] Task 2: Add `useAppHierarchy` to `useConnectedApps.ts` (AC: #7)
  - [x] Open `src/hooks/queries/useConnectedApps.ts` (already exists from CS5-3)
  - [x] Add `useQuery` import if not already present
  - [x] Add `HierarchyResponse` import from `@/types/integrations`
  - [x] Add `getAppHierarchy` import from `@/api/connectedAppsApi`
  - [x] Export `connectedAppsKeys` const (needed for `PmIntegrationCallback` invalidation in Task 6)
  - [x] Add `useAppHierarchy(accountId, teamId?, enabled?)` hook (see Architecture section)
- [x] Task 3: Update `useImportProject` hook (AC: CS5-5 prep)
  - [x] Add `accountId?: string` to `ImportProjectRequest` interface
  - [x] Include `accountId` in the `POST /projects/import` request body
- [x] Task 4: Rewrite ClickUpImportModal Step 0 (AC: #1–#5, #8–#9)
  - [x] Change `type Step` to `'account' | 'organization' | 'hierarchy'`
  - [x] Remove `selectedProvider` state and `handleProviderSelect` function entirely (provider is always CLICKUP)
  - [x] Add `selectedAccountId: string | null` state
  - [x] Add `useConnectedApps()` call: destructure `data`, `isLoading`, `isError`, `refetch`
  - [x] Replace `useClickUpHierarchy(...)` with `useAppHierarchy(selectedAccountId, selectedOrganization?.id, step !== 'account' && !!selectedAccountId)`
  - [x] Add `handleAccountSelect(id)` — sets `selectedAccountId`, advances to `'organization'`
  - [x] Update `handleBack` (see Architecture — go back to `'account'`, not `'provider'`)
  - [x] Update `handleClose` — reset step to `'account'`, reset `selectedAccountId` to null, remove `setSelectedProvider`
  - [x] Update `handleImport` — replace `selectedProvider ?? 'CLICKUP'` with `'CLICKUP'`; add `accountId: selectedAccountId ?? undefined`
  - [x] Update `confetti` colors to always use ClickUp purples (remove `selectedProvider` condition)
  - [x] Update step progress indicator array: `['account', 'organization', 'hierarchy']`
  - [x] Update `getStepIcon`, `getStepTitle`, `getStepDescription` — replace `'provider'` case with `'account'`
  - [x] Update header back-arrow condition: `step !== 'account'` (was `step !== 'provider'`)
  - [x] **Replace** `step === 'provider'` content block with `step === 'account'` content block:
    - Loading skeleton (`SkeletonCard count={2}`)
    - Error state with Retry
    - Zero accounts: empty state + inline OAuth button
    - Single account: collapsed "confirmed" card with `workspace_name` + "Change account" link
    - Multiple accounts: selectable radio cards (see Architecture for card pattern)
    - "Connect another ClickUp account" link (multi-account scenario)
  - [x] **Remove "Recently Imported" section** (was inside `step === 'provider'` — it bypassed provider selection which is no longer a step; remove it entirely rather than carry dead UX)
  - [x] Add `useEffect` for `dsf:pendingImport` on modal open (clears the flag; accounts refetch naturally)
  - [x] **Footer Back button:** Hide when `step === 'account'` — change footer Back button `disabled` or conditional render: `{step !== 'account' && <Button onClick={...}>Back</Button>}`
  - [x] **Footer Next/Import button for Step 0:** On `step === 'account'`, show a "Next" button (disabled when `!selectedAccountId`), calling `handleAccountSelect(selectedAccountId!)` or advancing directly; show "Import" button only on `step === 'hierarchy' && selectedList` (existing logic)
- [x] Task 5: Handle `?openImport=true` in `ProjectsSyncPage` (AC: #6)
  - [x] Add `useSearchParams`, `useNavigate` imports from `react-router-dom`
  - [x] Add `useEffect` on mount: if `openImport === 'true'` → open modal + clear URL + clear localStorage (see Architecture)
  - [x] Add `// eslint-disable-next-line react-hooks/exhaustive-deps` comment above empty deps array (intentional one-shot mount effect)
- [x] Task 6: Update `PmIntegrationCallback` for `returnTo=import` (AC: #6 prerequisite)
  - [x] Import `connectedAppsKeys` from `@/hooks/queries/useConnectedApps` (added in Task 2)
  - [x] Add `returnTo === 'import'` case in success path: invalidate `['connected-apps']`, navigate to `/projects/sync?openImport=true` after 1200ms
  - [x] Add `returnTo === 'import'` to error destination: navigate to `/projects/sync`
- [x] Task 7: Deprecate/delete `useClickUpHierarchy` (AC: #7)
  - [x] `grep -r "useClickUpHierarchy" src/` in the frontend repo
  - [x] If only `ClickUpImportModal.tsx` used it (now removed): **delete** `src/hooks/useClickUpHierarchy.ts`
  - [x] If other callers found: add `@deprecated` JSDoc pointing to `useAppHierarchy`
- [x] Task 8: Tests (AC: all)
  - [x] `ClickUpImportModal.test.tsx`: Step 0 loading skeleton; zero-accounts inline OAuth (localStorage set + window.location.href); single-account auto-select collapsed view; multiple-accounts radio cards; Next disabled without selection; advancing to org step; hierarchy called with `accountId`; import called with `accountId`; `dsf:pendingImport` cleared on open; footer Back hidden on step 0
  - [x] `PmIntegrationCallback.tsx` tests (existing file): add `returnTo=import` success → navigates to `/projects/sync?openImport=true`; `returnTo=import` error → navigates to `/projects/sync`
  - [x] `ProjectsSyncPage.test.tsx` (create if not exists): `?openImport=true` opens modal; param removed from URL; localStorage cleared

## Dev Notes

### Frontend-Only Story

All backend endpoints are live (CS5-1 and CS5-2 complete). CS5-3 is complete — `connectedAppsApi.ts` and `useConnectedApps.ts` already exist.

**Frontend repo:** `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`

### Backend API Reference

| Endpoint                                           | Method | Auth                 | Purpose                                       |
| -------------------------------------------------- | ------ | -------------------- | --------------------------------------------- |
| `GET /api/v1/apps/connected`                       | GET    | JWT PM/MANAGER/ADMIN | List current user's `ConnectedApp` records    |
| `GET /api/v1/apps/clickup/connect?returnTo=import` | GET    | JWT PM/MANAGER/ADMIN | Returns `{ url: string }` — OAuth URL         |
| `GET /api/v1/apps/:id/hierarchy?teamId=...`        | GET    | JWT PM/MANAGER/ADMIN | ClickUp org/space/list tree via account token |

After OAuth with `returnTo=import`, backend redirects to:
`{FRONTEND_URL}/settings/pm-callback?integration=connected&returnTo=import&accountId={newId}`

### ConnectedApp Actual Shape (CS5-3 Implementation)

⚠️ The backend DTO uses **camelCase** but CS5-3's `connectedAppsApi.ts` maps to **snake_case** TypeScript interface. Use the CS5-3 interface exactly:

```typescript
// From src/api/connectedAppsApi.ts (CS5-3 — already in repo)
interface ConnectedApp {
  id: string;
  provider: 'clickup' | 'jira' | 'asana';
  workspace_id: string;
  workspace_name: string; // ← display name for workspace card
  bot_user_id: string;
  bot_username: string; // ← display as muted subtitle (NO metadata nesting)
  created_at: string; // ← ISO datetime (NOT connectedAt)
}
// GET /api/v1/apps/connected returns ConnectedApp[] directly (no wrapper)
```

**Do NOT use** `account.workspaceName`, `account.metadata?.botUsername`, or `account.connectedAt` — those are the planned DTO shape, not the actual CS5-3 implementation. The correct fields are `account.workspace_name`, `account.bot_username`, `account.created_at`.

### Architecture: `connectedAppsApi` — Object Pattern + Full Paths

CS5-3 uses an **object export** pattern and **full `/api/v1/`** paths. Add `getAppHierarchy` to match:

```typescript
// src/api/connectedAppsApi.ts — ADD to existing connectedAppsApi object
import type { HierarchyResponse } from '@/types/integrations';

export const connectedAppsApi = {
  getConnectedApps: async (): Promise<ConnectedApp[]> => { ... }, // existing
  getClickUpConnectUrl: async (returnTo?: string): Promise<{ url: string }> => { ... }, // existing
  disconnectApp: async (id: string): Promise<void> => { ... }, // existing

  // ADD:
  getAppHierarchy: async (accountId: string, teamId?: string): Promise<HierarchyResponse> => {
    const params = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const response = await apiClient.get<HierarchyResponse>(
      `/api/v1/apps/${accountId}/hierarchy${params}`
    );
    return response.data;
  },
};
```

### Architecture: `useConnectedApps.ts` Additions

CS5-3's hook file has no `connectedAppsKeys` export — add it now (Task 2), it's needed by `PmIntegrationCallback`:

```typescript
// src/hooks/queries/useConnectedApps.ts — ADD at top, BEFORE hooks

import { useQuery } from '@tanstack/react-query'; // add if not already present
import type { HierarchyResponse } from '@/types/integrations';

// ADD: query key factory (needed by PmIntegrationCallback for targeted invalidation)
export const connectedAppsKeys = {
  all: ['connected-apps'] as const,
  list: () => [...connectedAppsKeys.all, 'list'] as const,
  hierarchy: (accountId: string, teamId?: string) =>
    [...connectedAppsKeys.all, 'hierarchy', accountId, teamId] as const,
};

// Existing hooks stay unchanged (useConnectedApps uses ['connected-apps'] key — update to use connectedAppsKeys.list() for consistency if desired, but not required)

// ADD: hierarchy hook
export function useAppHierarchy(
  accountId: string | null,
  teamId?: string,
  enabled: boolean = true,
) {
  return useQuery<HierarchyResponse>({
    queryKey: connectedAppsKeys.hierarchy(accountId ?? '', teamId),
    queryFn: () => connectedAppsApi.getAppHierarchy(accountId!, teamId),
    enabled: !!accountId && enabled,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
```

> ⚠️ `PmIntegrationCallback.tsx` must invalidate using `{ queryKey: ['connected-apps'] }` (the bare key) OR import `connectedAppsKeys` and use `connectedAppsKeys.all` — both invalidate the whole `connected-apps` namespace. Use `connectedAppsKeys.all` after adding the export above.

### Architecture: Step Type + State Changes

```typescript
// BEFORE
type Step = 'provider' | 'organization' | 'hierarchy';
const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

// AFTER — provider removed (always CLICKUP), account selection replaces it
type Step = 'account' | 'organization' | 'hierarchy';
const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
// selectedProvider state: DELETE entirely

// New hooks at component top:
const {
  data: connectedAccounts = [],
  isLoading: isLoadingAccounts,
  isError: isAccountsError,
  refetch: refetchAccounts,
} = useConnectedApps();

// Replace useClickUpHierarchy with:
const { data: hierarchyData, isLoading: isLoadingHierarchy } = useAppHierarchy(
  selectedAccountId,
  selectedOrganization?.id,
  step !== 'account' && !!selectedAccountId,
);
```

### Architecture: `handleBack` Update

```typescript
// AFTER
const handleBack = useCallback(() => {
  if (step === 'hierarchy') {
    setSelectedSpace(null);
    setSelectedList(null);
    setListSearch('');
    if (hasMultipleOrgs) {
      setStep('organization');
      setSelectedOrganization(null);
    } else {
      setStep('account'); // was: handleClose()
    }
  } else if (step === 'organization') {
    setStep('account'); // was: setStep('provider') + setSelectedProvider(null)
    setSelectedOrganization(null);
    setOrgSearch('');
  }
  // step === 'account': no back; footer Back button hidden at this step
}, [step, hasMultipleOrgs]);
```

### Architecture: `handleClose` + `handleImport` Updates

```typescript
const handleClose = useCallback(() => {
  setStep('account'); // was: 'provider'
  setSelectedAccountId(null); // NEW
  // REMOVE: setSelectedProvider(null)
  setSelectedOrganization(null);
  setSelectedSpace(null);
  setSelectedList(null);
  setHasMultipleOrgs(false);
  setOrgSearch('');
  setSpaceSearch('');
  setListSearch('');
  onClose();
}, [onClose]);

const handleImport = useCallback(() => {
  if (!selectedList) {
    toast.error('Please select a list to import');
    return;
  }
  importProject({
    provider: 'CLICKUP', // hardcoded — no longer from state
    resourceId: selectedList.id,
    accountId: selectedAccountId ?? undefined, // NEW
  });
}, [selectedList, selectedAccountId, importProject]);
```

### Architecture: Footer Button Behavior on Step 0

The existing footer (line 977+) renders Back + conditionally Import. After the change:

```tsx
{/* Footer */}
<div className="... flex-shrink-0">
  {/* Hide Back entirely on Step 0 — no previous step */}
  {step !== 'account' && (
    <Button variant="ghost" onClick={selectedSpace ? clearSpace : handleBack} ...>
      {selectedSpace ? 'Change Space' : 'Back'}
    </Button>
  )}

  {/* Step 0: Next button (gated) */}
  {step === 'account' && (
    <Button
      onClick={() => selectedAccountId && setStep('organization')}
      disabled={!selectedAccountId}
      className="..."
    >
      Next <ArrowRight className="w-4 h-4 ml-2" />
    </Button>
  )}

  {/* Steps 1–2: existing Import button */}
  {step === 'hierarchy' && selectedList && (
    <Button onClick={handleImport} disabled={isImporting}>...</Button>
  )}
</div>
```

### Architecture: Step 0 Account Selection UI

Use the existing `SkeletonCard` sub-component for loading. For radio-card styling, follow the org-selection button pattern (line 683–716) — same `glass-card` + hover + border treatment:

```tsx
{
  step === 'account' && (
    <StepTransition stepKey="account">
      <div className="space-y-3">
        {/* Loading */}
        {isLoadingAccounts && <SkeletonCard count={2} />}

        {/* Error */}
        {isAccountsError && (
          <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10">
            <p className="text-sm text-destructive mb-3">Failed to load connected accounts.</p>
            <Button variant="outline" size="sm" onClick={() => refetchAccounts()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        )}

        {/* Zero accounts */}
        {!isLoadingAccounts && !isAccountsError && connectedAccounts.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center border-2 border-dashed border-border/30 rounded-2xl">
            <Cloud className="w-12 h-12 text-muted-foreground/50" />
            <p className="font-semibold text-foreground">No ClickUp accounts connected</p>
            <p className="text-sm text-muted-foreground">
              Connect your ClickUp account to start importing
            </p>
            <Button onClick={handleInlineOAuth} variant="default">
              Connect ClickUp
            </Button>
          </div>
        )}

        {/* Single account — collapsed "confirmed" */}
        {!isLoadingAccounts &&
          !isAccountsError &&
          connectedAccounts.length === 1 &&
          (() => {
            const acc = connectedAccounts[0];
            // Auto-select on render (use useEffect or inline effect)
            return (
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-3">
                <Boxes className="w-8 h-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{acc.workspace_name}</p>
                  <p className="text-xs text-muted-foreground">{acc.bot_username || 'Unknown'}</p>
                </div>
                <Check className="w-5 h-5 text-primary shrink-0" />
              </div>
            );
          })()}

        {/* Multiple accounts — radio cards */}
        {!isLoadingAccounts && !isAccountsError && connectedAccounts.length > 1 && (
          <div className="space-y-2">
            {connectedAccounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => setSelectedAccountId(acc.id)}
                className={cn(
                  'group flex items-center gap-3 w-full p-4 rounded-xl border transition-all text-left',
                  selectedAccountId === acc.id
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/50 hover:border-primary/30 hover:bg-muted/50',
                )}
              >
                <Boxes className="w-8 h-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{acc.workspace_name}</p>
                  <p className="text-xs text-muted-foreground">{acc.bot_username || 'Unknown'}</p>
                </div>
                {selectedAccountId === acc.id && (
                  <Check className="w-5 h-5 text-primary shrink-0" />
                )}
              </button>
            ))}
            <button
              onClick={handleInlineOAuth}
              className="w-full text-sm text-primary hover:underline py-2 text-center"
            >
              + Connect another ClickUp account
            </button>
          </div>
        )}
      </div>
    </StepTransition>
  );
}
```

`handleInlineOAuth` (async):

```typescript
const handleInlineOAuth = async () => {
  const { url } = await connectedAppsApi.getClickUpConnectUrl('import');
  localStorage.setItem('dsf:pendingImport', JSON.stringify({ returnedFromOAuth: true }));
  window.location.href = url;
};
```

Single-account auto-select `useEffect`:

```typescript
useEffect(() => {
  if (step === 'account' && connectedAccounts.length === 1 && !selectedAccountId) {
    setSelectedAccountId(connectedAccounts[0].id);
  }
}, [step, connectedAccounts, selectedAccountId]);
```

`dsf:pendingImport` clear on modal open:

```typescript
useEffect(() => {
  if (isOpen) {
    localStorage.removeItem('dsf:pendingImport'); // clear any stale flag
  }
}, [isOpen]);
```

### Architecture: "Recently Imported" Section — Remove

The "Recently Imported" section (currently inside `step === 'provider'`) **must be removed**. It called `setSelectedProvider(item.provider)` which bypassed account selection. Keeping it would set step to `'organization'` without a `selectedAccountId`, breaking the hierarchy fetch. The provider step is gone; there's nowhere to reattach it cleanly. Delete the `recentImports` state and its `useEffect` too.

### Architecture: `filteredSpaces` — No Change Needed

The existing `filteredSpaces` memo uses `hierarchyData?.organizations?.[0]?.spaces` (always index 0). This is correct and unchanged: with account-based hierarchy, the endpoint already scopes to the selected account's orgs. Index 0 is still valid. **Do not change** this logic.

The `ConnectionStatus` component at `step === 'organization'` (line 472) shows a static "Connected" badge — keep as-is, it provides a harmless visual confirmation.

### Architecture: `filteredLists` — Verify `selectedOrganization` lookup

```typescript
// Current (line 379-387) — keep unchanged
const filteredLists = useMemo(() => {
  if (!selectedSpace) return [];
  const space = hierarchyData?.organizations?.[0]?.spaces.find(
    (s: Space) => s.id === selectedSpace.id,
  );
  // ...
}, [hierarchyData, selectedSpace, listSearch]);
```

This finds the space within the account hierarchy's first org. Unchanged — still correct.

### Architecture: `ProjectsSyncPage` — `?openImport=true`

```typescript
// src/pages/ProjectsSyncPage.tsx
import { useState, useEffect } from 'react'; // useEffect already needed
import { useSearchParams, useNavigate } from 'react-router-dom'; // ADD

export function ProjectsSyncPage() {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchParams] = useSearchParams(); // ADD
  const navigate = useNavigate(); // ADD

  // ADD: one-shot mount effect
  useEffect(() => {
    if (searchParams.get('openImport') === 'true') {
      setIsImportModalOpen(true);
      localStorage.removeItem('dsf:pendingImport');
      navigate('/projects/sync', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: run once on mount only
  // ...
}
```

> ⚠️ Planning artifact says `Dashboard.tsx` — **incorrect** for this codebase. The modal is in `ProjectsSyncPage.tsx`. Do NOT modify `Dashboard.tsx`.

### Architecture: `PmIntegrationCallback` — `returnTo=import`

CS5-3 already implemented `returnTo=settings`. Add `returnTo=import` alongside — additive only:

```typescript
// Import addition at top of file:
import { connectedAppsKeys } from '@/hooks/queries/useConnectedApps';

// In handleCallback, inside integrationStatus === 'connected' block:
if (returnTo === 'settings') {
  // ... existing CS5-3 code (unchanged) ...
} else if (returnTo === 'import') {
  setStatus('connected');
  toast.success('Account connected! Resuming import...');
  await queryClient.invalidateQueries({ queryKey: connectedAppsKeys.all });
  setTimeout(() => navigate('/projects/sync?openImport=true', { replace: true }), 1200);
} else if (projectId) {
  // ... existing project-level flow (unchanged) ...
}

// In integrationStatus === 'error' block — update destination:
const destination =
  returnTo === 'settings'
    ? '/settings/connected-apps'
    : returnTo === 'import'
      ? '/projects/sync' // ADD
      : projectId
        ? `/projects/${projectId}/settings/integrations`
        : '/dashboard';
```

### Architecture: `getStepIcon` / `getStepTitle` / `getStepDescription`

```typescript
const getStepIcon = () => {
  switch (step) {
    case 'account': return <Boxes className="w-5 h-5 text-white" />;      // was Sparkles
    case 'organization': return <Building2 className="w-5 h-5 text-white" />;
    case 'hierarchy': return <Layers className="w-5 h-5 text-white" />;
  }
};
const getStepTitle = () => {
  switch (step) {
    case 'account': return 'Select Account';
    case 'organization': return 'Choose Workspace';
    case 'hierarchy': return 'Select Location';
  }
};
const getStepDescription = () => {
  switch (step) {
    case 'account': return 'Choose a connected ClickUp account to import from.';
    case 'organization': return 'Select the ClickUp workspace you want to import from.';
    case 'hierarchy': return `Choose a space and list from ${selectedOrganization?.name || 'your workspace'}.`;
  }
};
```

Also update header back-arrow condition:

```tsx
{
  step !== 'account' && ( // was: step !== 'provider'
    <button onClick={handleBack}>...</button>
  );
}
```

### Architecture: `useAppHierarchy` Error Handling in Org/Hierarchy Steps

When `useAppHierarchy` fails on steps 1–2, **no additional error UI is needed**. The existing empty-state blocks in `step === 'organization'` ("No workspaces found") and `step === 'hierarchy'` ("No spaces found") already handle the case where `hierarchyData` is undefined/empty. The `retry: 2` in the hook provides automatic retry before reaching the empty state.

### Testing Standards

- **Framework:** Vitest + React Testing Library (not Jest)
- **Mock:** `vi.mock('@/api/connectedAppsApi')` and `vi.mock('@/hooks/queries/useConnectedApps')`
- **Selectors:** `screen.getByRole`, `screen.getByText` — no brittle CSS class selectors
- **Test file:** `src/components/projects/ClickUpImportModal.test.tsx` (already exists — update it)

**Required test cases:**

1. Shows `SkeletonCard` while `useConnectedApps` loading
2. Zero accounts: renders empty state, clicking "Connect ClickUp" calls `getClickUpConnectUrl('import')` + sets `dsf:pendingImport` + redirects
3. Single account: auto-selected, "confirmed" card shown, footer Next enabled
4. Multiple accounts: renders N radio cards, Next disabled until one clicked
5. Clicking account card sets it as selected, clicking Next advances to org step
6. `useAppHierarchy` called with `selectedAccountId` when step advances
7. Clicking Import calls `useImportProject` with `{ provider: 'CLICKUP', resourceId, accountId }`
8. `dsf:pendingImport` removed from localStorage on modal open
9. Footer Back button NOT in the DOM when `step === 'account'`
10. `PmIntegrationCallback`: `returnTo=import` success → navigate to `/projects/sync?openImport=true`
11. `PmIntegrationCallback`: `returnTo=import` error → navigate to `/projects/sync`

### References

- Epic: [Source: _bmad-output/planning-artifacts/epics-connected-apps.md#Story CS5-4]
- CS5-3 story: [Source: _bmad-output/implementation-artifacts/CS5-3-connected-apps-settings-page.md]
- **`connectedAppsApi.ts` (live):** [Source: src/api/connectedAppsApi.ts (frontend — read before editing)]
- **`useConnectedApps.ts` (live):** [Source: src/hooks/queries/useConnectedApps.ts (frontend — read before editing)]
- **`PmIntegrationCallback.tsx` (live):** [Source: src/pages/settings/PmIntegrationCallback.tsx (frontend — CS5-3 already applied)]
- Backend controller: [Source: src/connected-apps/connected-apps.controller.ts]
- `ClickUpImportModal` full implementation: [Source: src/components/projects/ClickUpImportModal.tsx (frontend)]
- `useClickUpHierarchy` (to delete/deprecate): [Source: src/hooks/useClickUpHierarchy.ts (frontend)]
- `useImportProject` (to update): [Source: src/hooks/useImportProject.ts (frontend)]
- `ProjectsSyncPage` (to update): [Source: src/pages/ProjectsSyncPage.tsx (frontend)]
- Org selection card pattern (radio card reference): [Source: src/components/projects/ClickUpImportModal.tsx#L683-L716 (frontend)]
- `HierarchyResponse` type: [Source: src/types/integrations.ts (frontend)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Code review by AI revealed: all tasks were implemented but task checkboxes were left unchecked.
- Fixes applied during review: `getAppHierarchy` return type fixed to `HierarchyResponse`; `useAppHierarchy` gained `enabled` param and `teamId` in cache key; `connectedAppsKeys` gained `list()` factory; single-account auto-select no longer skips Step 0 (shows confirmed state instead); footer Back hidden on step 0; Next button added to footer for step 0; loading/error states wired for account fetch; `dsf:pendingImport` localStorage value corrected to JSON object; `PmIntegrationCallback` gained `returnTo=import` handling (both success and error paths); `ProjectsSyncPage` gained `?openImport=true` handler; `PmIntegrationCallback` now uses `connectedAppsKeys.all` for cache invalidation; `connectedAppsApi.ts` import path fixed to `@/api/client`.

### File List

**Frontend (`dsf-dasbhoard`):**

- `src/components/projects/ClickUpImportModal.tsx` (modified — replace `'provider'` step with `'account'`, add loading/error/empty/confirmed/radio account selection UI, remove recently-imported section, update hierarchy to `useAppHierarchy` with `enabled` param, footer Back hidden on step 0, Next button in footer for step 0, pass `accountId` to import, clear `dsf:pendingImport` on open)
- `src/components/projects/ClickUpImportModal.test.tsx` (modified — fix tests broken by click-not-advance change, add Step 0 loading, zero-accounts OAuth, Next disabled, localStorage clear, Back absent tests)
- `src/pages/ProjectsSyncPage.tsx` (modified — handle `?openImport=true` on mount via useSearchParams + useNavigate + useEffect)
- `src/pages/settings/PmIntegrationCallback.tsx` (modified — import `connectedAppsKeys`, add `returnTo=import` success path navigating to `/projects/sync?openImport=true`, add `returnTo=import` error destination)
- `src/pages/settings/PmIntegrationCallback.test.tsx` (modified — add `returnTo=import` success and error tests, add `/projects/sync` route to test router)
- `src/api/connectedAppsApi.ts` (modified — add `getAppHierarchy` with `HierarchyResponse` return type, fix relative import to `@/api/client`, add `HierarchyResponse` import)
- `src/hooks/queries/useConnectedApps.ts` (modified — add `connectedAppsKeys` export with `list()` and `hierarchy(teamId?)`, add `useAppHierarchy(accountId, teamId?, enabled?)` hook with `retry: 2`)
- `src/hooks/useImportProject.ts` (modified — add `accountId?` to `ImportProjectRequest`)
- `src/hooks/useClickUpHierarchy.ts` (deleted — no other callers found)
- `src/App.tsx` (modified — CS5-3 routing changes, not CS5-4 scope)
- `src/pages/settings/SettingsLayout.tsx` (modified — CS5-3 scope)
- `src/pages/settings/panels/AllPanels.tsx` (modified — CS5-3 scope)
- `src/types/integrations.ts` (modified — CS5-3 scope: added ConnectedApp/HierarchyResponse types)
- `src/hooks/queries/useConnectedApps.test.tsx` (new — CS5-3 scope)
- `src/pages/settings/panels/ConnectedAppsPanel.tsx` (new — CS5-3 scope)
- `src/pages/settings/panels/ConnectedAppsPanel.test.tsx` (new — CS5-3 scope)
