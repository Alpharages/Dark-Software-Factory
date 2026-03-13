# Story CS1.4: Project Settings — Live Status Picker

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM or Admin**,
I want to pick my team's AI trigger status from a live dropdown of my PM tool's actual workflow statuses,
so that any custom workflow is supported without typing or DevOps changes.

## Acceptance Criteria

### AC1 — Backend: `container_id` exposed in `SyncConfigResponseDto`

- `SyncConfigResponseDto` at `src/projects/dto/sync-config-response.dto.ts` (created by CS1-3) is extended to include `container_id: string | null`
- `toSyncConfigResponse()` reads `container_id` from: `typeof (integration.provider_config as Record<string, unknown>)?.containerId === 'string' ? ... : null`
- `@ApiProperty({ nullable: true })` added for the new field

### AC2 — Backend: `UpdateSyncConfigDto` accepts optional `container_id`

- `UpdateSyncConfigDto` at `src/projects/dto/update-sync-config.dto.ts` (created by CS1-3) is extended with `container_id?: string | null`
- Uses the same null-safe `@Transform` pattern as `ai_trigger_status`: `@Transform(({ value }) => (value === '' ? null : value))`
- Decorators: `@ApiPropertyOptional({ nullable: true })`, `@Transform`, `@IsOptional()`, `@IsString()`, `@MinLength(1)`

### AC3 — Backend: `PATCH /projects/:id/integration/sync-config` merges `container_id` into `provider_config`

- When `dto.container_id !== undefined` (PM is setting or clearing the list ID):
  - Read `integration.provider_config` (already fetched by `findByProjectAndProvider()`)
  - Merge: `{ ...(integration.provider_config as Record<string, unknown> ?? {}), containerId: dto.container_id }`
  - Pass merged value to `updateIntegration()` as `provider_config`
- When `dto.container_id` is `undefined` (not sent by client): `provider_config` is left unchanged
- Returned `SyncConfigResponseDto` includes the updated `container_id`

### AC4 — Frontend: New API functions added to `integrationsApi.ts`

New types and functions added to `dsf-dasbhoard/src/api/integrationsApi.ts`:

```typescript
export interface NormalizedStatus {
  id: string; // ClickUp: status name used as ID (e.g., "in progress")
  name: string; // Display name (e.g., "In Progress")
  color: string | null;
  type: 'todo' | 'in_progress' | 'done' | 'cancelled' | 'other'; // Backend NormalizedStatusType enum values are lowercase
}

export interface SyncConfigResponse {
  id: string;
  provider: string;
  ai_trigger_status: string | null;
  container_id: string | null;
  polling_enabled: boolean;
  polling_interval_min: number;
  webhook_enabled: boolean;
  webhook_id: string | null;
}

export interface UpdateSyncConfig {
  ai_trigger_status?: string | null;
  container_id?: string | null;
}
```

- `getIntegrationStatuses(integrationId, containerId)` → `GET /integrations/:integrationId/statuses?containerId=X`
- `getSyncConfig(projectId)` → `GET /projects/:projectId/integration/sync-config`
- `updateSyncConfig(projectId, data)` → `PATCH /projects/:projectId/integration/sync-config`

### AC5 — Frontend: `StatusConfigSection` component

A new module-scoped `StatusConfigSection` component (matching the `SyncSettingsSection` pattern) is added to `PmIntegrationPanel.tsx`:

- Props: `integration: PmIntegration; projectId: string`
- Loads current sync config via `useQuery(['pm-sync-config', projectId], () => getSyncConfig(projectId), { staleTime: 60_000, enabled: !!projectId })`
- On config load: initialises `listId` state from `syncConfig.container_id ?? ''` and `selectedStatus` from `syncConfig.ai_trigger_status ?? ''` via `useEffect`
- **Warning alert:** Shown when `syncConfig?.ai_trigger_status` is null — "No trigger status set — all incoming tasks will be skipped until configured" (`AlertTriangle` icon, warning styling matching other alerts in the file)
- **List ID subsection:**
  - Label: "ClickUp List ID"
  - Helper text: "Find this in your ClickUp list URL"
  - `Input` component pre-filled from `syncConfig?.container_id`
  - `onChange` resets `shouldFetchStatuses` to `false` (prevents stale dropdown on ID change)
  - "Load Statuses" `Button` (outline, sm) with `RefreshCw` icon; shows `Loader2` while loading
  - If list ID is empty when "Load Statuses" is clicked: `toast.error('Enter a ClickUp list ID first')` — do NOT fire the query
