# Story CS0.7: PM Sync Settings UI

Status: ready-for-dev

## Story

As a **PM**,
I want to **configure polling intervals and webhook settings for my PM tool integration**,
so that **I can tune how DSF syncs with my team's tool without DevOps involvement**.

## Acceptance Criteria

1. **Integration Settings View**: A dedicated settings section is added for each connected integration (found in `PmIntegrationPanel.tsx`). **Note**: This panel must only be rendered if `status === 'connected'`.
2. **Polling Configuration**:
   - **Toggle**: A `Switch` component (from `src/components/ui/switch.tsx`) to enable/disable polling.
   - **Interval Dropdown**: A `Select` component (from `src/components/ui/select.tsx`) with options: 5, 10, 15, 30, 60 minutes.
   - **Last Polled Display**: Shows the `polling_last_run_at` timestamp using a relative time relative formatter (e.g., "5 mins ago"). Show `Never` if null.
3. **Webhook Configuration**:
   - **Toggle**: A `Switch` to enable/disable webhook reception.
   - **Status Indicator**: shows `Active` (green badge) if `webhook_id` exists, or `Not Registered` (gray/yellow badge).
   - **Webhook URL Display**: A read-only `Input` field (with a "Copy" button) showing the project's unique webhook URL.
     - **URL Pattern**: `{PUBLIC_URL}/api/v1/webhooks/{provider}`.
     - **Mechanism**: Use `window.location.origin` if `VITE_DSF_PUBLIC_URL` is missing from environment.
     - **Feedback**: Clicking "Copy" MUST trigger a `success` toast: "Webhook URL copied to clipboard".
4. **Action & Persistence**:
   - **Save Button**: A "Save Settings" button that calls `PATCH /api/v1/integrations/{integrationId}/sync-settings`.
   - **Request Body**:
     ```json
     {
       "polling_enabled": boolean,
       "polling_interval_min": number,
       "webhook_enabled": boolean
     }
     ```
   - **Optimistic Updates**: Uses `tanstack/react-query` to update the local cache immediately.
   - **Success/Error Feedback**: Uses `react-hot-toast` to notify the user of the result.
5. **UI States**:
   - **Skeleton**: Use `src/components/ui/skeleton.tsx` while integration data is loading.
   - **Warning**: If both polling and webhooks are disabled, display a `Warning` alert: "No sync method active — DSF will not receive updates from [Provider]".

## Styling & UI Standards (CRITICAL)

- **Layout**: Group related settings into `Section` blocks (e.g., "Polling", "Webhooks") within the integration card.
- **Glassmorphism**: Ensure containers use `glass-card` styling with `backdrop-blur-sm`.
- **Badges**: Use `src/components/ui/badge.tsx` for status indicators with appropriate semantic colors (`var(--success)`, `var(--warning)`).
- **Transitions**: Apply `transition-all duration-300` to the settings panel visibility and hover states.

## Tasks / Subtasks

- [ ] Update API Client (`src/api/integrationsApi.ts`) (AC: 4)
  - [ ] Add `updateSyncSettings(integrationId, data)` method.
- [ ] Implement Sync Settings UI Components (AC: 1, 2, 3)
  - [ ] Add Polling section with Switch and Select.
  - [ ] Add Webhook section with Switch and URL display + Copy button.
- [ ] Implement Persistence Logic (AC: 4)
  - [ ] Use `useMutation` for `updateSyncSettings`.
  - [ ] Invalidate `pm-integrations` on success.
- [ ] Add Form Validation & Warning States (AC: 5)
  - [ ] Display warning alert when both sync methods are disabled.

## Dev Notes

- **Context**: The `ProjectIntegration` model (Epic CS0.1) provides the data schema.
- **URL Resolution**: Use `import.meta.env.VITE_DSF_PUBLIC_URL || window.location.origin` to determine the base for webhook URLs.
- **Icons**: Use `RefreshCw` for polling, `Zap` for webhooks, and `Copy` for the URL field.

### References

- [Epic CS0: PM Tool Integration Framework](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Epic-0:-PM-Tool-Integration-Framework)
- [UX Specification: Design Tokens](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/ux-design-specification.md#Design-Tokens-CSS-Variables)
- [Existing Connect UI Story](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/stories/epic-CS0/CS0-6-connect-ui.md)

## Dev Agent Record

### Agent Model Used

Antigravity v1.0 (Validation Hardened)

### completion_notes_list

- Critical: Fixed non-existent `VITE_DSF_PUBLIC_URL` reference; added `window.location.origin` as fallback.
- Alignment: Added explicit JSON request body DTO for the `PATCH` endpoint to prevent API contract violations.
- Enhancement: Mandated `Skeleton` loading states and `toast` feedback for the Copy action.
- UX: Added conditional rendering requirement (hide settings if not connected).
