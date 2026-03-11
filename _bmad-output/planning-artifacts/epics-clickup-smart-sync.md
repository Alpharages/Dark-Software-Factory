---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments: ['prd.md', 'architecture.md', 'ux-design-specification.md']
featureScope: 'PM Tool Integration Framework + Smart Sync — Provider-Agnostic OAuth, Polling, Webhooks, Field Auto-Fill, Failure Handling'
revision: 'v3 — Full provider abstraction (IPMProvider interface). ClickUp is first implementation. Jira/Asana follow same pattern with zero changes to Epics 1–3.'
---

# Dark Software Factory — PM Tool Integration & Smart Sync: Epic Breakdown

## Overview

This document breaks down the PM Tool Integration and Smart Sync feature set into epics
and stories. It covers four epics:

- **Epic 0:** A provider-agnostic integration framework with OAuth, polling, and webhook
  infrastructure. ClickUp is the first implementation. Jira and Asana follow the same
  pattern with zero changes to Epics 1–3.
- **Epic 1:** Per-project workflow configuration — runtime status discovery, AI trigger
  status, and bot self-assignment on execution start.
- **Epic 2:** Intelligent required field pre-check and auto-fill before status pushes.
- **Epic 3:** Actionable sync failure handling and dashboard visibility.

---

## Requirements Inventory

### Functional Requirements

**Epic 0 — PM Tool Integration Framework**

FR-CS0A: A `ProjectIntegration` model must store per-project, per-provider OAuth
connections: provider enum (CLICKUP | JIRA | ASANA), workspace ID, workspace
name, encrypted access/refresh tokens, token expiry, bot user ID, bot username,
polling settings (enabled, interval, last run), webhook settings (enabled,
webhook ID, encrypted secret), and a provider_config JSON for provider-specific
IDs (list ID, board ID, project key).

FR-CS0B: An `IPMProvider` interface must define the contract all providers implement:
getSelf, getStatuses, getTask, updateStatus, addComment, assignTask,
getRequiredFields, setFieldValue, registerWebhook, deregisterWebhook,
normalizeEvent (raw payload → IRawTaskEvent).

FR-CS0C: A `ClickUpProvider` must fully implement `IPMProvider` using the ClickUp
API v2, including OAuth token exchange, GET /user self-identification,
list status fetching, task operations, field operations, webhook management,
and payload normalization to IRawTaskEvent.

FR-CS0D: A `PMProviderFactory` must resolve the correct `IPMProvider` implementation
from a `ProjectIntegration.provider` value, and supply it with the
workspace-scoped OAuth token (auto-refreshed when near expiry).

FR-CS0E: DSF must implement a generic OAuth flow handler that adapts per provider:
initiate redirect, handle callback, exchange code for tokens, call getSelf()
to capture bot_user_id, persist `ProjectIntegration`. Provider OAuth
credentials (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) are configured per
provider in env vars (e.g. CLICKUP_CLIENT_ID, JIRA_CLIENT_ID).

FR-CS0F: A single generic webhook endpoint `POST /api/v1/webhooks/{provider}` must
route incoming events to the correct `IPMProvider.normalizeEvent()` by
provider slug, then forward the normalized IRawTaskEvent to the
ticket-intake-queue. Signature verification uses the workspace-specific
secret from `ProjectIntegration`.

FR-CS0G: A PM or Admin must be able to connect any supported PM tool to a project
via a "Connect Tool" UI flow: select provider → OAuth → confirm connected
workspace name and bot username.

FR-CS0H: A PM or Admin must be able to configure sync settings per connected
integration: enable/disable polling, set polling interval (5/10/15/30/60 min),
enable/disable webhook reception. Settings are stored on `ProjectIntegration`.

FR-CS0I: The polling orchestrator must be provider-agnostic: iterate all
`ProjectIntegration` records with `polling_enabled = true`, resolve the
correct `IPMProvider` via `PMProviderFactory`, fetch updated tasks, and
publish to ticket-intake-queue. Each integration uses its own interval
and last-run timestamp independently.

FR-CS0J: Enabling webhook reception must trigger DSF to call
`IPMProvider.registerWebhook()` and store the returned webhook_id and
encrypted secret on `ProjectIntegration`. Disabling must call
`IPMProvider.deregisterWebhook()` and clear the stored values.

FR-CS0K: The webhook endpoint must route events to the correct workspace by matching
the provider-specific webhook identifier in the payload to
`ProjectIntegration.webhook_id`. Each workspace's signature is verified
using its own stored secret. Events from unknown webhooks are acknowledged
silently. Cross-tenant data access must be impossible.

**Epic 1 — Per-Project Workflow Configuration**

FR-CS1: Remove all env-var based ClickUp status configuration:
CLICKUP_STATUS_DEPLOYED, CLICKUP_STATUS_DEPLOY_FAILED,
CLICKUP_STATUS_ROLLED_BACK, ACTIONABLE_STATUSES, NON_ACTIONABLE_STATUSES.
CLICKUP_API_KEY is replaced by FR-CS0E OAuth flow.

FR-CS2: Remove hardcoded CLICKUP_STATUS_MAP from status-evaluation.service.ts
and mapClickUpStatusToTicketStatus() from clickup-task-update.consumer.ts.

