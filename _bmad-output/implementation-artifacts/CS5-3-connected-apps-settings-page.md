# Story CS5.3: Connected Apps Settings Page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want a **central "Connected Apps" page in Settings**,
so that **I can see all my connected provider accounts, connect new ones, and disconnect any at any time**.

## Acceptance Criteria

1. **Route:** `/settings/connected-apps` added to `App.tsx`. Protected: PM/MANAGER/ADMIN roles. Added to system settings sidebar in `SettingsLayout.tsx`.
2. **Page Layout:** `ConnectedAppsPanel.tsx` created at `src/pages/settings/panels/`. Uses `glass-card` surface pattern consistent with existing panels.
3. **Provider Sections:** Three sections rendered: ClickUp, Jira (coming soon), Asana (coming soon). Each section has a header with provider icon and "Connect [Provider] Account" button.
4. **Account Cards:** Each connected account renders a card showing: workspace name (bold), bot username from `metadata.botUsername` (muted), formatted connection date. "Disconnect" button on each card (destructive variant).
5. **Connect ClickUp:** "Connect ClickUp Account" calls `GET /api/v1/apps/clickup/connect?returnTo=settings`. Redirects user to ClickUp OAuth.
6. **Coming Soon:** Jira and Asana connect buttons are disabled with a "Coming Soon" badge — same pattern as existing `PmIntegrationPanel.tsx`.
7. **Disconnect Flow:** Clicking "Disconnect" opens an `AlertDialog` (shadcn): "Remove [Workspace Name] from your connected accounts? Your existing projects will continue syncing. To stop sync on a project, go to that project's settings." Confirm calls `DELETE /api/v1/apps/:id`. On success: account card removed, success toast. `ProjectIntegration` records are not affected — they hold their own token copy.
8. **Empty State:** If no accounts connected for a provider, shows: icon + "No [Provider] accounts connected" + connect button. No blank sections.
9. **Callback Update:** `PmIntegrationCallback.tsx` updated to handle `returnTo=settings` — redirect to `/settings/connected-apps` instead of `/projects/:id/settings/integrations`. Existing project-level flow (reads `state` param) unchanged.
10. **React Query:** `useConnectedApps` hook using `GET /api/v1/apps/connected`. `staleTime: 60000`. Invalidated on connect/disconnect mutations.
11. **API Client:** `connectedAppsApi.ts` created at `src/api/` with functions: `getConnectedApps()`, `getClickUpConnectUrl(returnTo)`, `disconnectApp(id)`.

## Tasks / Subtasks

