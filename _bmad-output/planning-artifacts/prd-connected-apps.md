# PRD: Connected Apps — User-Level Provider Accounts & Import Onboarding

**Version:** 1.0
**Date:** 2026-03-16
**Status:** Draft
**Author:** Product

---

## 1. Problem Statement

### 1.1 The Chicken-and-Egg Onboarding Gap

The current PM tool integration (Epics CS0–CS4) is entirely **per-project**: a `ProjectIntegration` record is created only after a project exists in the database. This creates an unsolvable onboarding problem for new PMs:

- A PM must have a project in DB to connect ClickUp.
- But a PM cannot meaningfully create a project without knowing their ClickUp List ID upfront (required field in `NewProjectDialog`).
- The `ClickUpImportModal` — which allows browsing the ClickUp hierarchy visually — requires ClickUp to already be authenticated, but authentication is per-project only.

**Result:** New PMs have no self-serve path from zero to a connected, running project. They must either manually enter a ClickUp List ID they may not know, or be onboarded by an admin.

### 1.2 No Central Visibility of Connected Accounts

There is no UI showing a PM which provider accounts they have connected, across all projects. Accounts are buried inside individual project settings pages and there is no way to manage them centrally.

### 1.3 Multi-Account Per Provider Is Not Supported

A PM working across multiple ClickUp workspaces (e.g., their agency workspace and a client workspace) cannot connect both. The current model enforces one integration per project per provider, not multiple user-level accounts.

### 1.4 Future Extensibility

As DSF expands, user-level connections will extend beyond PM tools to: GitHub/GitLab/Bitbucket (git hosts), Gmail/Outlook (email), Google Calendar/Microsoft Planner (scheduling), and Slack/Teams (messaging). The architecture must support this generically from day one rather than building siloed per-provider tables.

---

## 2. Goals

| #   | Goal                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Enable a PM with zero projects to connect a ClickUp account and import their first project in a single self-serve flow                                     |
| G2  | Provide a central "Connected Apps" settings page where users can view, add, and remove all their connected provider accounts                               |
| G3  | Support multiple accounts per provider per user (e.g., two ClickUp workspaces)                                                                             |
| G4  | Introduce a generic `ConnectedApp` data model that handles any OAuth provider — PM tools, git hosts, email, calendar — without schema changes per provider |
| G5  | When importing a project, automatically create the `ProjectIntegration` from the selected connected account so the PM never has to manually configure it   |

## 3. Non-Goals

| #   | Non-Goal                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| NG1 | Jira and Asana OAuth implementation (architecture is built for them; ClickUp is the first implementation)              |
| NG2 | GitHub multi-account migration into `ConnectedApp` (Epic 24 `GithubAccount` model stays as-is for now)                 |
| NG3 | Migrating existing `ProjectIntegration` records to `ConnectedApp` (existing per-project integrations are not affected) |
| NG4 | Team-level or workspace-level shared connected accounts (accounts are user-owned)                                      |
| NG5 | Token refresh flows for providers with expiring tokens (ClickUp tokens are non-expiring; refresh is a future concern)  |

---

## 4. Users & Roles

| Role                 | Interaction                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **PM**               | Primary user. Connects PM tool accounts, imports projects, manages their connected apps. |
| **MANAGER / ADMIN**  | Can also connect accounts and import projects. Can view Connected Apps page.             |
| **TL / QA / VIEWER** | No access to Connected Apps or import flows.                                             |

---

## 5. Functional Requirements

### 5.1 ConnectedApp Data Model

**FR-CA1:** A `ConnectedApp` model must store user-level OAuth connections with the following fields:

- `id` — UUID primary key
- `user_id` — FK to User
- `provider` — `AppProvider` enum (`CLICKUP`, `JIRA`, `ASANA`, `GITHUB`, `GITLAB`, `GMAIL`, etc.)
- `workspace_id` — Provider-assigned workspace/org/account identifier
- `workspace_name` — Human-readable display name
- `access_token` — AES-256 encrypted OAuth access token
- `refresh_token` — AES-256 encrypted OAuth refresh token (nullable for non-expiring providers)
- `token_expiry` — Nullable DateTime (null = non-expiring, e.g. ClickUp)
- `metadata` — `Json?` for provider-specific fields (e.g. `{ botUserId, botUsername }` for ClickUp; `{ cloudId, siteUrl }` for Jira; `{ installationId }` for GitHub)
- `created_at`, `updated_at`

