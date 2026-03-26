# Story OS-4.6-UI: AI Routing Configuration — Settings UI Panels

Status: active

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
    import apiClient from './client';

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
  - [ ] Add to the bottom of `src/pages/settings/panels/AllPanels.tsx`:
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
    Place it after the `cost` entry (logical grouping with cost/model settings)
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
  - [ ] Add `'/settings/ai-routing'` to the `routeTitles` map: `['/settings/ai-routing', 'Settings: AI Routing — DSF']`

- [ ] Task 10: Final verification (AC: #1–#13)
  - [ ] `pnpm typecheck` in `dsf-dasbhoard` → zero errors
  - [ ] `pnpm lint` → zero errors
  - [ ] Manual smoke test: ADMIN can open `/settings/ai-routing`, change a threshold, save → success toast
  - [ ] Manual smoke test: MANAGER opens `/settings/ai-routing` → all fields read-only, no Save button
  - [ ] Manual smoke test: PM opens `/projects/:id/settings/ai-routing` → can override one field, save, see override indicator; can reset to global

## Dev Notes

### Repo

All frontend changes are in `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`. Run `pnpm dev` from that directory.

### Existing Pattern to Follow

`GeneralSettingsPanel` (`src/pages/settings/panels/GeneralSettingsPanel.tsx`) is the canonical model for project-level settings panels:

- `useParams` to get `projectId`
- `useQuery` + `useEffect` to seed local state
- `useMutation` for save
- `hasChanges` guard on Save button
- `toast.success` / `toast.error`
- shadcn `Card` / `CardHeader` / `CardContent` / `Input` / `Button` / `Skeleton`

Follow this pattern exactly. Do not invent new patterns.

### ProviderSelect: Lucide Icon Pairing (Optional Visual Polish)

If you want to add small provider icons, map `AIProvider` to a colour class:

```
CLAUDE_CODE → text-orange-500
GEMINI      → text-blue-500
CODEX       → text-green-500
KIMI        → text-purple-500
```

This is optional — keep it out of scope if it adds complexity.

### Override Indicator Design

For `ProjectAiRoutingPanel`, the override indicator should be minimal. A small coloured dot or a `Badge variant="secondary"` reading "Override" beside the field label is sufficient. Do not build a complex diff UI.

Example:

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

### `window.confirm` vs Inline Confirmation for Reset

Use `window.confirm` for the "Reset to Global" action. This is the simplest approach and consistent with other destructive actions in the codebase. A full confirmation modal is out of scope for this story.

### "Inherit from Global" Placeholder Text

When a project field is `null`, the `ProviderSelect` should show the resolved effective value as placeholder, not just "Select...". Derive this from `useEffectiveProjectAiRoutingConfig`:

```tsx
<ProviderSelect
  value={localState.tierLowProvider} // null if not overridden
  onChange={(v) => setLocalState((s) => ({ ...s, tierLowProvider: v }))}
  allowNull
  placeholder={`Inheriting: ${providerLabel(effectiveConfig?.tierLowProvider)}`}
/>
```

Where `providerLabel` maps `AIProvider` → human name.

### Read-Only Mode in GlobalAiRoutingPanel

For MANAGER read-only mode, disable all inputs and selects and hide the Save button. Use the `disabled` prop on `Input`/`Select`. Add a subtle info banner:

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

### API Base Path

All API calls go through `apiClient` which has `baseURL = VITE_API_BASE_URL + '/api/v1'` (set in `src/api/client.ts`). Use paths without the `/api/v1` prefix (e.g. `/ai-routing/config/global`).

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

Always use `@/` import aliases — never relative paths.

### Scope Boundaries — What NOT to Do

- **Do NOT** add a live "preview" of what tickets would route to — out of scope
- **Do NOT** add per-field history/audit trail — out of scope
- **Do NOT** use a form library (React Hook Form / Zod) — the existing panels use plain useState, follow that pattern
- **Do NOT** add tests in this story — the backend has unit test coverage; UI smoke testing is manual per Task 10
- **Do NOT** modify any existing panels — only add new ones and extend `SettingsLayout` + `App.tsx`

### References

- `GeneralSettingsPanel` (panel pattern): `src/pages/settings/panels/GeneralSettingsPanel.tsx`
- `AllPanels.tsx` (export barrel + existing panels): `src/pages/settings/panels/AllPanels.tsx`
- `SettingsLayout.tsx` (sidebar + dual panel arrays): `src/pages/settings/SettingsLayout.tsx`
- `App.tsx` (route registration patterns): `src/App.tsx:461–470`
- `useSystemConfig` hook (query/mutation pattern): `src/hooks/queries/useSystemConfig.ts`
- `AuthContext` / `useAuth` (role check): `src/contexts/AuthContext.tsx`
- OS-4.5 story (backend API contract): `_bmad-output/implementation-artifacts/os-4-5-ai-routing-config-global-and-project-overrides.md`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Review Findings
