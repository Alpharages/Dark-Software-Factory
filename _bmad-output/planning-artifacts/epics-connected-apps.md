---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments: ['prd-connected-apps.md', 'architecture.md', 'epics-clickup-smart-sync.md']
featureScope: 'Connected Apps — User-Level Provider Accounts, Central Management UI & Self-Serve Import Onboarding'
revision: 'v1 — ClickUp is the first implementation. Jira/Asana/GitHub follow the same ConnectedApp pattern with zero schema changes.'
---

# Dark Software Factory — Connected Apps: Epic Breakdown

## Overview

This document breaks down the Connected Apps feature into one epic and five stories. The epic
resolves the chicken-and-egg onboarding gap introduced by Epics CS0–CS4: PM tool integration
is per-project only, but new PMs have no project in DB yet. It also introduces a generic
`ConnectedApp` model that serves as the foundation for any future user-level OAuth integration
(git hosts, email, calendar, messaging).

**Epic CS5** covers:

- A generic `ConnectedApp` data model and service layer
- ClickUp OAuth at the user level (not project level)
- A central "Connected Apps" settings page
- Redesigned `ClickUpImportModal` with account selection and inline OAuth
- Auto-creation of `ProjectIntegration` when a project is imported

---

## Requirements Inventory

### Functional Requirements

**FR-CA1–CA3:** `ConnectedApp` Prisma model with `(user_id, provider, workspace_id)` unique
constraint. `AppProvider` enum covering PM tools, git hosts, email, messaging. Tokens
encrypted at rest via `EncryptionService`.

**FR-CA4–CA8:** Five backend endpoints: list connected apps, get OAuth URL, handle callback,
disconnect by ID, fetch provider hierarchy using account token.

**FR-CA9–CA13:** Connected Apps settings panel at `/settings/connected-apps` (PM/MANAGER/ADMIN).
Grouped by provider, connect/disconnect per account, "Coming Soon" for unimplemented providers.

**FR-CA14–CA20:** `ClickUpImportModal` Step 0 — account selection. Auto-select if one account,
multi-select if many, inline OAuth CTA if none. Hierarchy browsed via `ConnectedApp` token.

**FR-CA21–CA23:** `POST /projects/import` updated to accept `accountId`. Auto-creates
`ProjectIntegration` from `ConnectedApp` on successful import. Ownership guard enforced.

**FR-CA24–CA26:** OAuth callback `returnTo` routing. `PmIntegrationCallback` handles both
`settings` and `import` return paths. `/projects?openImport=true` auto-opens modal.

---

## Epic CS5: Connected Apps — User-Level Provider Accounts & Import Onboarding

**Priority:** High
**Estimated Effort:** 10 days
**Dependencies:** Epic CS0 (ProjectIntegration model, EncryptionService, ClickUpOAuthService patterns)
**Phase:** Onboarding Sprint

### Rationale

Epics CS0–CS4 built a complete per-project integration layer but left new PMs with no
self-serve path to their first project. This epic closes that gap and future-proofs the
architecture for all user-level OAuth integrations.

---

### Story CS5-1: ConnectedApp Model & Service Infrastructure

**Priority:** Critical (blocks all other stories)
**Effort:** 2 days | **Story Points:** 5

**Story**
As a **developer**,
I want a **`ConnectedApp` Prisma model, migration, and service layer**,
so that **any feature can store and retrieve user-level OAuth connections with encrypted tokens in a provider-agnostic way**.

**Acceptance Criteria**

1. **Prisma Model:** `ConnectedApp` model created in `prisma/schema.prisma` with fields: `id` (UUID), `user_id`, `provider` (`AppProvider` enum), `workspace_id`, `workspace_name`, `access_token` (nullable, encrypted), `refresh_token` (nullable, encrypted), `token_expiry` (nullable DateTime), `metadata` (Json?), `created_at`, `updated_at`. Relation to `User` with `onDelete: Cascade`.
2. **Unique Constraint:** `@@unique([user_id, provider, workspace_id])` enforced at DB level.
3. **Index:** `@@index([user_id, provider])` for efficient per-user per-provider queries.
4. **Enum Consolidation:** `IntegrationProvider` renamed to `PMProvider`. `ProjectProvider` deleted (it was identical to `IntegrationProvider` with no reason to be separate). All model fields and TypeScript references updated: `ProjectIntegration.provider: PMProvider`, `Project.provider: PMProvider`.
5. **AppProvider Enum:** New `AppProvider` enum added for `ConnectedApp.provider` with values: `CLICKUP`, `JIRA`, `ASANA`, `GITHUB`, `GITLAB`, `BITBUCKET`, `GMAIL`, `GOOGLE_CALENDAR`, `SLACK`. Broader than `PMProvider` — covers any OAuth provider, not only PM tools.
6. **Migration:** Single Prisma migration handles: rename enum (`IntegrationProvider` → `PMProvider`), drop enum (`ProjectProvider`), add enum (`AppProvider`), add `connected_apps` table.
7. **ConnectedAppService:** NestJS service in `src/connected-apps/` with methods:
   - `create(data)` — encrypts tokens before insert
   - `upsert(userId, provider, workspaceId, data)` — create or update, always re-encrypts tokens
   - `findByUser(userId)` — returns all records for user, tokens omitted
   - `findByUserAndProvider(userId, provider)` — provider-specific list
   - `findById(id)` — returns single record, tokens omitted
   - `getDecrypted(id)` — returns record with decrypted tokens (internal use only)
   - `delete(id, userId)` — ownership-guarded delete, throws `ForbiddenException` if not owner, `NotFoundException` if missing