- **Statuses query:** `useQuery(['pm-statuses', integration.id, listId], () => getIntegrationStatuses(integration.id, listId), { enabled: shouldFetchStatuses && !!listId, staleTime: 300_000 })`
  - `shouldFetchStatuses` is set to `true` only when "Load Statuses" is clicked
  - On fetch error: `Alert` with `AlertTriangle` — "Could not load statuses — check your connection settings"
- **Status dropdown:**
  - `Select` component; disabled until `statuses` is loaded (`!statuses`)
  - Placeholder: "Select trigger status..."
  - Each `SelectItem` shows a small color dot (`w-2.5 h-2.5 rounded-full` with inline `style={{ backgroundColor: status.color }}`) + `status.name`
  - If `status.color` is null, omit the dot
- **Save button:**
  - `useMutation` → calls `updateSyncConfig(projectId, { ai_trigger_status: selectedStatus || null, container_id: listId || null })`
  - `onMutate`: cancel queries, optimistic update to `['pm-sync-config', projectId]`, return rollback snapshot
  - `onError`: rollback + `toast.error('Failed to update trigger status')`
  - `onSuccess`: `queryClient.invalidateQueries({ queryKey: ['pm-sync-config', projectId] })` + `toast.success('AI trigger status updated')`

### AC6 — Frontend: `StatusConfigSection` integrated into connected provider card

- In `renderProviderCard()`, after `<SyncSettingsSection integration={integration} projectId={projectId!} />`, add:
  - A divider (`border-t border-[var(--card-border)]`) + flex row with `Zap` icon + "AI Trigger Status" label
  - `<StatusConfigSection integration={integration} projectId={projectId!} />`
- Only rendered for `provider.id === 'CLICKUP'` — Jira/Asana show "Coming Soon" so this block is never reached for them anyway, but guard explicitly for correctness. When Jira/Asana support is added (future epics), a `StatusConfigSection` variant will be added here per provider.

### AC7 — Frontend: Vitest tests

- **MODIFY** `dsf-dasbhoard/__tests__/pages/PmIntegrationPanel.test.tsx` — file already exists with `SyncSettingsSection` tests; add a new `describe('StatusConfigSection', ...)` block. Do NOT remove or alter existing tests.
- Mock `@/api/integrationsApi` with `vi.mock()` (already mocked in the file for existing tests)
- Mock `react-hot-toast`: `vi.mock('react-hot-toast', () => ({ default: { toast: {} }, toast: { success: vi.fn(), error: vi.fn() } }))`
- At minimum, add these test cases:
  - `StatusConfigSection` renders "Load Statuses" button
  - Clicking "Load Statuses" with empty list ID calls `toast.error('Enter a ClickUp list ID first')` and does not call `getIntegrationStatuses`
  - After successful statuses load, `Select` becomes enabled and shows status options
  - "Load Statuses" button shows `Loader2` spinner (disabled state) while `statusesLoading` is true
  - Error state Alert renders with "Could not load statuses" text on `getIntegrationStatuses` rejection
  - Warning Alert renders when `getSyncConfig` returns `ai_trigger_status: null`
  - Save button calls `updateSyncConfig` with `{ ai_trigger_status: 'In Review', container_id: '123' }`
  - `toast.success('AI trigger status updated')` called on save success
  - On save error, `toast.error('Failed to update trigger status')` is called and cache snapshot is restored

### AC8 — TypeScript clean

- Backend: `pnpm typecheck` zero errors; `pnpm lint` zero warnings/errors; `pnpm test` all pass
- Frontend: `pnpm build` zero type errors; `pnpm lint` zero warnings/errors; `pnpm test` all pass

## Tasks / Subtasks

