# Story OS-4.6-UI: AI Routing Configuration — Settings UI Panels

Status: done

## Change Log

- 2026-03-27: Story created. Frontend counterpart to OS-4.5 (backend API). Adds two UI panels: a global Admin panel under `/settings/ai-routing` and a project-level PM panel under `/projects/:id/settings/ai-routing`.

## Story

As an **Admin** or **PM**,
I want to view and edit AI routing configuration through the settings UI,
So that I can tune provider selection strategy without touching environment variables or redeploying.

## Background

OS-4.5 delivered the backend API:

| Endpoint                                       | Role                     | Purpose                      |
| ---------------------------------------------- | ------------------------ | ---------------------------- |
| `GET /ai-routing/config/global`                | ADMIN, MANAGER           | Read global config           |
| `PUT /ai-routing/config/global`                | ADMIN                    | Update global config         |
| `GET /ai-routing/config/project/:id`           | ADMIN, MANAGER, PM (own) | Read project override row    |
| `PUT /ai-routing/config/project/:id`           | ADMIN, MANAGER, PM (own) | Update project overrides     |
| `DELETE /ai-routing/config/project/:id`        | ADMIN, MANAGER, PM (own) | Reset project to global      |
| `GET /ai-routing/config/project/:id/effective` | ADMIN, MANAGER, PM (own) | Read merged effective config |

This story adds:

1. **`GlobalAiRoutingPanel`** — under `/settings/ai-routing` (ADMIN only to edit, MANAGER read-only)
2. **`ProjectAiRoutingPanel`** — under `/projects/:id/settings/ai-routing` (PM can edit own project, ADMIN/MANAGER full access)

Both panels follow the existing patterns in `GeneralSettingsPanel` (TanStack Query + `useMutation`, shadcn/ui `Card`/`Input`/`Button`, `toast` for feedback) and the `SettingsLayout` sidebar navigation.

## Acceptance Criteria

1. **Given** a user with role `ADMIN` navigates to `/settings/ai-routing`
   **When** the page loads
   **Then** the `GlobalAiRoutingPanel` renders with current global config values loaded from `GET /ai-routing/config/global`; all fields are editable

2. **Given** a user with role `MANAGER` navigates to `/settings/ai-routing`
   **When** the page loads
   **Then** the panel renders with values visible but all fields are read-only (no Save button visible)

3. **Given** an ADMIN edits any field in `GlobalAiRoutingPanel` and clicks Save
   **When** the mutation succeeds
   **Then** `PUT /ai-routing/config/global` is called with the updated payload, a success toast shows, and the query cache is invalidated

4. **Given** an ADMIN submits `complexityThresholdHigh` <= `complexityThresholdMedium`
   **When** the form validates
   **Then** an inline validation error shows before the API call is made: "High threshold must be greater than Medium threshold"

5. **Given** a PM navigates to `/projects/:id/settings/ai-routing`
   **When** the page loads
   **Then** `ProjectAiRoutingPanel` renders showing both the effective config (merged global + project) and clearly marking which fields have project-level overrides set (visual indicator)

6. **Given** a PM leaves a field blank (no override)
   **When** they save
   **Then** that field is sent as `null` (inherit from global), and the UI shows the resolved global value as placeholder text

7. **Given** a PM sets a project-level override and saves
   **When** the mutation succeeds
   **Then** `PUT /ai-routing/config/project/:id` is called, success toast shows, and the panel re-fetches to show the override indicator

8. **Given** a PM clicks "Reset to Global Defaults" in the project panel
   **When** confirmed in a confirmation dialog
   **Then** `DELETE /ai-routing/config/project/:id` is called, the project config row is deleted, and all fields revert to showing global values with no override indicators

9. **Given** a user with role `TL`, `QA`, or `VIEWER` navigates to `/settings/ai-routing`
   **When** the route is evaluated
   **Then** they are redirected to `/forbidden` (ProtectedRoute with `requiredRoles`)

10. **Given** the `/settings` sidebar
    **When** the user has role `ADMIN` or `MANAGER`
    **Then** an "AI Routing" nav item appears in the system settings sidebar

11. **Given** the `/projects/:id/settings` sidebar
    **When** the user has role `ADMIN`, `MANAGER`, or `PM`
    **Then** an "AI Routing" nav item appears in the project settings sidebar

12. **Given** the API returns an error on save
    **When** the mutation fails
    **Then** an error toast shows with the server's error message (or a generic fallback)