**FR-CA2:** Unique constraint: `(user_id, provider, workspace_id)` — a user cannot connect the same workspace twice, but can connect multiple workspaces per provider.

**FR-CA3:** Tokens must be encrypted at rest using the existing `EncryptionService` before storage and decrypted on retrieval — identical pattern to `ProjectIntegration`.

### 5.2 Connected Apps API

**FR-CA4:** `GET /api/v1/apps/connected` — returns all `ConnectedApp` records for the authenticated user, grouped by provider. Tokens must be omitted from the response.

**FR-CA5:** `GET /api/v1/apps/clickup/connect` — returns an OAuth initiation URL. State encodes `{ type: "user", userId, returnTo }` where `returnTo` is one of `"settings"` or `"import"`.

**FR-CA6:** `GET /api/v1/apps/clickup/callback` — public endpoint. Exchanges OAuth code for tokens, fetches bot identity via `getSelf()`, upserts a `ConnectedApp` record. Redirects to frontend callback URL with result params.

**FR-CA7:** `DELETE /api/v1/apps/:id` — deletes a `ConnectedApp` by ID. Ownership guard: user can only delete their own records. Returns 404 if not found, 403 if not owner.

**FR-CA8:** `GET /api/v1/apps/:id/hierarchy` — fetches the provider hierarchy (orgs → spaces → lists for ClickUp) using the decrypted token from the specified `ConnectedApp`. Returns a normalized tree structure.

### 5.3 Connected Apps Settings Page

**FR-CA9:** A new "Connected Apps" panel must be accessible at `/settings/connected-apps` in the system settings sidebar, visible to PM, MANAGER, and ADMIN roles.

**FR-CA10:** The page must display all connected accounts grouped by provider (ClickUp, Jira, Asana sections). Each account card shows: workspace name, metadata display name (e.g. bot username), connection date, and a "Disconnect" button.

**FR-CA11:** Each provider section must have a "Connect [Provider] Account" button that initiates OAuth with `returnTo: "settings"`. After callback, the page automatically refreshes to show the new account.

**FR-CA12:** "Disconnect" triggers a confirmation dialog before calling `DELETE /api/v1/apps/:id`. On success, the account card is removed.

**FR-CA13:** Providers not yet implemented (Jira, Asana) are displayed as "Coming Soon" with a disabled connect button — consistent with existing `PmIntegrationPanel` pattern.

### 5.4 Import Modal — Account Selection Step

**FR-CA14:** `ClickUpImportModal` must be updated to include a Step 0 (Account Selection) before the existing org/space/list browsing steps.

**FR-CA15:** Step 0 must fetch the user's connected ClickUp accounts via `GET /api/v1/apps/connected` and display them as selectable cards showing workspace name and bot username from metadata.

**FR-CA16:** If the user has no connected ClickUp accounts, Step 0 must show a "Connect ClickUp" CTA that initiates OAuth with `returnTo: "import"`. After OAuth completes, the modal must automatically re-open to Step 0 with the newly connected account pre-selected.

**FR-CA17:** If the user has one connected account, it must be auto-selected and Step 0 may be visually collapsed or skipped with a visible "Change account" option.

**FR-CA18:** If the user has multiple connected accounts, Step 0 shows all as selectable options. A "Connect another account" link is available at the bottom.

**FR-CA19:** The hierarchy browsing (existing Steps 1–2: org → space → list) must use `GET /api/v1/apps/:accountId/hierarchy` with the selected account's ID — no global API key.

**FR-CA20:** On import confirmation, `POST /api/v1/projects/import` must accept `accountId` in the request body.

### 5.5 Auto-Create ProjectIntegration on Import

**FR-CA21:** When `POST /api/v1/projects/import` is called with a valid `accountId`, the backend must automatically create a `ProjectIntegration` record for the newly created project by copying tokens and workspace data from the referenced `ConnectedApp`.

**FR-CA22:** The auto-created `ProjectIntegration` must have `polling_enabled: false`, `webhook_enabled: false` by default — the PM configures sync settings separately after import.

**FR-CA23:** If the `accountId` references a `ConnectedApp` not owned by the authenticated user, the request must return 403.

### 5.6 OAuth Callback Routing

**FR-CA24:** The OAuth callback must distinguish between `returnTo: "settings"` and `returnTo: "import"`:

- `returnTo: "settings"` → redirect to `/settings/pm-callback?integration=connected&returnTo=settings`
- `returnTo: "import"` → redirect to `/settings/pm-callback?integration=connected&returnTo=import`