- [x] Task 1: Extend `SyncConfigResponseDto` to include `container_id` (AC1)
  - [x] Add `container_id: string | null` with `@ApiProperty({ nullable: true })`
  - [x] Update `toSyncConfigResponse()` to read from `provider_config.containerId`
- [x] Task 2: Extend `UpdateSyncConfigDto` with `container_id` (AC2)
  - [x] Add `container_id?: string | null` with `@IsOptional()` + `@IsString()` + `@MinLength(1)` (Note: `@Transform` intentionally omitted per CS1-3 review decision — empty string enforces 400)
  - [x] Add `@ApiPropertyOptional({ nullable: true })`
- [x] Task 3: Update `PATCH /projects/:id/integration/sync-config` controller handler (AC3)
  - [x] Add `provider_config` merge logic for `dto.container_id !== undefined`
  - [x] Verify CS1-3 added `Prisma` and `IntegrationProvider` to the `@prisma/client` import in `project.controller.ts` — confirmed present
  - [x] Add `container_id` tests to `src/projects/project.controller.spec.ts`
- [x] Task 4: Add API functions to `dsf-dasbhoard/src/api/integrationsApi.ts` (AC4)
  - [x] Add `NormalizedStatus`, `SyncConfigResponse`, `UpdateSyncConfig` interfaces
  - [x] Implement `getIntegrationStatuses(integrationId, containerId)`
  - [x] Implement `getSyncConfig(projectId)`
  - [x] Implement `updateSyncConfig(projectId, data)`
- [x] Task 5: Implement `StatusConfigSection` component (AC5)
  - [x] `useQuery` for sync config with `['pm-sync-config', projectId]` key
  - [x] `useEffect` to init `listId` + `selectedStatus` from sync config
  - [x] Warning Alert when `ai_trigger_status` is null
  - [x] List ID `Input` + `handleListIdChange` that resets `shouldFetchStatuses`
  - [x] "Load Statuses" `Button` with `shouldFetchStatuses` trigger + empty-ID guard
  - [x] Statuses `useQuery` with `shouldFetchStatuses && !!listId` enabled guard
  - [x] Error Alert for statuses fetch failure
  - [x] Status `Select` with color dot + name in each `SelectItem`
  - [x] Save `useMutation` with optimistic update + toast feedback
- [x] Task 6: Integrate `StatusConfigSection` into `renderProviderCard()` (AC6)
  - [x] Update React import: `import React, { useState, useEffect, useRef }` (consolidated to single import statement)
  - [x] Add `getSyncConfig`, `updateSyncConfig`, `getIntegrationStatuses`, `SyncConfigResponse`, `UpdateSyncConfig` to the import from `@/api/integrationsApi`
  - [x] Add divider heading row + `<StatusConfigSection>` inside connected CLICKUP card
- [x] Task 7: MODIFY existing `dsf-dasbhoard/__tests__/pages/PmIntegrationPanel.test.tsx` — add `StatusConfigSection` tests (AC7)
  - [x] Existing `SyncSettingsSection` tests preserved
  - [x] Add `vi.mock('react-hot-toast', ...)`
  - [x] "Load Statuses" with empty ID → `toast.error`, no API call
  - [x] Successful statuses load → Select enabled with options
  - [x] Loading state → "Load Statuses" button disabled
  - [x] API error → "Could not load statuses" Alert renders
  - [x] `ai_trigger_status: null` from getSyncConfig → warning Alert renders
  - [x] Save → `updateSyncConfig` called with correct payload
  - [x] Save success → `toast.success` called
  - [x] Save error → `toast.error` called, cache snapshot restored
- [ ] Task 8: Verify build (AC8)
  - [ ] Backend: `pnpm typecheck`, `pnpm lint`, `pnpm test` — all pass
  - [ ] Frontend: `pnpm build`, `pnpm lint`, `pnpm test` — all pass

## Dev Notes

### Dependency: CS1-3 and CS1-2 Must Land First

**CS1-3 (required):** Creates `SyncConfigResponseDto`, `UpdateSyncConfigDto`, and the `PATCH /projects/:id/integration/sync-config` + `GET /projects/:id/integration/sync-config` handlers. CS1-4 **extends** these files and endpoint — implement CS1-3 first.