FR-CS3: Remove the in-memory statusNameToIdCache from ClickUpService — status
resolution is now handled by IPMProvider.getStatuses() with a per-list cache.

FR-CS4: Remove webhooks.actionableStatuses and webhooks.nonActionableStatuses
config blocks from configuration.ts and env.validation.ts.

FR-CS5: IPMProvider.getStatuses(containerId) must fetch and cache available workflow
statuses per list/board/project, with a configurable TTL (default 5 min),
keyed by provider + containerId.

FR-CS6: Each `ProjectIntegration` must store an `ai_trigger_status` field — the
exact status name that means "start AI processing" for that team's workflow
on that provider.

FR-CS7: Project settings must present a live-fetched dropdown of the integration's
actual workflow statuses (via IPMProvider.getStatuses()) so PMs pick their
AI trigger status — no env-var, no manual typing.

FR-CS13: When DSF starts execution on a ticket, it must assign the task to the
bot user stored in `ProjectIntegration.bot_user_id` via
IPMProvider.assignTask(). If no integration exists, the step is skipped.

FR-CS20: The ticket-intake pipeline must act as a development gate. When a task
event arrives (via webhook or polling), its status must be compared
case-insensitively against `ProjectIntegration.ai_trigger_status`.
Only if they match exactly should the task be enqueued for AI development.
If the task's status does NOT match, the event must be silently discarded
with a `debug` log ("task {taskId} status '{status}' — not at trigger
status '{ai_trigger_status}', skipping"). No error, no retry, no entry
in the development queue. If `ai_trigger_status` is null/unset for the
project's integration, all tasks are discarded with a `warn` log instructing
the PM to configure the trigger status.

**Epic 2 — Required Field Pre-Check & Auto-Fill**

FR-CS8: Before pushing any status update, DSF must pre-check required fields via
IPMProvider.getRequiredFields(containerId).

FR-CS9: DSF must cross-reference required field definitions against the task's
current field values (IPMProvider.getTask()) to identify empty required fields.

FR-CS10: DSF must auto-fill fields where it has exact factual data from execution:
time spent → execution duration, completion date → deployed_at,
PR link → pr_url, branch → github_branch.

FR-CS11: AI (Claude) must infer values for estimatable fields (story points,
complexity, priority, tags) using execution context: diff size, retry count,
files changed, QA results, ticket description.

FR-CS12: For dropdown/select fields, valid option IDs must be fetched from field
definitions and AI text responses mapped to exact option IDs before calling
IPMProvider.setFieldValue().

FR-CS19: A comment must be posted via IPMProvider.addComment() after any auto-fill,
listing each filled field, its source (factual / AI-estimated), and a
verification request.

**Epic 3 — Sync Failure Handling & Dashboard Visibility**

FR-CS14: IPMProvider implementations must treat 4xx API responses as non-retryable
permanent failures and 5xx as retryable transient failures.

FR-CS15: When a status push fails after all retries, IPMProvider.addComment() must
post an actionable comment: DSF work complete, reason for failure, target
status, manual steps, remaining unfilled fields.

FR-CS16: The `Ticket` model must have a `clickup_synced Boolean @default(true)` field
(named for ClickUp now; will be abstracted to `pm_synced` when additional
providers go live) to track sync state independently of execution state.

FR-CS17: The PM dashboard must show "Work Done — Sync Pending" as a distinct amber
state when execution is complete but `pm_synced = false`.

FR-CS18: A `pm-sync-failed` Socket.IO event must be emitted when sync fails,
carrying ticketId, provider, reason, and missingFields. The dashboard
shows an amber toast and updates the ticket card without a page refresh.

### Non-Functional Requirements

NFR-CS1: IPMProvider.getStatuses() results must be cached per provider+containerId
with configurable TTL (default 5 min).

NFR-CS2: Required field pre-check (getRequiredFields + getTask in parallel) must
complete within 2 seconds.

NFR-CS3: AI field inference must be best-effort and non-blocking — timeout or failure
skips that field and adds it to manualFields.

NFR-CS4: If the PM tool API is unavailable, DSF continues internal execution, marks
pm_synced=false, and surfaces the state on the dashboard.

NFR-CS5: All sync failures must be audited via AuditLogService with entity, action,
provider, error code, correlation ID, timestamp.

NFR-CS6: 4xx responses from any PM provider must never trigger retry.

NFR-CS7: Adding a new provider (e.g. Jira) must require only: a new provider class
implementing IPMProvider, OAuth env vars, and a new IntegrationProvider
enum value. Zero changes to Epics 1–3 code.

### Additional Requirements (Architecture)

- REMOVE: CLICKUP_API_KEY, CLICKUP_STATUS_DEPLOYED, CLICKUP_STATUS_DEPLOY_FAILED,
  CLICKUP_STATUS_ROLLED_BACK, ACTIONABLE_STATUSES, NON_ACTIONABLE_STATUSES from
  env.validation.ts and configuration.ts
- REMOVE: CLICKUP_STATUS_MAP, mapClickUpStatus(), mapClickUpStatusToTicketStatus(),
  getClickUpStatusName(), statusNameToIdCache
- ADD: ProjectIntegration model, IntegrationProvider enum, Prisma migration
- ADD: pm_synced Boolean on Ticket model, Prisma migration
- ADD: ai_trigger_status String? on ProjectIntegration model
- KEEP: IRawTaskEvent, TaskProviderType, ticket-intake-queue pipeline — unchanged
- KEEP: AuditLogService, Socket.IO gateway, existing QA/execution pipeline — unchanged
- NEW: IPMProvider interface in src/integrations/providers/pm-provider.interface.ts
- NEW: ClickUpProvider in src/integrations/providers/clickup/clickup.provider.ts
- NEW: PMProviderFactory in src/integrations/providers/pm-provider.factory.ts

### FR Coverage Map

FR-CS0A: Epic 0 — ProjectIntegration model + IntegrationProvider enum
FR-CS0B: Epic 0 — IPMProvider interface
FR-CS0C: Epic 0 — ClickUpProvider implements IPMProvider
FR-CS0D: Epic 0 — PMProviderFactory
FR-CS0E: Epic 0 — Generic OAuth flow + ClickUp OAuth wiring
FR-CS0F: Epic 0 — Generic webhook routing POST /api/v1/webhooks/{provider}
FR-CS0G: Epic 0 — Connect integration UI (provider picker + OAuth)
FR-CS0H: Epic 0 — Per-integration sync settings UI
FR-CS0I: Epic 0 — Provider-agnostic polling orchestrator
FR-CS0J: Epic 0 — Webhook registration/deregistration via IPMProvider
FR-CS0K: Epic 0 — Multi-tenant webhook routing + per-integration signature verification

FR-CS1: Epic 1 — Remove status env-vars and hardcoded maps
FR-CS2: Epic 1 — Remove CLICKUP_STATUS_MAP and mapper methods
FR-CS3: Epic 1 — Remove statusNameToIdCache; IPMProvider.getStatuses() replaces it
FR-CS4: Epic 1 — Remove webhooks.actionableStatuses config blocks
FR-CS5: Epic 1 — IPMProvider.getStatuses() with per-provider+list TTL cache
FR-CS6: Epic 1 — ai_trigger_status on ProjectIntegration
FR-CS7: Epic 1 — Live status picker from IPMProvider.getStatuses()
FR-CS13: Epic 1 — IPMProvider.assignTask() with bot_user_id on execution start
FR-CS20: Epic 1 — Development gate: compare incoming task status vs ai_trigger_status; discard if no match

FR-CS8: Epic 2 — IPMProvider.getRequiredFields() pre-check
FR-CS9: Epic 2 — IPMProvider.getTask() field value cross-reference
FR-CS10: Epic 2 — Factual auto-fill (time, dates, PR link, branch)
FR-CS11: Epic 2 — AI inference for story points, complexity, priority, tags
FR-CS12: Epic 2 — Dropdown option_id resolution via field definitions
FR-CS19: Epic 2 — IPMProvider.addComment() verification comment

FR-CS14: Epic 3 — IPMProvider 4xx non-retryable, 5xx retryable
FR-CS15: Epic 3 — IPMProvider.addComment() actionable failure comment
FR-CS16: Epic 3 — pm_synced boolean on Ticket model
FR-CS17: Epic 3 — Dashboard "Work Done — Sync Pending" amber state
FR-CS18: Epic 3 — Socket.IO pm-sync-failed event + toast

---

## Epic List

### Epic 0: PM Tool Integration Framework

Teams connect any supported PM tool (ClickUp, Jira, Asana) to a DSF project via
OAuth. DSF captures its bot identity per workspace at connect time, manages
per-integration polling and webhook sync, and routes all provider events through
a single normalized pipeline. ClickUp is the first implementation.
**FRs covered:** FR-CS0A through FR-CS0K
**Prerequisite for:** Epics 1, 2, 3

### Epic 1: Per-Project Workflow Configuration

PMs select their team's exact AI trigger status from a live dropdown of their PM
tool's actual workflow statuses — replacing all hardcoded maps and env-vars. The
intake pipeline gates all incoming tasks: only those that reach the PM-configured
trigger status enter the development queue. DSF auto-assigns itself to tasks when
execution starts using its OAuth bot identity.
**FRs covered:** FR-CS1, FR-CS2, FR-CS3, FR-CS4, FR-CS5, FR-CS6, FR-CS7, FR-CS13, FR-CS20

### Epic 2: Intelligent Required Field Pre-Check & Auto-Fill

Before pushing any status update, DSF pre-checks required fields, fills what it
knows (execution time, PR link, dates), and uses AI to infer the rest — so status
transitions succeed without manual intervention wherever possible.
**FRs covered:** FR-CS8, FR-CS9, FR-CS10, FR-CS11, FR-CS12, FR-CS19

### Epic 3: Actionable Sync Failure Handling & Dashboard Visibility

When PM tool sync fails, teams get a clear comment with exact next steps, and the
dashboard shows "Work Done — Sync Pending" as a distinct state separate from
execution failure.
**FRs covered:** FR-CS14, FR-CS15, FR-CS16, FR-CS17, FR-CS18

---

## Epic 0: PM Tool Integration Framework

Teams connect any supported PM tool to a DSF project via OAuth. DSF captures its
bot identity per workspace, manages per-integration polling and webhook sync, and
routes all provider events through a single normalized pipeline.

### Story 0.1: ProjectIntegration Model & Provider Enum

As the **DSF system**,
I want a provider-agnostic database model to store all PM tool connections,
So that ClickUp, Jira, and Asana connections share one consistent schema.

**Acceptance Criteria:**

**Given** the Prisma schema
**When** this story is implemented
**Then** an `IntegrationProvider` enum exists with values: `CLICKUP`, `JIRA`, `ASANA`
**And** a `ProjectIntegration` model exists with all fields defined in FR-CS0A
**And** access_token, refresh_token, and webhook_secret are stored encrypted via EncryptionService
**And** `@@unique([project_id, provider])` constraint exists — one connection per provider per project
**And** `Project` model has `integrations ProjectIntegration[]` relation
**And** a Prisma migration is generated and applied
**And** `pnpm typecheck` passes with zero errors

### Story 0.2: IPMProvider Interface & PMProviderFactory

As a **developer adding a new PM tool integration**,
I want a well-defined interface that all PM providers must implement,
So that Epics 1–3 never need to know which provider they are talking to.

**Acceptance Criteria:**

**Given** `src/integrations/providers/pm-provider.interface.ts`
**When** this story is implemented
**Then** `IPMProvider` interface is defined with all methods from FR-CS0B
**And** each method has explicit TypeScript parameter and return types using normalized DTOs
**And** a `NormalizedTask`, `NormalizedStatus`, `NormalizedField`, `NormalizedFieldValue` shared DTO set exists in `src/integrations/providers/dto/`

**Given** `src/integrations/providers/pm-provider.factory.ts`
**When** `PMProviderFactory.getProvider(integration: ProjectIntegration)` is called
**Then** it returns the correct `IPMProvider` implementation for `integration.provider`
**And** the provider instance is initialized with the workspace-scoped OAuth token
**And** if the token is within 5 minutes of expiry, it is refreshed transparently before being supplied
**And** if `integration.provider` is not a registered implementation, it throws `UnsupportedProviderException`

### Story 0.3: ClickUpProvider — Full IPMProvider Implementation

As the **DSF system**,
I want a complete ClickUp implementation of IPMProvider,
So that all existing ClickUp functionality works through the new provider abstraction.

**Acceptance Criteria:**

**Given** `src/integrations/providers/clickup/clickup.provider.ts`
**When** `ClickUpProvider` is instantiated with a workspace OAuth token
**Then** it implements every method of `IPMProvider`

**Given** `getSelf()` is called
**When** the method executes
**Then** it calls ClickUp `GET /user` and returns `{ id, username }`

**Given** `getStatuses(listId)` is called
**When** the method executes
**Then** it calls `GET /list/{listId}` and returns normalized `NormalizedStatus[]`
**And** results are cached in-memory keyed by `clickup:{listId}` with 5-minute TTL

**Given** `updateStatus(taskId, statusId)` is called
**When** the method executes
**Then** it calls `PUT /task/{taskId}` with `{ status: statusId }`

**Given** `addComment(taskId, comment)` is called
**When** the method executes
**Then** it calls `POST /task/{taskId}/comment` with `{ comment_text: comment }`

**Given** `getRequiredFields(listId)` is called
**When** the method executes
**Then** it calls `GET /list/{listId}/field` and returns fields where `required = true`

**Given** `registerWebhook(workspaceId, endpoint)` is called
**When** the method executes
**Then** it calls `POST /team/{workspaceId}/webhook` with endpoint and relevant events
**And** returns `{ id: webhookId, secret: webhookSecret }`

**Given** `normalizeEvent(payload)` is called with a ClickUp webhook payload
**When** the method executes
**Then** it returns a valid `IRawTaskEvent` using the existing `mapClickUpToTaskEvent` mapper

**And** existing `ClickUpService` is marked `@deprecated` — all callers migrated to `ClickUpProvider` via `PMProviderFactory`

### Story 0.4: Generic OAuth Flow — Backend

As the **DSF system**,
I want a single OAuth handler that works for any registered PM provider,
So that adding Jira or Asana only requires provider config — not a new controller.

**Acceptance Criteria:**

**Given** `GET /api/v1/integrations/{provider}/connect?project_id={id}` is called
**When** the endpoint handles the request
**Then** it looks up the provider's OAuth config (client_id, auth_url, scopes) and redirects to the provider's authorization URL with `state={projectId}:{provider}`

**Given** the provider redirects to `GET /api/v1/integrations/{provider}/callback?code={code}&state={projectId}:{provider}`
**When** the callback is handled
**Then** the code is exchanged for tokens using the provider's token endpoint
**And** `PMProviderFactory.getProvider()` is called with a temporary token to call `getSelf()`
**And** a `ProjectIntegration` record is upserted with all OAuth fields, `bot_user_id`, and `bot_username`
**And** the browser is redirected to project settings with `?integration=connected&provider={provider}`

**Given** ClickUp specifically
**When** the OAuth flow runs
**Then** `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`, `CLICKUP_REDIRECT_URI` are used
**And** the token endpoint is `https://api.clickup.com/api/v2/oauth/token`

**Given** the code exchange or getSelf() call fails
**When** the error is caught
**Then** no `ProjectIntegration` record is created and the browser redirects with `?integration=error&provider={provider}`

### Story 0.5: Connect Integration UI

As a **PM or Admin**,
I want to connect any supported PM tool to a project from the project settings page,
So that teams can self-serve their PM tool connection without DevOps help.

**Acceptance Criteria:**

**Given** a project has no integrations connected
**When** a PM or Admin views project settings
**Then** an "Integrations" section shows available providers (ClickUp, Jira, Asana) each with a "Connect" button

**Given** the PM clicks "Connect" for a provider
**When** the OAuth flow completes successfully
**Then** the provider card shows: "✅ Connected — [Workspace Name] as [Bot Username]"
**And** a "Disconnect" button replaces "Connect"

**Given** the OAuth flow fails or is cancelled
**When** the page reloads with `?integration=error`
**Then** an error toast shows: "[Provider] connection failed — please try again"

**Given** an Admin clicks "Disconnect" on a connected integration
**When** the request is processed
**Then** `ProjectIntegration` is deleted and the provider card returns to "Connect" state

### Story 0.6: Per-Integration Sync Settings UI

As a **PM**,
I want to configure polling interval and webhook toggle for each connected PM tool,
So that I can tune how DSF syncs with my team's tool without DevOps involvement.

**Acceptance Criteria:**

**Given** a provider is connected
**When** the PM views its integration settings
**Then** a "Sync Settings" panel shows: polling toggle, polling interval dropdown (5/10/15/30/60 min), webhook toggle with status (Active / Not Registered), last polled timestamp

**Given** the PM saves sync settings
**When** `PATCH /api/v1/integrations/{integrationId}/sync-settings` is called
**Then** `polling_enabled` and `polling_interval_min` are updated on `ProjectIntegration`
**And** the polling orchestrator respects the new interval within the next evaluation cycle

**Given** both polling and webhook are disabled
**When** the PM saves
**Then** a warning is shown: "No sync method active — DSF will not receive updates from [Provider]"
**And** save is still permitted

### Story 0.7: Provider-Agnostic Polling Orchestrator

As the **DSF system**,
I want the polling orchestrator to work across any connected PM tool,
So that ClickUp, Jira, and Asana tasks are all polled through the same pipeline.

**Acceptance Criteria:**

**Given** multiple `ProjectIntegration` records exist across different providers
**When** the polling scheduler runs
**Then** only integrations with `polling_enabled = true` are processed
**And** each integration is polled using `PMProviderFactory.getProvider(integration)` — provider-agnostic

**Given** an integration is due for a poll (now > `polling_last_run_at + polling_interval_min`)
**When** the poll executes
**Then** updated tasks are fetched via `IPMProvider` and published to `ticket-intake-queue` as `IRawTaskEvent`
**And** `polling_last_run_at` is updated to `now()` on the `ProjectIntegration` record

**Given** an integration's provider API is unreachable during a poll
**When** the error is caught
**Then** the error is logged with provider and workspace ID, Sentry is notified, and the next poll is attempted at the next interval — no crash

### Story 0.8: Per-Integration Webhook Registration & Deregistration

As a **PM**,
I want to register a webhook for my PM tool integration directly from DSF settings,
So that DSF receives real-time updates without polling delays.

**Acceptance Criteria:**

**Given** a PM enables webhook for a connected integration
**When** `PATCH /api/v1/integrations/{integrationId}/sync-settings` is called with `webhook_enabled: true`
**Then** `IPMProvider.registerWebhook(workspaceId, endpoint)` is called where endpoint is `{DSF_PUBLIC_URL}/api/v1/webhooks/{provider}`
**And** the returned `webhookId` and encrypted `webhookSecret` are stored on `ProjectIntegration`
**And** `webhook_enabled` and `webhook_registered_at` are updated

**Given** a PM disables webhook
**When** the request is processed
**Then** `IPMProvider.deregisterWebhook(webhookId)` is called
**And** `webhook_id`, `webhook_secret`, `webhook_registered_at` are cleared
**And** `webhook_enabled` is set to `false`

**Given** webhook registration fails
**When** the error is caught
**Then** `webhook_enabled` remains `false`, the error is surfaced in the UI, and Sentry is notified

### Story 0.9: Multi-Tenant Webhook Routing & Signature Verification

As the **DSF system**,
I want a single webhook endpoint that securely routes events from any connected PM
tool to the correct workspace pipeline,
So that multiple teams using different tools all receive updates through one endpoint.

**Acceptance Criteria:**

**Given** `POST /api/v1/webhooks/{provider}` receives an event
**When** the request is processed
**Then** the provider-specific webhook identifier is extracted from the payload
**And** the matching `ProjectIntegration` is looked up by `webhook_id`
**And** signature verification uses `ProjectIntegration.webhook_secret` (decrypted) for that workspace

**Given** no `ProjectIntegration` matches the webhook identifier
**When** the lookup runs
**Then** the request returns `200 OK` silently and logs a warning with the unknown identifier

**Given** signature verification fails
**When** the check runs
**Then** the request returns `200 OK` (silent rejection), logs a security warning with provider and workspace ID, and increments `pm_webhook_invalid_signature_total` Prometheus counter

**Given** `webhook_enabled = false` on the matched integration
**When** the event is received
**Then** it is acknowledged and discarded — no processing

**Given** two teams from different companies both have ClickUp workspaces connected
**When** events arrive for both concurrently
**Then** each event is processed using its own `ProjectIntegration` token and config
**And** no data from one workspace is accessible during processing of the other

---

## Epic 1: Per-Project Workflow Configuration

PMs select their team's AI trigger status from a live dropdown of actual workflow
statuses fetched from their PM tool. The intake pipeline enforces a development gate:
tasks arriving via webhook or polling only enter DSF's development queue when they
are exactly at the PM-configured trigger status — backlog tasks, in-flight human
work, and completed tasks are silently discarded. DSF auto-assigns itself to tasks
on execution start using its OAuth bot identity. All hardcoded maps and env-vars
are removed.

### Story 1.1: Remove Hardcoded Status Maps and Env-Var Configuration

As a **developer maintaining DSF**,
I want all hardcoded status maps and env-var status configuration removed,
So that there is a clean baseline before the runtime discovery system takes over.

**Acceptance Criteria:**

**Given** the codebase contains hardcoded status references
**When** this story is implemented
**Then** `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK`, `ACTIONABLE_STATUSES`, `NON_ACTIONABLE_STATUSES` are removed from `env.validation.ts`
**And** `webhooks.actionableStatuses` and `webhooks.nonActionableStatuses` are removed from `configuration.ts`
**And** `CLICKUP_STATUS_MAP` export and `mapClickUpStatus()` are removed from `status-evaluation.service.ts`
**And** `mapClickUpStatusToTicketStatus()` is removed from `clickup-task-update.consumer.ts`
**And** `getClickUpStatusName()` with its `config.get()` calls is removed from `deployment-status-sync.service.ts`
**And** all unit tests referencing removed items are updated
**And** `pnpm typecheck` passes with zero errors

### Story 1.2: IPMProvider Status Discovery with Per-Provider Cache

As the **DSF system**,
I want workflow statuses fetched live from any PM tool per project,
So that every team's custom status names are discovered at runtime regardless of provider.

**Acceptance Criteria:**

**Given** a `ProjectIntegration` and a `containerId` (list/board/project ID)
**When** `PMStatusService.getStatuses(integration, containerId)` is called
**Then** it calls `PMProviderFactory.getProvider(integration).getStatuses(containerId)`
**And** results are cached keyed by `{provider}:{containerId}` with 5-minute TTL
**And** a second call within TTL returns cached data without an API call

**Given** the cache for `{provider}:{containerId}` has expired
**When** `getStatuses()` is called
**Then** a fresh API call is made and the cache is updated

**Given** `resolveStatusId(integration, containerId, statusName)` is called
**When** the status name matches an entry (case-insensitive)
**Then** the matching status ID is returned
**And** if no match is found, the raw `statusName` is returned as fallback with a `warn` log

### Story 1.3: Add ai_trigger_status to ProjectIntegration

As the **DSF system**,
I want each PM tool integration to store the status name that triggers AI processing,
So that each team's workflow drives execution — not a global hardcoded value.

**Acceptance Criteria:**

**Given** the `ProjectIntegration` model
**When** this story is implemented
**Then** `ai_trigger_status String?` field exists (added to migration from Story 0.1 or a new migration)
**And** `ClickUpTaskUpdateConsumer.handleTaskUpdate()` reads `integration.ai_trigger_status` to decide whether to trigger AI
**And** if `ai_trigger_status` is null, the task is skipped with a warning log
**And** status comparison is case-insensitive

### Story 1.4: Project Settings — Live Status Picker

As a **PM or Admin**,
I want to pick my team's AI trigger status from a live dropdown of my PM tool's actual statuses,
So that any custom workflow is supported without typing or DevOps changes.

**Acceptance Criteria:**

**Given** a project has a connected integration with a configured `provider_config.containerId`
**When** a PM or Admin views integration settings
**Then** the UI calls `GET /api/v1/integrations/{integrationId}/statuses` and shows a dropdown of live statuses

**Given** the PM selects a status and saves
**When** `PATCH /api/v1/integrations/{integrationId}` is called
**Then** `ai_trigger_status` is updated on `ProjectIntegration`
**And** a success toast confirms "AI trigger status updated"

**Given** the PM tool API is unreachable when loading statuses
**When** the dropdown fetch fails
**Then** an error state shows: "Could not load statuses — check your connection settings"
**And** the existing saved value remains unchanged

### Story 1.5: Auto-Assign DSF Bot to Task on Execution Start

As a **PM**,
I want the PM tool task automatically assigned to the DSF bot when AI execution begins,
So that I can see at a glance in my PM tool which tasks the AI agent is working on.

**Acceptance Criteria:**

**Given** a ticket's execution transitions to `IN_PROGRESS`
**When** the execution start event is processed
**Then** DSF resolves the `ProjectIntegration` for the ticket's project
**And** calls `PMProviderFactory.getProvider(integration).assignTask(taskId, integration.bot_user_id)`

**Given** the assignTask call succeeds
**When** the response is received
**Then** the assignment is logged at debug level — no comment posted to the task

**Given** no `ProjectIntegration` exists or `bot_user_id` is null
**When** execution starts
**Then** the assignment step is silently skipped with a `warn` log — execution proceeds normally

**Given** the assignTask API call returns any error
**When** the error is caught
**Then** it is logged and captured in Sentry — execution is NOT blocked

### Story 1.6: Development Gate — Task Intake Filter

As a **PM**,
I want DSF to only pull tasks into the development queue when they reach the status
I configured as the AI trigger,
So that backlog tasks, in-progress human work, and completed tasks are never
accidentally sent for AI development.

**Acceptance Criteria:**

**Given** a task event arrives via webhook
**When** the ticket-intake pipeline processes it
**Then** the pipeline resolves the `ProjectIntegration` for the task's project
**And** compares the event's task status (case-insensitive) against `ProjectIntegration.ai_trigger_status`
**And** if they match, the task is published to the development queue as an `IRawTaskEvent`
**And** if they do not match, the event is discarded with a `debug` log: `"task {taskId} status '{status}' — not at trigger '{ai_trigger_status}', skipping"`
**And** no error is thrown, no retry is scheduled, and no record is written to the database

**Given** a batch of tasks arrives via polling
**When** the polling orchestrator processes each task
**Then** the same gate logic applies per task — each task's status is checked individually
**And** only tasks at the trigger status are forwarded to the ticket-intake-queue
**And** non-matching tasks are counted in a `pm_polling_tasks_skipped_total` Prometheus counter (labels: provider, project_id)

**Given** `ProjectIntegration.ai_trigger_status` is null or not yet configured for a project
**When** any task event arrives for that project
**Then** all tasks are discarded with a `warn` log: `"project {projectId} integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings"`
**And** `pm_tasks_dropped_no_trigger_total` Prometheus counter is incremented

**Given** a task that was previously at trigger status transitions to a different status (e.g. moves back to backlog)
**When** the event arrives
**Then** the gate discards it — status transitions away from the trigger are not processed
**And** if DSF has an active execution for that ticket, this event does NOT interrupt the running execution (execution lifecycle is independent of incoming status events)

**Given** a task has already been enqueued or is in active execution in DSF
**When** a duplicate webhook event arrives for the same task at the same trigger status
**Then** the intake pipeline deduplicates using `(taskId, provider)` — the duplicate is discarded silently

---

## Epic 2: Intelligent Required Field Pre-Check & Auto-Fill

Before pushing any status update, DSF pre-checks required fields via IPMProvider,
auto-fills factual data, uses AI to infer the rest, and posts a transparency comment
for all auto-filled values.

### Story 2.1: Required Field Pre-Check Before Status Push

As the **DSF system**,
I want to identify empty required fields on a task before attempting a status update,
So that I know exactly what needs filling before the push.

**Acceptance Criteria:**

**Given** a `ticketId`, `containerId`, and resolved `ProjectIntegration`
**When** `PMFieldPreCheckService.checkRequiredFields(integration, ticketId, containerId)` is called
**Then** `IPMProvider.getRequiredFields(containerId)` and `IPMProvider.getTask(taskId)` are called in parallel
**And** both complete within 2 seconds
**And** returns `{ missingFields: [{ id, name, type, options? }], allFilled: boolean }`

**Given** a required field has a non-null, non-empty value on the task
**When** the pre-check runs
**Then** that field is NOT included in `missingFields`

**Given** either API call fails
**When** the pre-check runs
**Then** returns `{ missingFields: [], allFilled: true, preCheckFailed: true }` — fail-open, status push proceeds

### Story 2.2: Auto-Fill Factual Fields from DSF Execution Data

As the **DSF system**,
I want to automatically populate PM tool fields where I have exact data from the execution record,
So that required fields are filled without AI inference or human intervention.

**Acceptance Criteria:**

**Given** a missing required field of type `number` matching `time|duration|estimate` (case-insensitive)
**When** `PMFieldAutoFillService.fillFactualFields(integration, taskId, missingFields, executionContext)` runs
**Then** the field is filled with execution duration in minutes via `IPMProvider.setFieldValue()`

**Given** a missing required field of type `date` matching `completion|deployed|done`
**When** auto-fill runs
**Then** the field is filled with `deployment.deployed_at` as a Unix millisecond timestamp

**Given** a missing required field of type `url` or `text` matching `pr|pull.request`
**When** auto-fill runs
**Then** the field is filled with `githubPush.pr_url`

**Given** a missing required field of type `text` matching `branch`
**When** auto-fill runs
**Then** the field is filled with the execution's `github_branch`

**Given** a field does not match any factual pattern
**When** auto-fill runs
**Then** it is returned in `remainingFields` for AI inference

### Story 2.3: AI-Inferred Field Fill for Estimatable Fields

As the **DSF system**,
I want to use AI to infer values for estimatable fields from execution context,
So that fields requiring judgment are filled automatically.

**Acceptance Criteria:**

**Given** remaining unfilled required fields after factual fill
**When** `PMFieldAutoFillService.fillInferredFields(integration, taskId, remainingFields, executionContext)` runs
**Then** a single Claude prompt is sent with field names, types, valid options (for dropdowns), ticket description, diff size, files changed, retry count, QA summary
**And** Claude returns `{ fieldId: inferredValue }` for each field it can infer
**And** each value is set via `IPMProvider.setFieldValue()`

**Given** a field is a dropdown/select type
**When** the AI response is mapped
**Then** the AI text is matched case-insensitively to available option labels
**And** the matching option ID is used in `setFieldValue()` — not the label string
**And** if no match, the field is added to `stillMissingFields`

**Given** a field is of type `people` or `assignee`
**When** the field is encountered
**Then** it is skipped (handled by Story 1.5) and added to `manualFields`

**Given** AI inference times out (> 10 seconds) or fails
**When** the error occurs
**Then** all remaining fields are added to `manualFields` — status push is not blocked

### Story 2.4: Post Auto-Fill Verification Comment

As a **PM**,
I want a comment posted on my task whenever DSF auto-fills any fields,
So that I can verify AI-estimated values before using them for billing or reporting.

**Acceptance Criteria:**

**Given** one or more fields were auto-filled
**When** all fill attempts are complete
**Then** `IPMProvider.addComment()` posts a comment listing every filled field, its source, and its value
**And** the comment includes: "Auto-filled by DSF — please verify before using for billing or reporting"

**Given** fields filled with factual DSF data
**When** the comment is generated
**Then** those fields are labelled "✅ Factual (measured by DSF)"

**Given** fields filled by AI inference
**When** the comment is generated
**Then** those fields are labelled "🤖 AI-estimated — please verify"

**Given** no fields were auto-filled
**When** the flow completes
**Then** no verification comment is posted

---

## Epic 3: Actionable Sync Failure Handling & Dashboard Visibility

When PM tool sync fails, teams get a clear comment with exact next steps. The DSF
dashboard shows "Work Done — Sync Pending" as a distinct amber state that clears
automatically when the PM tool confirms the status change.

### Story 3.1: Fix PM Provider Error Classification — 4xx vs 5xx

As the **DSF system**,
I want all PM provider implementations to treat 4xx errors as permanent and 5xx as transient,
So that automation-blocked or validation-rejected updates are never retried.

**Acceptance Criteria:**

**Given** any `IPMProvider` method receives a 4xx response
**When** the error is evaluated
**Then** it is thrown immediately as a non-retryable `PMProviderClientError` with the response body preserved
**And** no retry is attempted

**Given** a 5xx response or network error (ECONNRESET, ETIMEDOUT, ENOTFOUND)
**When** the error is evaluated
**Then** it is retried with exponential backoff (max 3 attempts: 1s, 2s, 4s)

**Given** `PMProviderClientError` includes a provider error code (e.g. ClickUp ECODE)
**When** the error propagates to the caller
**Then** the error code is preserved and available for comment generation in Story 3.3

### Story 3.2: Track PM Sync State on Ticket Model

As the **DSF system**,
I want to track whether a completed ticket's status has been synced to the PM tool,
So that execution completion and PM tool sync are independent states.

**Acceptance Criteria:**

**Given** the Prisma `Ticket` schema
**When** this story is implemented
**Then** `pm_synced Boolean @default(true)` field exists on `Ticket`
**And** a Prisma migration is generated and applied

**Given** a PM tool status push succeeds
**When** the result is processed
**Then** `ticket.pm_synced` is set to `true`

**Given** a PM tool status push fails (any error)
**When** the failure is handled
**Then** `ticket.pm_synced` is set to `false`
**And** `AuditLogService` records: `action: 'pm_sync_failed'`, provider, error code, correlation ID

**Given** `pm_synced = false` on a ticket with execution status `COMPLETED` or `DEPLOYED`
**When** the ticket state is evaluated
**Then** this represents the "Work Done — Sync Pending" state

### Story 3.3: Post Actionable Failure Comment on PM Tool Task

As a **PM**,
I want a clear comment on my task whenever DSF cannot update its status,
So that I know exactly what happened and what I need to do.

**Acceptance Criteria:**

**Given** a status push fails after all retries
**When** the failure is handled
**Then** `IPMProvider.addComment()` posts a comment containing:

- Confirmation that DSF completed its work
- The specific failure reason (from `PMProviderClientError` body)
- The target status DSF was trying to set
- Numbered manual steps for the PM
- Any fields still requiring manual input

**Given** the failure was a missing required field DSF could not fill
**When** the comment is generated
**Then** the field name and type are explicitly named

**Given** the failure was a provider automation rule
**When** the comment is generated
**Then** the provider's error message is quoted verbatim

**Given** posting the comment itself fails
**When** the error is caught
**Then** it is logged and Sentry is notified — the overall flow does not throw again

### Story 3.4: Dashboard Sync Pending State & Real-Time Alert

As a **PM**,
I want tickets where DSF finished but the PM tool needs a manual update shown as a
distinct amber state on my dashboard,
So that I can action them without confusing them with execution failures.

**Acceptance Criteria:**

**Given** a ticket has `pm_synced = false` and execution status `COMPLETED` or `DEPLOYED`
**When** the PM dashboard data is fetched
**Then** the ticket is returned with status label `SYNC_PENDING`
**And** it is displayed in amber — visually distinct from red `FAILED` tickets

**Given** `pm_synced` transitions to `false`
**When** the transition is persisted
**Then** the Socket.IO gateway emits `pm-sync-failed` to the PM's room with `{ ticketId, provider, reason, missingFields }`

**Given** a PM receives the `pm-sync-failed` event
**When** the dashboard processes it
**Then** an amber toast appears: "PM tool update needed — [ticket title]"
**And** the ticket card updates to `SYNC_PENDING` without a page refresh

**Given** a PM manually updates the task and the status change arrives via webhook or polling
**When** the incoming status matches the expected post-sync status
**Then** `pm_synced` is set to `true` and the `SYNC_PENDING` state clears from the dashboard