8. **Module:** `ConnectedAppsModule` created, exports `ConnectedAppService`. Imports `DatabaseModule`, `EncryptionModule`.
9. **DTOs:** `ConnectedAppResponseDto` omits `access_token` and `refresh_token`. `metadata` typed as `Record<string, unknown>`.
10. **Unit Tests:** 100% coverage on `ConnectedAppService` — create, upsert (create path, update path), findByUser, findByUserAndProvider, getDecrypted, delete (own record, not-owner 403, not-found 404).

**Dev Notes**

- Mirror `ProjectIntegrationService` encryption pattern exactly — use `EncryptionService.encrypt()` before store, `EncryptionService.decrypt()` on retrieval in `getDecrypted()` only.
- `PMProvider` (renamed from `IntegrationProvider`) covers PM tools only — `ProjectIntegration` and `Project` use it. `AppProvider` covers all OAuth providers — `ConnectedApp` uses it. They are intentionally separate: `ProjectIntegration` will never have `GMAIL` or `BITBUCKET`.
- Place all files under `src/connected-apps/` to keep this module isolated.

**File List**

- `prisma/schema.prisma` (modified — rename `IntegrationProvider` → `PMProvider`, delete `ProjectProvider`, add `AppProvider`, add `ConnectedApp` model)
- `prisma/migrations/{timestamp}_connected_apps_enum_consolidation/migration.sql` (created)
- `src/connected-apps/connected-apps.module.ts` (created)
- `src/connected-apps/connected-apps.service.ts` (created)
- `src/connected-apps/connected-apps.service.spec.ts` (created)
- `src/connected-apps/dto/connected-app-response.dto.ts` (created)
- `src/app.module.ts` (modified — import `ConnectedAppsModule`)
- All files referencing `IntegrationProvider` → updated to `PMProvider` (grep: `src/integrations/`, `src/projects/`, `src/clickup/`, `src/webhooks/`)
- All files referencing `ProjectProvider` → updated to `PMProvider` (grep: `src/projects/`)

---

### Story CS5-2: ClickUp OAuth for User-Level Accounts

**Priority:** Critical (blocks CS5-3, CS5-4)
**Effort:** 2 days | **Story Points:** 5

**Story**
As a **PM**,
I want to **connect my ClickUp account at the user level (not tied to a specific project)**,
so that **I can use that account to import projects and manage multiple ClickUp workspaces**.

**Acceptance Criteria**

1. **Connect Endpoint:** `GET /api/v1/apps/clickup/connect` returns `{ url: string }`. Requires JWT auth, roles: PM/MANAGER/ADMIN. Query param `returnTo` (`"settings"` | `"import"`) is included in the OAuth state. State format: `{ type: "user", userId: string, returnTo: string }` — base64url encoded.
2. **Callback Endpoint:** `GET /api/v1/apps/clickup/callback` is public (no JWT). Reads `code` and `state`. Decodes state, exchanges code for token via ClickUp API, fetches bot identity via `getSelf()`. Calls `ConnectedAppService.upsert()` to store `ConnectedApp` with encrypted token and `metadata: { botUserId, botUsername }`.
3. **Callback Redirect:** On success: `{FRONTEND_URL}/settings/pm-callback?integration=connected&returnTo={returnTo}&accountId={newId}`. On error: `{FRONTEND_URL}/settings/pm-callback?integration=error&returnTo={returnTo}`.
4. **Disconnect Endpoint:** `DELETE /api/v1/apps/:id` deletes `ConnectedApp`. Ownership guard enforced. Returns `{ message: "Connected app disconnected successfully" }`.
5. **Hierarchy Endpoint:** `GET /api/v1/apps/:id/hierarchy` fetches ClickUp org/space/list tree using decrypted token from `ConnectedApp`. Returns `{ organizations: [...] }` normalized structure. Returns 403 if not owner, 404 if not found.
6. **Controller:** `ConnectedAppsController` in `src/connected-apps/` handles all 4 endpoints. Swagger decorators on all endpoints. `@ApiTags('connected-apps')`.
7. **Reuse:** Reuse existing `ClickUpOAuthService.exchangeCode()` and `ClickUpOAuthService.getBotIdentity()` — no duplication of ClickUp HTTP logic.
8. **Unit Tests:** Tests for controller (connect returns url, callback success path, callback error path, disconnect own, disconnect not-own 403, hierarchy own, hierarchy not-own 403).