13. **Given** the panel is loading data
    **When** the query is in-flight
    **Then** skeleton placeholders render in place of form fields (matching `GeneralSettingsPanel` skeleton pattern)

## Tasks / Subtasks

- [ ] Task 1: Add API client functions in `dsf-dasbhoard/src/api/aiRoutingConfigApi.ts` (AC: #1, #3, #5, #7, #8)
  - [ ] Create the file with the following functions:

    ```typescript
    import apiClient from './client'; // relative import is correct — same src/api/ directory; do NOT change to @/api/client

    export type AIProvider = 'CLAUDE_CODE' | 'GEMINI' | 'CODEX' | 'KIMI';

    export interface AiRoutingConfigPayload {
      primaryProviderOverride?: AIProvider | null;
      complexityThresholdMedium?: number | null;
      complexityThresholdHigh?: number | null;
      tierLowProvider?: AIProvider | null;
      tierLowFallback?: AIProvider | null;
      tierMediumProvider?: AIProvider | null;
      tierMediumFallback?: AIProvider | null;
      tierHighProvider?: AIProvider | null;
      tierHighFallback?: AIProvider | null;
    }

    export interface EffectiveAiRoutingConfig {
      primaryProviderOverride: AIProvider | null;
      complexityThresholdMedium: number;
      complexityThresholdHigh: number;
      tierLowProvider: AIProvider;
      tierLowFallback: AIProvider | null;
      tierMediumProvider: AIProvider;
      tierMediumFallback: AIProvider | null;
      tierHighProvider: AIProvider;
      tierHighFallback: AIProvider | null;
    }

    export const getGlobalAiRoutingConfig = async (): Promise<EffectiveAiRoutingConfig> => {
      const { data } = await apiClient.get('/ai-routing/config/global');
      return data;
    };

    export const updateGlobalAiRoutingConfig = async (
      payload: AiRoutingConfigPayload,
    ): Promise<EffectiveAiRoutingConfig> => {
      const { data } = await apiClient.put('/ai-routing/config/global', payload);
      return data;
    };

    export const getProjectAiRoutingConfig = async (
      projectId: string,
    ): Promise<AiRoutingConfigPayload> => {
      const { data } = await apiClient.get(`/ai-routing/config/project/${projectId}`);
      return data ?? {};
    };

    export const getEffectiveProjectAiRoutingConfig = async (
      projectId: string,
    ): Promise<EffectiveAiRoutingConfig> => {
      const { data } = await apiClient.get(`/ai-routing/config/project/${projectId}/effective`);
      return data;
    };

    export const updateProjectAiRoutingConfig = async (
      projectId: string,
      payload: AiRoutingConfigPayload,
    ): Promise<AiRoutingConfigPayload> => {
      const { data } = await apiClient.put(`/ai-routing/config/project/${projectId}`, payload);
      return data;
    };

    export const resetProjectAiRoutingConfig = async (projectId: string): Promise<void> => {
      await apiClient.delete(`/ai-routing/config/project/${projectId}`);
    };
    ```

- [ ] Task 2: Create TanStack Query hooks in `dsf-dasbhoard/src/hooks/queries/useAiRoutingConfig.ts` (AC: #1, #5, #7, #8)
  - [ ] Define query keys:
    ```typescript
    export const aiRoutingConfigKeys = {
      global: ['aiRoutingConfig', 'global'] as const,
      projectConfig: (projectId: string) => ['aiRoutingConfig', 'project', projectId] as const,
      projectEffective: (projectId: string) =>
        ['aiRoutingConfig', 'project', projectId, 'effective'] as const,
    };
    ```
  - [ ] `useGlobalAiRoutingConfig()` — `useQuery` calling `getGlobalAiRoutingConfig`, `staleTime: 60_000`
  - [ ] `useProjectAiRoutingConfig(projectId)` — `useQuery` calling `getProjectAiRoutingConfig(projectId)`, enabled when `!!projectId`
  - [ ] `useEffectiveProjectAiRoutingConfig(projectId)` — `useQuery` calling `getEffectiveProjectAiRoutingConfig(projectId)`, enabled when `!!projectId`
  - [ ] `useUpdateGlobalAiRoutingConfig()` — `useMutation` calling `updateGlobalAiRoutingConfig`, invalidates `aiRoutingConfigKeys.global` on success
  - [ ] `useUpdateProjectAiRoutingConfig(projectId)` — `useMutation` calling `updateProjectAiRoutingConfig(projectId, payload)`, invalidates both project keys on success
  - [ ] `useResetProjectAiRoutingConfig(projectId)` — `useMutation` calling `resetProjectAiRoutingConfig(projectId)`, invalidates both project keys on success
  - [ ] **Call signature note:** `useUpdateProjectAiRoutingConfig(projectId)` closes over `projectId`. Call site uses `mutate(payload)` — NOT `mutate({ projectId, payload })`. Example: `const { mutate } = useUpdateProjectAiRoutingConfig(projectId); mutate(payload);`

- [ ] Task 3: Create the shared `ProviderSelect` component in `dsf-dasbhoard/src/components/settings/ProviderSelect.tsx` (AC: #1, #5, #6)
  - [ ] A simple wrapper around shadcn/ui `Select` that renders the four `AIProvider` options with human-readable labels:
    ```
    CLAUDE_CODE → "Claude Code"
    GEMINI      → "Gemini"
    CODEX       → "Codex"
    KIMI        → "Kimi"
    ```
  - [ ] Props: `value: AIProvider | null`, `onChange: (v: AIProvider | null) => void`, `disabled?: boolean`, `placeholder?: string`, `allowNull?: boolean` (when `true`, includes a "Inherit from global" option that maps to `null`)
  - [ ] Use shadcn `Select` + `SelectTrigger` + `SelectContent` + `SelectItem` — follow `ConnectedAppsPanel.tsx` for the pattern if it uses Select, otherwise follow the shadcn/ui usage in the codebase

- [ ] Task 4: Create `GlobalAiRoutingPanel` in `dsf-dasbhoard/src/pages/settings/panels/GlobalAiRoutingPanel.tsx` (AC: #1, #2, #3, #4, #12, #13)
  - [ ] Use `useGlobalAiRoutingConfig()` to load current values
  - [ ] Use `useAuth()` to get `user.role`; if `role !== 'ADMIN'`, render all fields as read-only (no Save button)
  - [ ] Local form state (useState) for all nine fields, initialised from query data via `useEffect`
  - [ ] **Inline validation** before calling save:
    - `complexityThresholdHigh > complexityThresholdMedium` — if not, show inline error, do not call API
    - Both thresholds must be between 1–20
  - [ ] On save: call `useUpdateGlobalAiRoutingConfig().mutate(payload)`, show `toast.success` / `toast.error`
  - [ ] Layout — two `Card` sections:
    - **"Complexity Thresholds"** card: `complexityThresholdMedium` (number input), `complexityThresholdHigh` (number input), `primaryProviderOverride` (ProviderSelect with `allowNull`, placeholder "None — use complexity strategy")
    - **"Provider Tier Mapping"** card: a 3-row table layout — LOW tier (provider + fallback), MEDIUM tier (provider + fallback), HIGH tier (provider + fallback) — each cell is a `ProviderSelect`
  - [ ] Loading state: `Skeleton` placeholders for both cards (match `GeneralSettingsPanel` pattern)
  - [ ] Panel header: icon `Cpu` from lucide-react, title "AI Routing Strategy", subtitle "Configure how tickets are routed to AI providers based on complexity."
  - [ ] Save button: bottom-right, disabled while `isPending` or no changes detected (`hasChanges` check)

- [ ] Task 5: Create `ProjectAiRoutingPanel` in `dsf-dasbhoard/src/pages/settings/panels/ProjectAiRoutingPanel.tsx` (AC: #5, #6, #7, #8, #12, #13)
  - [ ] Use `useParams<{ id: string }>()` to get `projectId`
  - [ ] Load both `useProjectAiRoutingConfig(projectId)` (the override row) and `useEffectiveProjectAiRoutingConfig(projectId)` (merged resolved values)
  - [ ] Form state tracks the project-level overrides only — a field with value `null` means "inherit from global"
  - [ ] **Override indicator**: for each field, if the project row has a non-null value for that field, show a small `Badge` or dot in `primary` colour (e.g. a `•` beside the label). If null (inheriting), show the resolved global value as dimmed placeholder text in the select/input.
  - [ ] `ProviderSelect` fields use `allowNull={true}` with placeholder showing the resolved effective value (e.g. `"Inheriting: Claude Code"`)
  - [ ] On save: call `useUpdateProjectAiRoutingConfig(projectId).mutate(payload)` where `payload` only contains fields that were explicitly set (null for fields the PM wants to inherit)
  - [ ] **Reset to Global** button (destructive variant, bottom-left):
    - On click: show a `window.confirm` or an inline confirmation state asking "Reset all AI routing overrides for this project? It will revert to platform defaults."
    - On confirm: call `useResetProjectAiRoutingConfig(projectId).mutate()`, show `toast.success('Project AI routing reset to global defaults')`
  - [ ] Same two-card layout as `GlobalAiRoutingPanel` (Complexity Thresholds card + Provider Tier Mapping card)
  - [ ] Panel header: icon `Cpu`, title "AI Routing — Project Override", subtitle "Override platform-wide routing settings for this project. Leave fields blank to inherit global defaults."
  - [ ] Loading state: Skeleton placeholders

- [ ] Task 6: Export both panels from `AllPanels.tsx` (AC: #10, #11)
  - [ ] Add to the **very end** of `src/pages/settings/panels/AllPanels.tsx`, after the existing three external re-exports (`PmIntegrationPanel`, `ConnectedAppsPanel`, `GeneralSettingsPanel`). The file contains inline component definitions before the re-exports — append after all existing content:
    ```typescript
    export { GlobalAiRoutingPanel } from './GlobalAiRoutingPanel';
    export { ProjectAiRoutingPanel } from './ProjectAiRoutingPanel';
    ```

- [ ] Task 7: Add "AI Routing" to system settings sidebar nav in `SettingsLayout.tsx` (AC: #10)
  - [ ] Open `src/pages/settings/SettingsLayout.tsx`
  - [ ] Add to the `panels` array (system-level panels, rendered when no `projectId`):
    ```typescript
    { id: 'ai-routing', label: 'AI Routing', icon: Cpu },
    ```
    Place it between `cost` and `audit` — the full array order is: cleanup → self-healing → dependency → auto-merge → **cost → [ai-routing here] →** audit → health → integrations → connected-apps
  - [ ] Import `Cpu` from `lucide-react`
  - [ ] **Note:** the sidebar renders all panels for all users — the `ProtectedRoute` on the route itself handles access control; do not conditionally hide the nav item

- [ ] Task 8: Add "AI Routing" to project settings sidebar nav in `SettingsLayout.tsx` (AC: #11)
  - [ ] In the same file, add to the `projectPanels` array:
    ```typescript
    { id: 'ai-routing', label: 'AI Routing', icon: Cpu },
    ```
    Place it after the `general` entry

- [ ] Task 9: Register routes in `App.tsx` (AC: #1, #5, #9)
  - [ ] Import `GlobalAiRoutingPanel` and `ProjectAiRoutingPanel` from `./pages/settings/panels/AllPanels`
  - [ ] Under the `/settings` route block, add after the `cost` route:
    ```tsx
    <Route
      path="ai-routing"
      handle={{ title: 'Settings: AI Routing — DSF' }}
      element={
        <ProtectedRoute requiredRoles={['ADMIN', 'MANAGER']}>
          <GlobalAiRoutingPanel />
        </ProtectedRoute>
      }
    />
    ```
  - [ ] Under the `/projects/:id/settings` route block, add after the `general` route:
    ```tsx
    <Route
      path="ai-routing"
      handle={{ title: 'Project Settings: AI Routing — DSF' }}
      element={
        <ProtectedRoute requiredRoles={['ADMIN', 'MANAGER', 'PM']}>
          <ProjectAiRoutingPanel />
        </ProtectedRoute>
      }
    />
    ```
  - [ ] **Note on `requiredRoles`:** Existing project settings routes use `['ADMIN', 'PM']` only. Adding `'MANAGER'` here is **intentional** — the backend API grants MANAGER read/write access to project configs (unlike other project settings which are PM-only). Do not "fix" this to match the existing two-role pattern.
  - [ ] **Note:** Do NOT add to the `routeTitles` array in App.tsx. Panel routes use `handle={{ title: '...' }}` directly on the `<Route>` element — this is the established pattern for all settings panels (`cost`, `cleanup`, `audit`, etc.). The `routeTitles` array is only for non-panel routes.

- [ ] Task 10: Final verification (AC: #1–#13)
  - [ ] `pnpm typecheck` in `dsf-dasbhoard` → zero errors
  - [ ] `pnpm lint` → zero errors
  - [ ] Manual smoke test: ADMIN can open `/settings/ai-routing`, change a threshold, save → success toast
  - [ ] Manual smoke test: MANAGER opens `/settings/ai-routing` → all fields read-only, no Save button
  - [ ] Manual smoke test: PM opens `/projects/:id/settings/ai-routing` → can override one field, save, see override indicator; can reset to global

## Dev Notes

### Repo

All frontend changes are in `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`. Run `pnpm dev` from that directory.

### Canonical Pattern — GeneralSettingsPanel (`src/pages/settings/panels/GeneralSettingsPanel.tsx`)

This is the canonical panel model. Follow it exactly:

```typescript
// IMPORTS — exact packages used in this codebase
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast'; // NOT sonner, NOT toast-ui
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext'; // for role checks

// PATTERN — useQuery to load, useEffect to seed local state
const { data, isLoading } = useQuery({ queryKey: [...], queryFn: ... });
useEffect(() => {
  if (data) setLocalState({ field1: data.field1, ... });
}, [data]);

// PATTERN — useMutation with invalidation
const queryClient = useQueryClient();
const { mutate, isPending } = useMutation({
  mutationFn: (payload) => updateFn(payload),
  onSuccess: () => {
    toast.success('Saved successfully');
    queryClient.invalidateQueries({ queryKey: [...] });
  },
  onError: (err: any) => {
    toast.error(err?.response?.data?.message ?? 'Failed to save');
  },
});

// PATTERN — hasChanges guard (field-by-field, NOT JSON.stringify — matches codebase pattern)
const hasChanges =
  data != null &&
  (localState.complexityThresholdMedium !== data.complexityThresholdMedium ||
   localState.complexityThresholdHigh !== data.complexityThresholdHigh ||
   localState.primaryProviderOverride !== data.primaryProviderOverride ||
   localState.tierLowProvider !== data.tierLowProvider ||
   // ... repeat for all 9 fields);
// Do NOT use JSON.stringify — null/undefined key differences can cause false positives

// PATTERN — loading skeleton (match exactly)
if (isLoading) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
```

### Auth / Role Check

```typescript
import { useAuth } from '@/contexts/AuthContext';
const { user } = useAuth();
const isAdmin = user?.role === 'ADMIN';
// GlobalAiRoutingPanel: read-only when role !== 'ADMIN'
// Show info banner for non-ADMIN, hide Save button
```

### SettingsLayout — Panel Arrays

`src/pages/settings/SettingsLayout.tsx` has two arrays:

- `panels` — system-level, rendered when no `projectId` param → add `{ id: 'ai-routing', label: 'AI Routing', icon: Cpu }` after `cost` entry
- `projectPanels` — project-specific, rendered when `projectId` is set → add after `general` entry
- `Cpu` must be imported from `lucide-react`

### App.tsx Route Registration

The settings routes are nested under `<Route path="settings" element={<SettingsLayout />}>`. Add after the `cost` child route for system settings and after `general` for project settings. Route `handle={{ title: '...' }}` is used for page title metadata — it must be included.

### useHook Pattern for `useAiRoutingConfig.ts`

Follow `src/hooks/queries/useSystemConfig.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// Each hook is a named export
export function useGlobalAiRoutingConfig() {
  return useQuery({
    queryKey: aiRoutingConfigKeys.global,
    queryFn: getGlobalAiRoutingConfig,
    staleTime: 60_000,
  });
}
export function useUpdateGlobalAiRoutingConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AiRoutingConfigPayload) => updateGlobalAiRoutingConfig(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiRoutingConfigKeys.global }),
  });
}
```

### ProviderSelect — shadcn/ui Select Pattern

Use `Select` from `@/components/ui/select`:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// When allowNull=true, add a "Inherit from global" item mapped to empty string sentinel
// then convert '' → null on onChange
```

### GlobalAiRoutingPanel — Read-Only Mode for MANAGER

```tsx
{
  user?.role !== 'ADMIN' && (
    <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg text-sm text-muted-foreground mb-4">
      <Info className="w-4 h-4 shrink-0" />
      View only. Contact an Admin to change global routing settings.
    </div>
  );
}
```

- Import `Info` from `lucide-react`
- Disable all `Input` and `Select` when `user?.role !== 'ADMIN'`
- Hide Save `Button` when `user?.role !== 'ADMIN'`

### Threshold Input Validation Detail

```typescript
const validate = (fields: FormState): string | null => {
  if (fields.complexityThresholdHigh <= fields.complexityThresholdMedium) {
    return 'High threshold must be greater than Medium threshold';
  }
  if (fields.complexityThresholdMedium < 1 || fields.complexityThresholdHigh > 20) {
    return 'Thresholds must be between 1 and 20';
  }
  return null;
};
```

Show the error string below the threshold inputs in `text-destructive text-xs`. Clear it when the user changes either field.

### Override Indicator Design (ProjectAiRoutingPanel)

```tsx
<Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
  Low Complexity Provider
  {projectConfig?.tierLowProvider != null && (
    <span
      className="inline-block w-2 h-2 rounded-full bg-primary"
      title="Project override active"
    />
  )}
</Label>
```

### "Inherit from Global" Placeholder Text

```tsx
<ProviderSelect
  value={localState.tierLowProvider} // null if not overridden
  onChange={(v) => setLocalState((s) => ({ ...s, tierLowProvider: v }))}
  allowNull
  placeholder={`Inheriting: ${providerLabel(effectiveConfig?.tierLowProvider)}`}
/>
```

Where `providerLabel` maps `AIProvider` → human name (CLAUDE_CODE → "Claude Code", etc.).

### Reset to Global — Use `window.confirm`

```typescript
const handleReset = async () => {
  if (
    !window.confirm(
      'Reset all AI routing overrides for this project? It will revert to platform defaults.',
    )
  )
    return;
  resetMutation.mutate();
};
```

### API Base Path

`apiClient` has `baseURL = VITE_API_BASE_URL + '/api/v1'`. Use paths WITHOUT `/api/v1` prefix, e.g. `/ai-routing/config/global`.

### Import Aliases — CRITICAL

Always use `@/` aliases. NEVER use relative paths like `../../hooks/...`. Examples:

- `@/api/aiRoutingConfigApi` ✅ — NOT `../../../api/aiRoutingConfigApi` ❌
- `@/components/ui/card` ✅
- `@/hooks/queries/useAiRoutingConfig` ✅
- `@/contexts/AuthContext` ✅

### Files Created / Modified

| File                                                  | Repo          | Change                       |
| ----------------------------------------------------- | ------------- | ---------------------------- |
| `src/api/aiRoutingConfigApi.ts`                       | dsf-dasbhoard | New                          |
| `src/hooks/queries/useAiRoutingConfig.ts`             | dsf-dasbhoard | New                          |
| `src/components/settings/ProviderSelect.tsx`          | dsf-dasbhoard | New                          |
| `src/pages/settings/panels/GlobalAiRoutingPanel.tsx`  | dsf-dasbhoard | New                          |
| `src/pages/settings/panels/ProjectAiRoutingPanel.tsx` | dsf-dasbhoard | New                          |
| `src/pages/settings/panels/AllPanels.tsx`             | dsf-dasbhoard | Add exports                  |
| `src/pages/settings/SettingsLayout.tsx`               | dsf-dasbhoard | Add nav items + `Cpu` import |
| `src/App.tsx`                                         | dsf-dasbhoard | Add two routes + routeTitle  |

No backend changes (OS-4.5 delivered the API). No new Prisma changes.

### Previous Story (OS-4.5) — Backend API Contract

OS-4.5 added the `AiRoutingConfig` Prisma model and REST API. Key points for the UI:

- Global config returns `EffectiveAiRoutingConfig` (non-nullable resolved values with hardcoded fallbacks)
- Project config (`GET /ai-routing/config/project/:id`) returns nullable fields (`AiRoutingConfigPayload`) — a fresh project with no overrides returns `{}`
- The effective endpoint (`GET .../effective`) merges global + project, always returns full non-nullable object
- `AIProvider` enum values: `CLAUDE_CODE`, `GEMINI`, `CODEX`, `KIMI` (exactly these strings)
- Backend `AIProvider` enum matches the TypeScript union type in `aiRoutingConfigApi.ts`

### Scope Boundaries — What NOT to Do

- **Do NOT** add a live "preview" of what tickets would route to — out of scope
- **Do NOT** add per-field history/audit trail — out of scope
- **Do NOT** use a form library (React Hook Form / Zod) — use plain useState, follow GeneralSettingsPanel
- **Do NOT** add tests in this story — UI smoke testing is manual per Task 10
- **Do NOT** modify any existing panels — only add new ones and extend `SettingsLayout` + `App.tsx`
- **Do NOT** use relative imports — always `@/` aliases

### References

- `GeneralSettingsPanel` (canonical panel pattern): `src/pages/settings/panels/GeneralSettingsPanel.tsx`
- `AllPanels.tsx` (export barrel + existing panels): `src/pages/settings/panels/AllPanels.tsx`
- `SettingsLayout.tsx` (sidebar + dual panel arrays): `src/pages/settings/SettingsLayout.tsx`
- `App.tsx` (route registration patterns): `src/App.tsx:461–470`
- `useSystemConfig` hook (query/mutation pattern): `src/hooks/queries/useSystemConfig.ts`
- `AuthContext` / `useAuth` (role check): `src/contexts/AuthContext.tsx`
- OS-4.5 story (backend API contract): `_bmad-output/implementation-artifacts/os-4-5-ai-routing-config-global-and-project-overrides.md`

### Review Findings

- [x] [Review][Decision] Project route `requiredRoles` uses `['ADMIN', 'PM']` — resolved: changed to explicit `['ADMIN', 'MANAGER', 'PM']` per spec [App.tsx: project ai-routing route]

- [x] [Review][Patch] MANAGER blocked from `/settings/ai-routing` by `requiredRoles={['ADMIN']}` — fixed: changed to `['ADMIN', 'MANAGER']` [src/App.tsx: system ai-routing route]
- [x] [Review][Patch] `SettingsLayout.tsx` system `panels` array: `ai-routing` appended at END of array, spec says place it after `cost` entry — fixed [src/pages/settings/SettingsLayout.tsx]
- [x] [Review][Patch] `AllPanels.tsx` new exports placed mid-file (line 7-8, after `PmIntegrationPanel`), spec says append at the very end — fixed [src/pages/settings/panels/AllPanels.tsx]
- [x] [Review][Patch] `useUpdateGlobalAiRoutingConfig` does not invalidate per-project effective cache — fixed: added prefix invalidation for `['aiRoutingConfig', 'project']` [src/hooks/queries/useAiRoutingConfig.ts]
- [x] [Review][Patch] Reset button text says "platform defaults" but success toast says "global defaults" — fixed: confirm dialog now uses "global defaults" [src/pages/settings/panels/ProjectAiRoutingPanel.tsx]
- [x] [Review][Patch] Project validation falls back to `0` when both thresholds null and effectiveConfig undefined — fixed: added early return when both fields are null (inheriting) [src/pages/settings/panels/ProjectAiRoutingPanel.tsx]
- [x] [Review][Patch] `ProviderSelect` with `allowNull=false` when `value` is `null`: unmatched controlled value — fixed: use `undefined` instead of `''` when allowNull=false and value is null [src/components/settings/ProviderSelect.tsx]

- [x] [Review][Defer] No automated tests — deferred, pre-existing: spec explicitly excludes tests in this story (Task 10 is manual smoke test only)
- [x] [Review][Defer] `parseInt` without explicit radix `10` on number inputs — deferred, pre-existing: low-risk for numeric-type inputs; consistent with codebase
- [x] [Review][Defer] Ad-hoc error shape `{ response?: { data?: { message?: string } } }` instead of `AxiosError` — deferred, pre-existing: matches existing pattern across all other settings panels
- [x] [Review][Defer] `useEffect` with `eslint-disable react-hooks/set-state-in-effect` suppression — deferred, pre-existing: canonical pattern from `GeneralSettingsPanel` which this code intentionally mirrors
- [x] [Review][Defer] `getProjectAiRoutingConfig` returns `data ?? {}` conflating empty HTTP response with "no overrides" — deferred, pre-existing: low impact, handles 204/empty body gracefully
- [x] [Review][Defer] Save button positioned under second card, not after first — deferred, pre-existing: UX decision, not a functional defect; consistent with table layout pattern
- [x] [Review][Defer] Relative imports in `App.tsx` (e.g. `'./pages/settings/panels/AllPanels'`) violate dev notes "always `@/`" — deferred, pre-existing: App.tsx already used relative imports throughout; dev notes restriction applied to new files only
- [x] [Review][Defer] Tier primary `ProviderSelect` silently ignores `null` via `v && setForm(...)` — deferred, pre-existing: intentional — global tier primaries are required (non-nullable), silent guard is correct behavior

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