- [ ] Task 1: Create API client (AC: #10, #11)
  - [ ] Create `src/api/connectedAppsApi.ts` with `getConnectedApps()`, `getClickUpConnectUrl(returnTo)`, `disconnectApp(id)`
  - [ ] Define `ConnectedApp` TypeScript interface matching `ConnectedAppResponseDto`
- [ ] Task 2: Create hook file (AC: #10)
  - [ ] Create `src/hooks/queries/useConnectedApps.ts` (note: `queries/` subfolder, not root `hooks/`)
  - [ ] Export `connectedAppsKeys` factory, `useConnectedApps` query hook, `useDisconnectConnectedApp` mutation hook
  - [ ] `staleTime: 60_000`; mutation invalidates `connectedAppsKeys.list()` on success
- [ ] Task 3: Create `ConnectedAppsPanel.tsx` (AC: #2, #3, #4, #5, #6, #8)
  - [ ] Provider sections: ClickUp (active), Jira/Asana (coming soon with badge)
  - [ ] Account cards: workspace name, bot username, formatted connectedAt date
  - [ ] Empty state per provider section
  - [ ] Connect button → calls `getClickUpConnectUrl('settings')` → `window.location.href`
  - [ ] Loading state: Skeleton cards
  - [ ] Error state: error alert with retry
  - [ ] Use `useDisconnectConnectedApp` from hook file for disconnect mutation
- [ ] Task 4: Implement Disconnect AlertDialog (AC: #7)
  - [ ] Import `AlertDialog` et al from `@/components/ui/alert-dialog`
  - [ ] Dialog copy exactly as per AC#7
  - [ ] Trigger `useDisconnectConnectedApp` on confirm; success/error toasts
- [ ] Task 5: Register route and sidebar (AC: #1)
  - [ ] Add `connected-apps` to `panels` array (system-level only) in `SettingsLayout.tsx` with `AppWindow` icon
  - [ ] Add route under `/settings` in `App.tsx` with `requiredRoles={['PM', 'MANAGER', 'ADMIN']}`
  - [ ] Add `['/settings/connected-apps', 'Connected Apps — DSF']` to title map in `App.tsx`
  - [ ] Re-export `ConnectedAppsPanel` from `AllPanels.tsx`
- [ ] Task 6: Update `PmIntegrationCallback.tsx` (AC: #9)
  - [ ] Add `returnTo` and `accountId` reads alongside existing `state` read (additive, not replacing)
  - [ ] If `returnTo === 'settings'`: invalidate `connectedAppsKeys.list()` + navigate to `/settings/connected-apps`
  - [ ] Error path: if `returnTo === 'settings'` → navigate back to `/settings/connected-apps`
  - [ ] All other cases: existing behavior unchanged (reads `state` for projectId)
- [ ] Task 7: Tests
  - [ ] `ConnectedAppsPanel.test.tsx`: loading skeleton, empty state per provider, account cards rendered, connect button click, disconnect AlertDialog open/confirm, error state
  - [ ] `useConnectedApps.test.ts`: query key shape, staleTime, mutation invalidation
  - [ ] `PmIntegrationCallback.test.tsx`: add test for `returnTo=settings` success and error redirect paths

## Dev Notes

### Backend API Reference (CS5-2 — already implemented)

This story is **frontend-only**. CS5-2 is **done** — all endpoints are live at `src/connected-apps/connected-apps.controller.ts`. No mocking needed.

| Endpoint                                             | Method | Auth                   | Purpose                                                        |
| ---------------------------------------------------- | ------ | ---------------------- | -------------------------------------------------------------- |
| `GET /api/v1/apps/connected`                         | GET    | JWT (PM/MANAGER/ADMIN) | List all `ConnectedApp` records for the authenticated user     |
| `GET /api/v1/apps/clickup/connect?returnTo=settings` | GET    | JWT (PM/MANAGER/ADMIN) | Returns `{ url: string }` — ClickUp OAuth redirect URL         |
| `DELETE /api/v1/apps/:id`                            | DELETE | JWT (PM/MANAGER/ADMIN) | Disconnect a connected app (ownership guarded, throws 403/404) |
| `GET /api/v1/apps/:id/hierarchy`                     | GET    | JWT (PM/MANAGER/ADMIN) | Fetch ClickUp org/space/list tree (CS5-4 only, not this story) |

**Callback flow:** After OAuth, the backend redirects to:
`{FRONTEND_URL}/settings/pm-callback?integration=connected&returnTo=settings&accountId={newId}`

Note: `returnTo` is URL-encoded by the backend (`encodeURIComponent`) but `'settings'` encodes to `'settings'` — no transformation needed.

### ConnectedApp Response Shape

`ConnectedAppResponseDto` (from `src/connected-apps/dto/connected-app-response.dto.ts`):

```typescript
interface ConnectedApp {
  id: string; // UUID
  provider:
    | 'CLICKUP'
    | 'JIRA'
    | 'ASANA'
    | 'GITHUB'
    | 'GITLAB'
    | 'BITBUCKET'
    | 'GMAIL'
    | 'GOOGLE_CALENDAR'
    | 'SLACK';
  workspaceId: string; // Provider workspace ID
  workspaceName: string; // Display name
  metadata: Record<string, unknown> | null; // { botUserId: string|null, botUsername: string|null }
  connectedAt: string; // ISO datetime string (maps from created_at)
}
```

- Bot username: `metadata?.botUsername as string | undefined` — may be `null` if ClickUp identity fetch failed; render `'Unknown'` as fallback
- Backend returns array directly (no wrapper object) — no `data.data` unwrap needed

### Architecture: API Client

Follow `src/api/integrationsApi.ts` pattern. `GET /apps/connected` returns `ConnectedApp[]` directly:

```typescript
// src/api/connectedAppsApi.ts
import api from './client';

export interface ConnectedApp {
  id: string;
  provider: string;
  workspaceId: string;
  workspaceName: string;
  metadata: Record<string, unknown> | null;
  connectedAt: string;
}

export async function getConnectedApps(): Promise<ConnectedApp[]> {
  const { data } = await api.get('/apps/connected');
  return data; // returns ConnectedApp[] directly, no wrapper
}

export async function getClickUpConnectUrl(returnTo: string): Promise<{ url: string }> {
  // returnTo is a SHORT KEYWORD ('settings' or 'import'), NOT a URL path
  const { data } = await api.get('/apps/clickup/connect', { params: { returnTo } });
  return data;
}

export async function disconnectApp(id: string): Promise<void> {
  await api.delete(`/apps/${id}`);
}
```

### Architecture: Hook File

**Location: `src/hooks/queries/useConnectedApps.ts`** (not `src/hooks/` root — follows `useGithubAccounts.ts`, `useIntegrationHealth.ts` pattern).

Collocate query + mutation in the same file, following `src/hooks/queries/useGithubAccounts.ts` exactly:

```typescript
// src/hooks/queries/useConnectedApps.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConnectedApps, disconnectApp } from '@/api/connectedAppsApi';

export const connectedAppsKeys = {
  all: ['connected-apps'] as const,
  list: () => [...connectedAppsKeys.all, 'list'] as const,
};

export function useConnectedApps() {
  return useQuery({
    queryKey: connectedAppsKeys.list(),
    queryFn: getConnectedApps,
    staleTime: 60_000,
  });
}

export function useDisconnectConnectedApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectApp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectedAppsKeys.list() });
    },
  });
}
```

`ConnectedAppsPanel.tsx` imports both hooks from this file. `PmIntegrationCallback.tsx` imports `connectedAppsKeys` for targeted invalidation.

### Architecture: SettingsLayout Modification

`src/pages/settings/SettingsLayout.tsx` lines 14–23: `panels` array is for **system-level settings** only.

```typescript
import { ..., AppWindow } from 'lucide-react';  // AppWindow confirmed available in lucide-react 0.562.0

const panels = [
  { id: 'cleanup', label: 'Cleanup', icon: Trash2 },
  // ...existing 7 entries...
  { id: 'integrations', label: 'Third-Party Integrations', icon: Blocks },
  { id: 'connected-apps', label: 'Connected Apps', icon: AppWindow },  // ADD HERE
];
```

> ⚠️ Do **NOT** add to `projectPanels` (lines 25–28) — those are per-project settings. `connected-apps` is user-level.

### Architecture: App.tsx Route Registration

Under the `/settings` route block (line 376), `SettingsLayout` is the parent. Use `requiredRoles` (plural prop, not `requiredRole`):

```tsx
// Import ConnectedAppsPanel at top with other panel imports (line 47 area)
import { ..., ConnectedAppsPanel } from '@/pages/settings/panels/AllPanels';

// In the /settings route block:
<Route path="connected-apps" element={
  <ProtectedRoute requiredRoles={['PM', 'MANAGER', 'ADMIN']}>
    <ConnectedAppsPanel />
  </ProtectedRoute>
} />
```

Title map (around line 144):

```typescript
['/settings/connected-apps', 'Connected Apps — DSF'],
```

### Architecture: Panel Component Structure

Mirror `PmIntegrationPanel.tsx` layout conventions:

- Page header: `AppWindow` icon in `p-3 bg-[var(--brand-500)]/10 rounded-xl` + h1 + subtitle
- Provider list: vertical stacking (not grid) — each section may have multiple account cards
- Each section: provider icon + name header + "Connect [Provider] Account" button floated right
- Account cards: `glass-card` + `workspaceName` (bold) + `@botUsername ?? 'Unknown'` (muted text-sm) + `formatDistanceToNow(new Date(connectedAt), { addSuffix: true })` from `date-fns` (already a project dep, see `PmIntegrationPanel.tsx` line 16)
- "Coming Soon": disabled button with `opacity-50 cursor-not-allowed` — exact same pattern as `PmIntegrationPanel.tsx` line 511

### Architecture: AlertDialog for Disconnect

Import from `@/components/ui/alert-dialog`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
```

Usage — per account card, with the disconnect mutation from `useDisconnectConnectedApp`:

```tsx
const disconnectMutation = useDisconnectConnectedApp();

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive" size="sm" disabled={disconnectMutation.isPending}>
      <Unlink2 className="w-4 h-4 mr-1" /> Disconnect
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Remove {app.workspaceName}?</AlertDialogTitle>
      <AlertDialogDescription>
        Remove {app.workspaceName} from your connected accounts? Your existing projects will
        continue syncing. To stop sync on a project, go to that project's settings.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => disconnectMutation.mutate(app.id)}
        className="bg-destructive"
      >
        Disconnect
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>;
```

Add `onSuccess` / `onError` toasts in `useDisconnectConnectedApp` or via `useMutation` callbacks in the component.

### Architecture: PmIntegrationCallback Update

The existing file reads `searchParams.get('state')` for the project-level flow. This update is **additive** — keep `state` read intact, add `returnTo` and `accountId` reads alongside it.

The backend sends `accountId` in the success callback URL — read it but do not use it for UI highlighting in this story (just discard after the query invalidation handles re-fetch).

```typescript
const integrationStatus = searchParams.get('integration');
const returnTo = searchParams.get('returnTo');
const accountId = searchParams.get('accountId'); // present on success; discard after use
const projectId = searchParams.get('state'); // legacy project-level flow — keep unchanged

const handleCallback = async () => {
  if (integrationStatus === 'connected') {
    if (returnTo === 'settings') {
      // User-level connected app flow (CS5-2/CS5-3)
      setStatus('connected');
      toast.success('Account connected successfully!');
      await queryClient.invalidateQueries({ queryKey: connectedAppsKeys.list() });
      void accountId; // received but not used for highlighting in this story
      setTimeout(() => navigate('/settings/connected-apps', { replace: true }), 1200);
    } else if (projectId) {
      // Existing project-level PM integration flow (CS0) — unchanged
      setStatus('connected');
      toast.success('PM Tool connected successfully!');
      await queryClient.invalidateQueries({ queryKey: ['pm-integrations'] });
      setTimeout(
        () => navigate(`/projects/${projectId}/settings/integrations`, { replace: true }),
        1200,
      );
    } else {
      navigate('/dashboard', { replace: true });
    }
  } else if (integrationStatus === 'error') {
    setStatus('error');
    toast.error('Failed to connect account.');
    const destination =
      returnTo === 'settings'
        ? '/settings/connected-apps'
        : projectId
          ? `/projects/${projectId}/settings/integrations`
          : '/dashboard';
    setTimeout(() => navigate(destination, { replace: true }), 1500);
  } else {
    toast.error('Invalid callback state.');
    navigate('/dashboard', { replace: true });
  }
};
```

Import `connectedAppsKeys` from `@/hooks/queries/useConnectedApps`.

### Architecture: AllPanels.tsx Re-export

Add at the bottom of `src/pages/settings/panels/AllPanels.tsx`:

```typescript
export { ConnectedAppsPanel } from './ConnectedAppsPanel';
```

### Loading and Error States

Use `Skeleton` from `@/components/ui/skeleton` (already used in `PmIntegrationPanel.tsx`):

- Loading: skeleton cards matching account card height
- Error: `border-error/50 bg-error/10` pattern (see `PmIntegrationPanel.tsx` lines 557–562)

### Project Structure Notes

- **Frontend repo only:** `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`
- Hook goes in `src/hooks/queries/` — **not** `src/hooks/` root
- No backend changes — `ConnectedAppsController` and all endpoints are already in production

### Alignment with Unified Project Structure

- All imports: `@/` path aliases (never relative paths)
- No `React.FC` type annotation
- Component: `PascalCase.tsx`, hook: `camelCase.ts`
- Conditional classes: `clsx` + `tailwind-merge` (same as existing panels)

### Testing Standards

- Vitest + React Testing Library
- `ConnectedAppsPanel.test.tsx` co-located in `src/pages/settings/panels/`
- Mock: `vi.mock('@/api/connectedAppsApi')` and `vi.mock('@/hooks/queries/useConnectedApps')`
- Selectors: `screen.getByRole`, `screen.getByText` — no brittle CSS selectors
- Required cases: loading skeleton, empty state per provider, account cards rendered, connect button triggers redirect, disconnect AlertDialog open/confirm, mutation success removes card, error state

### References

- Epic story definition: [Source: _bmad-output/planning-artifacts/epics-connected-apps.md#Story CS5-3]
- Backend controller (CS5-2): [Source: src/connected-apps/connected-apps.controller.ts]
- `ConnectedAppResponseDto`: [Source: src/connected-apps/dto/connected-app-response.dto.ts]
- `ConnectedAppsService`: [Source: src/connected-apps/connected-apps.service.ts]
- Hook pattern reference: [Source: src/hooks/queries/useGithubAccounts.ts]
- Panel pattern reference: [Source: src/pages/settings/panels/PmIntegrationPanel.tsx]
- `SettingsLayout.tsx` panels array: [Source: src/pages/settings/SettingsLayout.tsx#L14-28]
- `PmIntegrationCallback.tsx`: [Source: src/pages/settings/PmIntegrationCallback.tsx]
- `AllPanels.tsx`: [Source: src/pages/settings/panels/AllPanels.tsx]
- API client pattern: [Source: src/api/integrationsApi.ts]
- `App.tsx` settings routes + `ProtectedRoute` prop: [Source: src/App.tsx#L6,L376-392]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

**Frontend (`dsf-dasbhoard`):**

- `src/pages/settings/panels/ConnectedAppsPanel.tsx` (created)
- `src/pages/settings/panels/ConnectedAppsPanel.test.tsx` (created)
- `src/pages/settings/panels/AllPanels.tsx` (modified — re-export `ConnectedAppsPanel`)
- `src/pages/settings/SettingsLayout.tsx` (modified — add `connected-apps` to `panels` array with `AppWindow` icon)
- `src/pages/settings/PmIntegrationCallback.tsx` (modified — handle `returnTo=settings` and error path)
- `src/api/connectedAppsApi.ts` (created)
- `src/hooks/queries/useConnectedApps.ts` (created — includes `useDisconnectConnectedApp`)
- `src/App.tsx` (modified — register `/settings/connected-apps` route + title)