**FR-CA25:** `PmIntegrationCallback.tsx` must handle the `returnTo` param:

- `returnTo: "settings"` → redirect to `/settings/connected-apps` after success animation
- `returnTo: "import"` → redirect to `/projects?openImport=true` after success animation

**FR-CA26:** The `/projects` page must read the `?openImport=true` query param on mount and automatically open `ClickUpImportModal` at Step 0.

---

## 6. Non-Functional Requirements

| #    | Requirement                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------- |
| NFR1 | OAuth tokens encrypted at rest (AES-256 via `EncryptionService`) — same standard as `ProjectIntegration` |
| NFR2 | Connected Apps API endpoints require JWT auth (except OAuth callback which is public)                    |
| NFR3 | `GET /apps/connected` must complete within 200ms for up to 20 connected accounts                         |
| NFR4 | `GET /apps/:id/hierarchy` must complete within 3s for a ClickUp workspace with up to 50 lists            |
| NFR5 | No OAuth tokens exposed in API responses or frontend state                                               |
| NFR6 | Role guard: PM, MANAGER, ADMIN only. TL/QA/VIEWER receive 403                                            |

---

## 7. UX Flows

### 7.1 First-Time PM Onboarding (Zero Projects)

```
/projects → empty state
  "Import from ClickUp" button
  → ClickUpImportModal opens
  → Step 0: no accounts connected
  → "Connect ClickUp" CTA
  → OAuth redirect (returnTo: "import")
  → ClickUp authorizes
  → /settings/pm-callback?integration=connected&returnTo=import
  → success animation (1.2s)
  → redirect to /projects?openImport=true
  → modal auto-opens, Step 0: new account pre-selected
  → Step 1: Browse hierarchy
  → Step 2: Select list → "Import"
  → confetti + project created + ProjectIntegration auto-created
  → redirect to /projects/:newId
```

### 7.2 Returning PM Adding Another Account

```
/settings/connected-apps
  → ClickUp section → "Connect ClickUp Account"
  → OAuth (returnTo: "settings")
  → /settings/pm-callback?integration=connected&returnTo=settings
  → redirect to /settings/connected-apps
  → new workspace card appears
```

### 7.3 PM Importing with Multiple Accounts

```
ClickUpImportModal → Step 0
  → two accounts shown: "My Agency" | "Client Corp"
  → user selects "Client Corp"
  → Step 1: Client Corp's org/space/list hierarchy
  → Step 2: select list → import
  → project created with Client Corp's token in ProjectIntegration
```

### 7.4 Disconnecting an Account

```
/settings/connected-apps → "Client Corp" card → [Disconnect]
  → AlertDialog: "Disconnect Client Corp from ClickUp?
     Projects using this account will lose sync until reconnected."
  → confirm
  → DELETE /api/v1/apps/:id
  → card removed
```

---

## 8. Data Model

### 8.1 New: `connected_apps` table

```prisma
model ConnectedApp {
  id             String       @id @default(uuid())
  user_id        String
  provider       AppProvider
  workspace_id   String
  workspace_name String
  access_token   String?      // AES-256 encrypted
  refresh_token  String?      // AES-256 encrypted, nullable
  token_expiry   DateTime?    // null = non-expiring (ClickUp)
  metadata       Json?        // provider-specific:
                              //   ClickUp: { botUserId, botUsername }
                              //   Jira:    { cloudId, siteUrl }
                              //   GitHub:  { installationId }
                              //   Gmail:   { email }
  created_at     DateTime     @default(now())
  updated_at     DateTime     @updatedAt

  user           User         @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@unique([user_id, provider, workspace_id])
  @@index([user_id, provider])
  @@map("connected_apps")
}
```

### 8.2 Enum Consolidation

**Rename `IntegrationProvider` → `PMProvider`, delete `ProjectProvider`**

`IntegrationProvider` and `ProjectProvider` currently contain identical values (`CLICKUP`, `JIRA`, `ASANA`) and are kept in sync manually. They are merged into a single `PMProvider` enum. All references updated.

```prisma
// Before (two identical enums):
enum IntegrationProvider { CLICKUP  JIRA  ASANA }
enum ProjectProvider      { CLICKUP  JIRA  ASANA }

// After (one enum):
enum PMProvider {
  CLICKUP
  JIRA
  ASANA
}
```

**New: `AppProvider` enum for `ConnectedApp`**