**Dev Notes**

- The existing `GET /integrations/clickup/connect` (project-level) is **not modified**. The new endpoint lives at `/apps/clickup/connect` — separate controller, separate route.
- State encoding: use `Buffer.from(JSON.stringify(state)).toString('base64url')` and decode symmetrically. Keep consistent with any state encoding already in `ClickUpOAuthService`.
- `ClickUpOAuthService` must be exported from `IntegrationsModule` and imported into `ConnectedAppsModule` (or extract shared logic into a `ClickUpApiService` shared module).

**File List**

- `src/connected-apps/connected-apps.controller.ts` (created)
- `src/connected-apps/connected-apps.controller.spec.ts` (created)
- `src/connected-apps/connected-apps.module.ts` (modified — add controller, import IntegrationsModule for ClickUpOAuthService)
- `src/integrations/integrations.module.ts` (modified — export `ClickUpOAuthService`)

---

### Story CS5-3: Connected Apps Settings Page

**Priority:** High
**Effort:** 2 days | **Story Points:** 5

**Story**
As a **PM**,
I want a **central "Connected Apps" page in Settings**,
so that **I can see all my connected provider accounts, connect new ones, and disconnect any at any time**.

**Acceptance Criteria**

1. **Route:** `/settings/connected-apps` added to `App.tsx`. Protected: PM/MANAGER/ADMIN roles. Added to system settings sidebar in `SettingsLayout.tsx`.
2. **Page Layout:** `ConnectedAppsPanel.tsx` created at `src/pages/settings/panels/`. Uses `glass-card` surface pattern consistent with existing panels.
3. **Provider Sections:** Three sections rendered: ClickUp, Jira (coming soon), Asana (coming soon). Each section has a header with provider icon and "Connect [Provider] Account" button.
4. **Account Cards:** Each connected account renders a card showing: workspace name (bold), bot username from `metadata.botUsername` (muted), formatted connection date. "Disconnect" button on each card (destructive variant).
5. **Connect ClickUp:** "Connect ClickUp Account" calls `GET /api/v1/apps/clickup/connect?returnTo=settings`. Redirects user to ClickUp OAuth.
6. **Coming Soon:** Jira and Asana connect buttons are disabled with a "Coming Soon" badge — same pattern as existing `PmIntegrationPanel`.
7. **Disconnect Flow:** Clicking "Disconnect" opens an `AlertDialog` (shadcn): "Remove [Workspace Name] from your connected accounts? Your existing projects will continue syncing. To stop sync on a project, go to that project's settings." Confirm calls `DELETE /api/v1/apps/:id`. On success: account card removed, success toast. `ProjectIntegration` records are not affected — they hold their own token copy and run independently.
8. **Empty State:** If no accounts connected for a provider, shows: icon + "No [Provider] accounts connected" + connect button. No blank sections.
9. **Callback Update:** `PmIntegrationCallback.tsx` updated to handle `returnTo=settings` — redirect to `/settings/connected-apps` instead of `/projects/:id/settings/integrations`. Existing `returnTo=project` flow unchanged.
10. **React Query:** `useConnectedApps` hook using `GET /api/v1/apps/connected`. `staleTime: 60000`. Invalidated on connect/disconnect mutations.
11. **API Client:** `connectedAppsApi.ts` created at `src/api/` with functions: `getConnectedApps()`, `getClickUpConnectUrl(returnTo)`, `disconnectApp(id)`.

**Dev Notes**

- Follow existing `PmIntegrationPanel.tsx` structure for provider card layout and styling tokens.
- Use `Link2` / `Unlink2` Lucide icons for connect/disconnect. Use `Boxes` for ClickUp section header.
- Sidebar entry label: "Connected Apps". Icon: `AppWindow` (Lucide).

**File List** (Frontend — `dsf-dasbhoard`)