**CS1-2 (required for E2E):** Creates `PMStatusService` and `GET /api/v1/integrations/:id/statuses`. Frontend can be implemented with mocked API calls; full E2E requires CS1-2.

**CS1-1 (no dependency):** Removes hardcoded status maps from the consumer. No impact on CS1-4.

### Endpoint Path Note — Deviation from Epic Spec

The Epic CS1.4 spec (line 619) originally specifies `PATCH /api/v1/integrations/{integrationId}` for saving `ai_trigger_status`. CS1-3 intentionally deviated to a **project-scoped** endpoint `PATCH /api/v1/projects/:id/integration/sync-config` because the frontend always has `projectId` in context (from `useParams`), not the integration UUID. **Use the CS1-3 path** — do not implement a separate `PATCH /integrations/:id` endpoint for this story.

### Backend: Extending `SyncConfigResponseDto`

File: `src/projects/dto/sync-config-response.dto.ts` (created by CS1-3). Add the `container_id` field:

```typescript
export class SyncConfigResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty({ nullable: true }) ai_trigger_status!: string | null;
  @ApiProperty({ nullable: true }) container_id!: string | null; // NEW in CS1-4
  @ApiProperty() polling_enabled!: boolean;
  @ApiProperty() polling_interval_min!: number;
  @ApiProperty() webhook_enabled!: boolean;
  @ApiProperty({ nullable: true }) webhook_id!: string | null;
}

export function toSyncConfigResponse(i: ProjectIntegration): SyncConfigResponseDto {
  const cfg = (i.provider_config as Record<string, unknown>) ?? {};
  return {
    id: i.id,
    provider: String(i.provider),
    ai_trigger_status: i.ai_trigger_status,
    container_id: typeof cfg.containerId === 'string' ? cfg.containerId : null, // NEW
    polling_enabled: i.polling_enabled,
    polling_interval_min: i.polling_interval_min,
    webhook_enabled: i.webhook_enabled,
    webhook_id: i.webhook_id ?? null,
  };
}
```

`provider_config` is typed as `Json` in Prisma. Cast to `Record<string, unknown>` for safe key access. TypeScript strict mode requires the `typeof ... === 'string'` guard — do not use `as string`.

### Backend: Extending `UpdateSyncConfigDto`

File: `src/projects/dto/update-sync-config.dto.ts` (created by CS1-3). The existing `ai_trigger_status` uses `@Transform`. Mirror that pattern exactly:

```typescript
@ApiPropertyOptional({
  description: 'Container ID (e.g., ClickUp list ID) used to fetch live statuses. Pass null to clear.',
  example: '901234567',
  nullable: true,
})
@Transform(({ value }) => (value === '' ? null : value))
@IsOptional()
@IsString()
@MinLength(1, { message: 'container_id must be a non-empty string or null' })
container_id?: string | null;
```

`@Transform` converts empty string `""` to `null`. `@IsOptional()` allows `null` and `undefined` to skip further validation. `@MinLength(1)` ensures a non-null string is not empty.

### Backend: `PATCH sync-config` Controller — `provider_config` Merge

File: `src/projects/project.controller.ts` — update the `patchSyncConfig` handler created in CS1-3.

The existing handler calls `findByProjectAndProvider()` to get `integration` before updating — use that same `integration` object to read the current `provider_config`:

```typescript
async patchSyncConfig(
  @Param('id') id: string,
  @Body() dto: UpdateSyncConfigDto,
): Promise<SyncConfigResponseDto> {
  const integration = await this.integrationService.findByProjectAndProvider(
    id, IntegrationProvider.CLICKUP,
  );
  if (!integration) {
    throw new NotFoundException(`No CLICKUP integration found for project ${id}`);
  }

  // Build update payload dynamically — only include defined fields
  const updatePayload: Prisma.ProjectIntegrationUncheckedUpdateInput = {};

  if (dto.ai_trigger_status !== undefined) {
    updatePayload.ai_trigger_status = dto.ai_trigger_status;
  }

  if (dto.container_id !== undefined) {
    const existingCfg = (integration.provider_config as Record<string, unknown>) ?? {};
    updatePayload.provider_config = {
      ...existingCfg,
      containerId: dto.container_id,
    } as Prisma.InputJsonValue;
  }

  const updated = await this.integrationService.updateIntegration(
    integration.id, updatePayload,
  );
  return toSyncConfigResponse(updated);
}
```

