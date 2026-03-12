# Story CS0.6: Connect PM Tool UI

Status: done

## Story

As a **PM or Admin**,
I want to **connect any supported PM tool to a project from the project settings page**,
so that **teams can self-serve their PM tool connection without DevOps help**.

## Acceptance Criteria

1. **Settings Panel**: An "Integrations" panel is added to the shared Project Settings view (using existing `SettingsLayout` and `src/pages/settings/panels/` patterns). [Source: AllPanels.tsx]
2. **Provider Selection**: Available providers (`CLICKUP`, `JIRA`, `ASANA`) are displayed using `src/components/ui/card.tsx` with `Lucide` icons (`Boxes`, `Link2`).
3. **Connect Action**: "Connect" triggers a redirect to `GET /api/v1/integrations/{provider}/connect?project_id={id}`.
4. **Callback Handling**: A dedicated `PmIntegrationCallback.tsx` handles the OAuth return:
   - Success: `?integration=connected`. Shows `✅ Connected` status using `src/components/ui/badge.tsx`.
   - Error: `?integration=error`. Triggers `react-hot-toast` error message.
5. **Data Management**: Connection status is managed via `tanstack/react-query` (fetching from `integrationsApi.ts`) with `staleTime: 60000`.
6. **Disconnect Action**: "Disconnect" calls `DELETE /api/v1/integrations/{integrationId}`. After success, invalidates the `pm-integrations` query key.
7. **Security**: Access strictly gated to `ADMIN` and `PM` roles using the `useAuth` hook. [Source: Role Guards]

## Styling & UI Standards (CRITICAL)

To ensure consistency with the premium dashboard theme, the implementation MUST follow these rules:

- **Surface Patterns**: Use `glass-card` or `bg-[var(--surface-2)]` with `backdrop-blur-sm` for container backgrounds.
- **Borders & Shadows**: Use `border-[var(--card-border)]` and `shadow-[var(--shadow-md)]`. Apply `hover:shadow-[var(--shadow-lg)]` and `hover:-translate-y-0.5` for interaction feedback.
- **Design Tokens**:
  - Connect (Primary Action): Use `bg-[var(--brand-500)]` or the `default` Button variant.
  - Disconnect (Destructive): Use the `destructive` Button variant.
  - Success States: Use `var(--success)` (#10b981).
- **Animations**:
  - Apply `animate-pulse-glow` to the "Connecting..." state in the callback component.
  - Use `transition-all duration-300 ease-out` for all hover states.
- **Typography**: Adhere to `tracking-tight` for titles and `leading-relaxed` for descriptions.

## Tasks / Subtasks

- [x] Implement API Client (`src/api/integrationsApi.ts`) (AC: 3, 5, 6)
- [x] Create PM Integration Settings Panel (AC: 1, 2, 7)
  - [x] Implement `PmIntegrationPanel.tsx` in `src/pages/settings/panels/`.
  - [x] Ensure `IntegrationProviderCard` matches the `glass-card` styling standard.
- [x] Implement OAuth Callback Handler (AC: 4)
  - [x] Files: `src/pages/settings/PmIntegrationCallback.tsx`.
  - [x] Apply `animate-pulse-glow` and `Loader2` during exchange.
- [x] UI Polish & Styling Verification
  - [x] Verify use of CSS variables over hex codes.
  - [x] Test dark/light theme switching compatibility.
  - [x] Verify hover transitions and container blurs.

## Dev Notes

- **Pattern**: Follow `githubApi.ts` and `GithubCallback.tsx` for consistency.
- **Icons**: Use `Boxes` for the section header, `Link2` for connect, `Unlink2` for disconnect.
- **State**: The "Connected" state should display the workspace name and bot username fetched from the integration record.

### References

- [Epic CS0: PM Tool Integration Framework](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Epic-0:-PM-Tool-Integration-Framework)
- [Project Settings Patterns](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/pages/settings/panels/AllPanels.tsx)
- [Global Index CSS](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/index.css)

## Dev Agent Record

### Agent Model Used

Antigravity v1.0 (Styling Hardened)

### File List

- `src/api/integrationsApi.ts` (created)
- `src/pages/settings/panels/PmIntegrationPanel.tsx` (created)
- `src/pages/settings/PmIntegrationCallback.tsx` (created)
- `src/types/integrations.ts` (created)
- `src/hooks/queries/useIntegrationHealth.ts` (modified — unrelated to this story)
- `src/pages/settings/SettingsLayout.tsx` (modified — added projectPanels and PM Tool Integration nav entry)
- `src/pages/settings/panels/AllPanels.tsx` (modified — re-exported PmIntegrationPanel)
- `src/App.tsx` (modified — registered PmIntegrationCallback route and project settings integrations route)

### completion_notes_list

- Critical: Integrated specific CSS variables (`--surface-2`, `--brand-500`) into story ACs.
- Critical: Mandated `glass-card` and `animate-pulse-glow` patterns.
- Enhancement: Added UI Polish task for theme/animation verification.