- `src/pages/settings/panels/ConnectedAppsPanel.tsx` (created)
- `src/pages/settings/panels/AllPanels.tsx` (modified — re-export `ConnectedAppsPanel`)
- `src/pages/settings/SettingsLayout.tsx` (modified — add Connected Apps nav entry)
- `src/pages/settings/PmIntegrationCallback.tsx` (modified — handle `returnTo=settings`)
- `src/api/connectedAppsApi.ts` (created)
- `src/hooks/useConnectedApps.ts` (created)
- `src/App.tsx` (modified — register `/settings/connected-apps` route)

---

### Story CS5-4: Import Modal — Account Selection & Inline OAuth

**Priority:** High
**Effort:** 2 days | **Story Points:** 5

**Story**
As a **PM**,
I want the **ClickUp import modal to show my connected accounts and let me connect one inline if I haven't already**,
so that **I can import projects without any pre-setup in Settings**.

**Acceptance Criteria**

1. **Step 0 Added:** `ClickUpImportModal` gains a new Step 0 "Select Account" before the existing org/space/list steps. Step indicator updates from "2 steps" to "3 steps".
2. **Accounts Loaded:** Step 0 fetches connected ClickUp accounts via `useConnectedApps()` hook (reuse from CS5-3). Accounts display as selectable radio cards showing workspace name and bot username.
3. **Single Account — Auto-select:** If exactly one account exists, it is auto-selected and Step 0 renders in a collapsed "confirmed" state with a "Change account" link to expand.
4. **Multiple Accounts:** All accounts are shown as selectable cards. "Connect another ClickUp account" link at the bottom initiates OAuth with `returnTo: "import"`.
5. **No Accounts — Inline OAuth:** If zero accounts, Step 0 shows an empty state: ClickUp icon + "No ClickUp accounts connected" + prominent "Connect ClickUp" button. Clicking stores `{ pendingImport: true }` in `localStorage` and initiates OAuth with `returnTo: "import"`.
6. **Auto-Reopen After OAuth:** On mount, `/projects` page checks `?openImport=true` query param. If present: auto-opens `ClickUpImportModal`, removes param from URL (no history entry), clears `localStorage.pendingImport`.
7. **Hierarchy Uses Account Token:** Steps 1–2 (org → space → list) call `GET /api/v1/apps/:accountId/hierarchy` using the selected account's ID. The deprecated `useClickUpHierarchy` hook (global API key) is removed and replaced.
8. **Next Button Gated:** "Next" on Step 0 is disabled until an account is selected.
9. **Loading/Error States:** Skeleton cards during account fetch. Error alert if fetch fails with "Retry" button.
10. **API Client:** `connectedAppsApi.ts` gains `getAppHierarchy(accountId, teamId?)` function.

**Dev Notes**

- `localStorage` key: `dsf:pendingImport` — store `{ returnedFromOAuth: true }` set in callback, cleared on modal open.
- `useClickUpHierarchy` hook is deprecated by this story. If it has other callers, keep it temporarily and mark `@deprecated`. If no other callers, delete it.
- The `ClickUpImportProvider` (if any step state is in context) needs `selectedAccountId` added to its state shape.
- Modal state must not reset when re-opened after OAuth — check `localStorage.dsf:pendingImport` on open and skip to Step 0 account list directly.

**File List** (Frontend — `dsf-dasbhoard`)

- `src/components/projects/ClickUpImportModal.tsx` (modified — add Step 0, update steps, remove global hierarchy dependency)
- `src/pages/Dashboard.tsx` (modified — handle `?openImport=true` on mount)
- `src/api/connectedAppsApi.ts` (modified — add `getAppHierarchy`)
- `src/hooks/useClickUpHierarchy.ts` (deleted or marked `@deprecated`)
- `src/App.tsx` (no change needed — Dashboard route already exists)

---

### Story CS5-5: Auto-Create ProjectIntegration on Import

**Priority:** High
**Effort:** 2 days | **Story Points:** 5

**Story**
As a **PM**,
I want importing a ClickUp list to **automatically set up the project's PM integration**,
so that **I don't have to manually navigate to project settings and reconnect the same account I just used**.

**Acceptance Criteria**