`Prisma` and `IntegrationProvider` must be imported from `@prisma/client`. CS1-3 is responsible for adding these imports — verify they exist before starting CS1-4 work. The current `project.controller.ts` has neither import. If CS1-3 hasn't added them yet, add: `import { ..., Prisma, IntegrationProvider } from '@prisma/client';`

### Backend: New Tests for `project.controller.spec.ts`

Add to the existing `patchSyncConfig` describe block:

```typescript
// container_id: provided → merged into provider_config
it('should merge container_id into provider_config', async () => {
  mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
    id: 'int-1',
    provider_config: { existingKey: 'value' },
    ai_trigger_status: null,
  });
  mockIntegrationService.updateIntegration.mockResolvedValue({
    id: 'int-1',
    provider: 'CLICKUP',
    ai_trigger_status: null,
    provider_config: { existingKey: 'value', containerId: '123' },
    polling_enabled: false,
    polling_interval_min: 15,
    webhook_enabled: false,
    webhook_id: null,
  });

  const result = await controller.patchSyncConfig('project-1', { container_id: '123' });
  expect(result.container_id).toBe('123');
  expect(mockIntegrationService.updateIntegration).toHaveBeenCalledWith(
    'int-1',
    expect.objectContaining({
      provider_config: { existingKey: 'value', containerId: '123' },
    }),
  );
});

// container_id: undefined → provider_config unchanged
it('should not touch provider_config when container_id is undefined', async () => {
  // ... mock with existing provider_config
  // Verify updateIntegration called WITHOUT provider_config key
});
```

### Frontend: Component Architecture in `PmIntegrationPanel.tsx`

`StatusConfigSection` is a module-scoped component defined AFTER `SyncSettingsSection` (around line 213). It follows the same pattern: module-level function component, receives `integration` and `projectId` as props, owns its own query + mutation state.

**Separate query keys:**

- `['pm-integrations', projectId]` → `getPmIntegrations()` → `PmIntegration[]` (existing)
- `['pm-sync-config', projectId]` → `getSyncConfig()` → `SyncConfigResponse` (NEW in CS1-4)
- `['pm-statuses', integration.id, listId]` → `getIntegrationStatuses()` → `NormalizedStatus[]` (NEW in CS1-4)

Do NOT merge these. The `pm-integrations` query returns polling/webhook config in `PmIntegration` shape; `pm-sync-config` returns trigger status + container_id in `SyncConfigResponse` shape.

**Do NOT invalidate `['pm-integrations', projectId]` after a `StatusConfigSection` save.** That cache holds `PmIntegration[]` (polling/webhook fields only) and is unaffected by `ai_trigger_status` or `container_id` changes. Invalidating it would trigger a needless network request and re-render of the whole panel.

### Frontend: Manual Fetch Trigger Pattern

The `shouldFetchStatuses` boolean + `enabled` guard prevents fetching until the user clicks "Load Statuses":

```typescript
const [shouldFetchStatuses, setShouldFetchStatuses] = useState(false);

const {
  data: statuses,
  isLoading: statusesLoading,
  isError: statusesError,
} = useQuery({
  queryKey: ['pm-statuses', integration.id, listId],
  queryFn: () => getIntegrationStatuses(integration.id, listId),
  enabled: shouldFetchStatuses && !!listId,
  staleTime: 300_000,
});

// Reset when list ID changes — prevents stale dropdown
const handleListIdChange = (value: string) => {
  setListId(value);
  setShouldFetchStatuses(false);
};

const handleLoadStatuses = () => {
  if (!listId.trim()) {
    toast.error('Enter a ClickUp list ID first');
    return;
  }
  setShouldFetchStatuses(true);
};
```

When `shouldFetchStatuses` is `true` and `listId` changes (e.g., from the `useEffect` initializer), React Query will refetch automatically because the `queryKey` changes. This is correct behavior.