Broader than `PMProvider` — covers any OAuth provider a user can connect at the account level.

```prisma
enum AppProvider {
  CLICKUP
  JIRA
  ASANA
  GITHUB
  GITLAB
  BITBUCKET
  GMAIL
  GOOGLE_CALENDAR
  SLACK
}
```

| Enum          | Used by                                           | Scope              |
| ------------- | ------------------------------------------------- | ------------------ |
| `PMProvider`  | `ProjectIntegration.provider`, `Project.provider` | PM tools only      |
| `AppProvider` | `ConnectedApp.provider`                           | Any OAuth provider |

### 8.3 Updated: `projects/import` endpoint

```typescript
// Before
POST /api/v1/projects/import
{ provider: 'CLICKUP', resourceId: 'list_id' }

// After
POST /api/v1/projects/import
{ provider: 'CLICKUP', resourceId: 'list_id', accountId: 'connected-app-uuid' }
```

---

## 9. API Design

### `GET /api/v1/apps/connected`

```json
// Response
{
  "CLICKUP": [
    {
      "id": "uuid",
      "provider": "CLICKUP",
      "workspaceId": "ws_abc",
      "workspaceName": "My Agency",
      "metadata": { "botUsername": "@dsf-bot" },
      "connectedAt": "2026-03-16T10:00:00Z"
    },
    {
      "id": "uuid2",
      "provider": "CLICKUP",
      "workspaceId": "ws_xyz",
      "workspaceName": "Client Corp",
      "metadata": { "botUsername": "@dsf-bot" },
      "connectedAt": "2026-03-15T08:00:00Z"
    }
  ],
  "JIRA": [],
  "ASANA": []
}
```

### `GET /api/v1/apps/clickup/connect?returnTo=import`

```json
{ "url": "https://app.clickup.com/api?client_id=...&state=base64encodedState" }
```

### `GET /api/v1/apps/:id/hierarchy?teamId=optional`

```json
{
  "organizations": [
    {
      "id": "org_1",
      "name": "My Agency",
      "spaces": [
        {
          "id": "space_1",
          "name": "Engineering",
          "lists": [{ "id": "list_1", "name": "Sprint 1", "taskCount": 24 }]
        }
      ]
    }
  ]
}
```

### `DELETE /api/v1/apps/:id`

```json
// 200
{ "message": "Connected app disconnected successfully" }
// 404
{ "message": "Connected app not found" }
// 403
{ "message": "You do not own this connected app" }
```

---

## 10. Migration & Backwards Compatibility

- `ProjectIntegration` model and all existing per-project flows are **untouched**. Existing connected projects continue working.
- `ClickUpImportModal` currently calls `useClickUpHierarchy()` which depends on the deprecated global `CLICKUP_API_KEY`. This hook is replaced with `GET /api/v1/apps/:id/hierarchy` — **breaking change contained to the import modal only**.
- The existing `PmIntegrationPanel` at `/projects/:id/settings/integrations` is **untouched** — PMs can still manage per-project sync settings there after import.

---

## 11. Open Questions

| #   | Question                                                                                                                                                                                                                                                                                                                   | Owner     | Due         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| OQ1 | ~~Should disconnecting a `ConnectedApp` cascade-disable related `ProjectIntegration` records?~~ **Resolved:** Do nothing — projects keep syncing. `ProjectIntegration` holds its own token copy and is independent after import. Disconnect confirmation dialog clarifies: "Your existing projects will continue syncing." | PM + Tech | ✅ Resolved |
| OQ2 | ~~Should `AppProvider` enum replace or coexist with `IntegrationProvider` enum?~~ **Resolved:** Rename `IntegrationProvider` → `PMProvider`, delete `ProjectProvider`, add `AppProvider` for `ConnectedApp`.                                                                                                               | Tech      | ✅ Resolved |
| OQ3 | ~~When `returnTo: "import"`, should the modal remember the previously selected list across the OAuth redirect?~~ **Resolved:** No — modal drops back to Step 0 after OAuth. Simpler, less error-prone. User selects account then browses hierarchy fresh.                                                                  | UX        | ✅ Resolved |

---

## 12. Success Metrics

| Metric                                                       | Target      |
| ------------------------------------------------------------ | ----------- |
| PM onboarding time (zero → first project connected)          | < 3 minutes |
| Support tickets for "how do I connect ClickUp"               | → 0         |
| PMs who successfully import first project without admin help | > 90%       |
| OAuth connection success rate                                | > 95%       |