1. **Import DTO Updated:** `ImportProjectDto` gains an optional `accountId: string` field (`@IsOptional() @IsUUID()`).
2. **Auto-Create Logic:** In `ProjectService.importProject()`, after the `Project` record is created, if `accountId` is provided: fetch `ConnectedApp` by `accountId`, verify ownership (throw 403 if not owner), create `ProjectIntegration` using copied workspace data and decrypted tokens (re-encrypted for `ProjectIntegration` storage). Fields: `provider`, `workspace_id`, `workspace_name`, `access_token`, `refresh_token`, `token_expiry` copied from `ConnectedApp`. `metadata`-sourced fields (`bot_user_id`, `bot_username`) mapped to `ProjectIntegration` columns. `polling_enabled: false`, `webhook_enabled: false`, `provider_config: {}`, `ai_trigger_status: null`.
3. **Ownership Guard:** If `ConnectedApp.user_id !== req.user.id`, throw `ForbiddenException` before any project creation occurs.
4. **Atomicity:** Project creation and `ProjectIntegration` creation run in a `PrismaService.$transaction()`. If `ProjectIntegration` insert fails, the project is rolled back.
5. **Backwards Compatible:** If `accountId` is omitted from the request, import proceeds as before (project created, no `ProjectIntegration` auto-created). No breaking change.
6. **Response:** `ImportProjectResponseDto` gains `integrationCreated: boolean` field so the frontend can show an appropriate success message.
7. **Frontend Update:** `ClickUpImportModal` passes `accountId` in the import request body. Success toast updated: "Project imported and ClickUp connected automatically."
8. **Unit Tests:** Test: import with valid `accountId` creates both project and integration; import without `accountId` creates only project; import with wrong-owner `accountId` returns 403; DB error on integration insert rolls back project.

**Dev Notes**

- Import `ConnectedAppService` into `ProjectsModule` — add `ConnectedAppsModule` to `ProjectsModule` imports.
- Re-encryption flow: `ConnectedAppService.getDecrypted(accountId)` → plaintext tokens → `EncryptionService.encrypt()` before storing in `ProjectIntegration`. Never store plaintext.
- The `ProjectIntegration` auto-created here is identical to one created manually via the connect flow. The PM can then go to `/projects/:id/settings/integrations` to configure polling/webhook/trigger-status.

**File List** (Backend — Dark Software Factory)

- `src/projects/project.service.ts` (modified — auto-create `ProjectIntegration` in import)
- `src/projects/dto/import-project.dto.ts` (modified — add `accountId`)
- `src/projects/dto/import-project-response.dto.ts` (modified — add `integrationCreated`)
- `src/projects/projects.module.ts` (modified — import `ConnectedAppsModule`)

**File List** (Frontend — dsf-dasbhoard)

- `src/components/projects/ClickUpImportModal.tsx` (modified — pass `accountId` in import call, update success toast)
- `src/api/projectsApi.ts` (modified — add `accountId` to import function params)

---

## Epic CS5 — Story Summary

| Story     | Name                                     | Effort      | Points | Blocks                     |
| --------- | ---------------------------------------- | ----------- | ------ | -------------------------- |
| CS5-1     | ConnectedApp Model & Service             | 2 days      | 5      | CS5-2, CS5-3, CS5-4, CS5-5 |
| CS5-2     | ClickUp OAuth for User Accounts          | 2 days      | 5      | CS5-3, CS5-4               |
| CS5-3     | Connected Apps Settings Page             | 2 days      | 5      | —                          |
| CS5-4     | Import Modal — Account Selection         | 2 days      | 5      | CS5-5                      |
| CS5-5     | Auto-Create ProjectIntegration on Import | 2 days      | 5      | —                          |
| **Total** |                                          | **10 days** | **25** |                            |

## Dependency Order

```
CS5-1 (model)
  └─→ CS5-2 (OAuth endpoints)
        ├─→ CS5-3 (settings UI)   ← can run parallel with CS5-4
        └─→ CS5-4 (import modal)
              └─→ CS5-5 (auto-create integration)
```

CS5-3 and CS5-4 can be developed in parallel once CS5-2 is done.

---

## Open Questions

| #   | Question                                                                                                                                                                                                                | Decision Needed Before |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| OQ1 | ~~Should disconnecting a `ConnectedApp` set related `ProjectIntegration` records to INACTIVE?~~ **Resolved:** No cascade. Projects keep syncing independently after disconnect. Dialog copy clarifies this to the user. | ✅ Resolved            |
| OQ2 | ~~Merge `AppProvider` and `IntegrationProvider` enums?~~ **Resolved:** Rename `IntegrationProvider` → `PMProvider`, delete `ProjectProvider`, new `AppProvider` for `ConnectedApp`. Done in CS5-1.                      | ✅ Resolved            |
| OQ3 | ~~Should the modal remember the selected list across the OAuth redirect?~~ **Resolved:** No — drop back to Step 0 after OAuth. User selects account then browses fresh.                                                 | ✅ Resolved            |