### Frontend: Status Color Dot in Select

```tsx
<SelectContent>
  {statuses?.map((status) => (
    <SelectItem key={status.id} value={status.name}>
      <div className="flex items-center gap-2">
        {status.color && (
          <span
            aria-hidden="true"
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
          />
        )}
        <span>{status.name}</span>
      </div>
    </SelectItem>
  ))}
</SelectContent>
```

ClickUp returns hex color strings like `"#5f55ee"`. Inline `style` is correct here — Tailwind cannot handle dynamic hex values in class names. `aria-hidden="true"` is correct: the dot is decorative — the status name in the adjacent `<span>` is the accessible label.

### Frontend: `useEffect` Initialization — Avoiding Infinite Loops

Initialize `listId` and `selectedStatus` from `syncConfig` only when `syncConfig` first loads. Use a `useRef` or conditional `useEffect`:

```typescript
const syncConfigLoaded = useRef(false);

useEffect(() => {
  if (syncConfig && !syncConfigLoaded.current) {
    syncConfigLoaded.current = true;
    setListId(syncConfig.container_id ?? '');
    setSelectedStatus(syncConfig.ai_trigger_status ?? '');
    // If container_id was previously set, auto-trigger status fetch
    if (syncConfig.container_id) {
      setShouldFetchStatuses(true);
    }
  }
}, [syncConfig]);
```

This avoids the effect re-running and overwriting user edits every time `syncConfig` is invalidated after a save. Without the ref guard, `queryClient.invalidateQueries` in `onSuccess` would re-trigger the effect and reset the user's in-progress form state.

### Frontend: `integrationsApi.ts` Additions

Add below the existing `updateSyncSettings` function:

```typescript
/**
 * Fetches live workflow statuses for a PM integration
 * Requires containerId (e.g., ClickUp list ID)
 */
export async function getIntegrationStatuses(
  integrationId: string,
  containerId: string,
): Promise<NormalizedStatus[]> {
  const { data } = await api.get(`/integrations/${integrationId}/statuses`, {
    params: { containerId },
  });
  return Array.isArray(data) ? data : (data?.data ?? []);
}

/**
 * Fetches the sync config (ai_trigger_status + container_id) for a project integration
 */
export async function getSyncConfig(projectId: string): Promise<SyncConfigResponse> {
  const { data } = await api.get(`/projects/${projectId}/integration/sync-config`);
  return data;
}

/**
 * Updates sync config: ai_trigger_status and/or container_id
 */
export async function updateSyncConfig(
  projectId: string,
  body: UpdateSyncConfig,
): Promise<SyncConfigResponse> {
  const { data } = await api.patch(`/projects/${projectId}/integration/sync-config`, body);
  return data;
}
```

### Frontend: Test Setup Pattern

`dsf-dasbhoard/__tests__/pages/PmIntegrationPanel.test.tsx` **already exists** — MODIFY it, do not recreate it. The existing file tests `SyncSettingsSection` using this setup pattern (mirror it for `StatusConfigSection` tests):

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/integrationsApi');
vi.mock('react-hot-toast', () => ({
  default: { toast: {} },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'project-1' }) };
});

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
```

Wrap each render: `<QueryClientProvider client={createQueryClient()}><MemoryRouter><PmIntegrationPanel /></MemoryRouter></QueryClientProvider>`

### Project Structure Notes

Alignment with unified project structure:

| File                                                             | Repo     | Change Type                                                                                      |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `src/projects/dto/sync-config-response.dto.ts`                   | Backend  | MODIFY — add `container_id` field + update `toSyncConfigResponse()`                              |
| `src/projects/dto/update-sync-config.dto.ts`                     | Backend  | MODIFY — add `container_id` field                                                                |
| `src/projects/project.controller.ts`                             | Backend  | MODIFY — add `provider_config` merge logic in `patchSyncConfig()`                                |
| `src/projects/project.controller.spec.ts`                        | Backend  | MODIFY — add 2 tests for `container_id` merge/skip                                               |
| `dsf-dasbhoard/src/api/integrationsApi.ts`                       | Frontend | MODIFY — add interfaces + 3 API functions                                                        |
| `dsf-dasbhoard/src/pages/settings/panels/PmIntegrationPanel.tsx` | Frontend | MODIFY — add `StatusConfigSection` + integrate into `renderProviderCard()`                       |
| `dsf-dasbhoard/__tests__/pages/PmIntegrationPanel.test.tsx`      | Frontend | MODIFY — add `StatusConfigSection` describe block; preserve existing `SyncSettingsSection` tests |

**Do NOT touch:**

- `prisma/schema.prisma` — `provider_config Json` already exists; no migration needed
- `src/integrations/pm-status.service.ts` — CS1-2's responsibility; CS1-4 only calls the endpoint
- `src/integrations/integrations.controller.ts` — CS1-2 adds `GET :id/statuses`; CS1-4 does not modify the backend integration controller
- `src/integrations/project-integration.service.ts` — `updateIntegration()` accepts `Prisma.ProjectIntegrationUncheckedUpdateInput` which includes `provider_config`; no changes needed

### References

- Epic CS1, Story 1.4 spec (FR-CS7): [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.4]
- CS1-2 story — `PMStatusService` + `GET /integrations/:id/statuses`: [Source: `_bmad-output/implementation-artifacts/CS1-2-status-discovery-service.md`]
- CS1-3 story — `SyncConfigResponseDto`, `UpdateSyncConfigDto`, sync-config endpoints: [Source: `_bmad-output/implementation-artifacts/CS1-3-ai-trigger-status-field.md`]
- `@Transform` null-safe DTO pattern: [Source: `src/projects/dto/create-project.dto.ts:16,31`]
- `ProjectIntegration.provider_config Json` field: [Source: `prisma/schema.prisma:1277`]
- `ProjectIntegrationService.updateIntegration()` — accepts `Prisma.ProjectIntegrationUncheckedUpdateInput`: [Source: `src/integrations/project-integration.service.ts:49`]
- `NormalizedStatus` DTO (id, name, color, type): [Source: `src/integrations/providers/dto/normalized-status.dto.ts`]
- `PmIntegrationPanel.tsx` (SyncSettingsSection pattern, imports, component structure): [Source: `dsf-dasbhoard/src/pages/settings/panels/PmIntegrationPanel.tsx:47–213`]
- `integrationsApi.ts` (existing API client — `api` base instance, existing types): [Source: `dsf-dasbhoard/src/api/integrationsApi.ts`]
- shadcn/ui component imports (Select, Input, Alert, Label, Button, Switch): [Source: `dsf-dasbhoard/src/pages/settings/panels/PmIntegrationPanel.tsx:1–16`]
- Sprint status entry: [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-4-live-status-picker-ui]
- Global `ValidationPipe` (`transform: true`, `whitelist: true`): [Source: `src/app.module.ts:195–204`]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/projects/dto/sync-config-response.dto.ts` — MODIFIED: added `container_id` field; fixed double-cast to use `const cfg`
- `src/projects/dto/update-sync-config.dto.ts` — MODIFIED: added `container_id` field with `@IsOptional`, `@IsString`, `@MinLength(1)`
- `src/projects/project.controller.ts` — MODIFIED: added `provider_config` merge in `updateSyncConfig`; added `@ApiResponse(404)`; updated Swagger summary
- `src/projects/project.controller.spec.ts` — MODIFIED: added `container_id` merge/skip tests; fixed NotFoundException description
- `dsf-dasbhoard/src/api/integrationsApi.ts` — MODIFIED: added `NormalizedStatus`, `SyncConfigResponse`, `UpdateSyncConfig` interfaces; added `getIntegrationStatuses`, `getSyncConfig`, `updateSyncConfig` functions
- `dsf-dasbhoard/src/pages/settings/panels/PmIntegrationPanel.tsx` — MODIFIED: added `StatusConfigSection` component; integrated into `renderProviderCard()`; consolidated React imports; fixed error alert to use `<Alert>` component
- `dsf-dasbhoard/__tests__/pages/PmIntegrationPanel.test.tsx` — MODIFIED: added `vi.mock('react-hot-toast')`; added 6 missing `StatusConfigSection` test cases; added `getSyncConfig` mocks
