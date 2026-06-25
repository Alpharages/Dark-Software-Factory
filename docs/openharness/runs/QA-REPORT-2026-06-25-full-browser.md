# Full Browser QA — Production Readiness Report (2026-06-25, session 2)

Tester: automated browser QA as **ADMIN** (`admin@darksoftwarefactory.com`) via chrome-devtools.
Stack: backend `:3000`, frontend `:5173`, branch `qa-fixes-2026-06-25`. Both healthy throughout.

## Scope covered

- **All ~28 frontend routes** walked as ADMIN; console errors + network (XHR/fetch) captured per page.
- **Forms exercised through the real FE code path / exact FE payloads**: New Project (full UI submit), Create Invite (full UI submit), Notification Preference, Architecture Constraint, Capability Limitation, Conversation transcript intake.
- **Ticket lifecycle**: data model, state machine, control + monitoring APIs verified against the 4 real COMPLETED executions. A full _live_ AI run was **not** fired (see verdict).

## Verdict

**Not production-ready yet.** Core nav, dashboards, project creation, and the execution
monitoring/state-machine are solid, and the AI execution loop itself was already validated in
OHP-2.6 (subscription-based Claude Code CLI, no API cost). The blockers are in the **control
shell**: **2 broken features** (ADR Review Queue 400, Conversation intake 500) and a **systemic
auth-field bug** (`user.sub` → undefined) that corrupts user attribution/scoping. Fix the HIGH
items below; a fresh supervised live ticket run is optional (the loop is already proven).

## Findings

| #   | Sev          | Area                      | Issue                                                                                                                                                                                                                                                                                                                             | Fix location                                                                                                                                                                                    |
| --- | ------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4  | **HIGH**     | Architecture Review Queue | Page is fully broken — `GET /architecture-review/queue?...&sort_order=asc` → **400** "sort_order must be ASC or DESC". FE sends lowercase, BE enum requires uppercase (then lowercases internally anyway).                                                                                                                        | BE `architecture-review/dto/adr-queue-query.dto.ts:37` (accept case-insensitive) — or FE send uppercase                                                                                         |
| F6  | **HIGH**     | Conversations             | Transcript **and** audio intake → **500**. Controller passes `user.sub` but `JwtStrategy.validate()` returns `{ id, ... }` (no `sub`), so `pm_id=undefined` → Prisma create rejects. Whole feature dead.                                                                                                                          | BE `conversations/conversations.controller.ts:109,125` → use `user.id`                                                                                                                          |
| F7  | MED          | Auth (systemic)           | Same `user.sub`→`undefined` in pm-dashboard (×4), decision-dashboard (×2), anomaly-detection (×2), reports (×3), system-config (×4). No 500, but PM dashboard isn't user-scoped and audit attributes actions to `undefined`/'unknown'.                                                                                            | Standardize on `user.id`; ESLint-ban `.sub` outside `auth/`                                                                                                                                     |
| F3  | MED          | Capacity Monitor          | `GET /workload/pm/{adminId}` and `/workload/trends/{adminId}` → **404** for ADMIN (no PM record). 5 console errors; personal-workload widgets dead (team view OK).                                                                                                                                                                | BE return empty 200 for missing PM, or FE skip for non-PM roles                                                                                                                                 |
| F1  | MED          | Financial Metrics         | "Detailed Model Metrics" shows **"Failed to load model efficiency data"** when API returns a valid empty result (`models:[]`). On any fresh instance this always reads as broken.                                                                                                                                                 | FE `components/financial/ModelEfficiencyTable.tsx:36` — split empty-state from error-state                                                                                                      |
| F2  | LOW          | Financial Metrics         | Renders literal "Epic undefined" / "MOST EFFICIENT N/A" / "$0%" when data sparse.                                                                                                                                                                                                                                                 | Guard undefined epic names                                                                                                                                                                      |
| F8  | MED          | Config / cost             | **Migrate the 3 direct-API consumers to the subscription path, then remove `ANTHROPIC_API_KEY`.** The key is NOT the execution path (execution = Claude Code CLI on subscription) and is a pay-per-token pattern that contradicts the subscription model. DSF must have zero API spend.                                           | New `SubscriptionCompletionService` (one-shot `claude -p`) → refactor 3 call sites → remove key from `.env`/`.env.example:162`/`configuration.ts:163` + `@anthropic-ai/sdk` dep. See F8 detail. |
| F5  | NEEDS-VERIFY | Invitations               | Tab repeatedly hard-crashed / route nav timed out during testing; user observed hangs. **But** no React "Maximum update depth", DOM nodes stable, heap GCs, modal+create works (201). Idle heap is high (~100–160MB / 276 nodes). Likely automation-browser OOM, not a confirmed app loop — profile in a real browser to be sure. | (investigate) `InvitationsTable.tsx:61` columns not memoized (minor)                                                                                                                            |

## What works (verified)

- Routes render clean (0 console errors, all XHR 200): Dashboard, Executions, Profile, Conversations (search), Projects/Sync, Decisions, Audit Logs, Resource Manager, Cost, Capabilities, Users, Production Errors (+socket.io), Approvals, Observability, Notification Prefs, all Settings tabs.
- **New Project**: required-field + GitHub-URL validation ✅, `POST /projects` → 201, persisted ✅.
- **Create Invite**: `POST /auth/invitations` → 201 ✅.
- **Notification Pref / Constraint / Capability Limitation**: all `POST` → 201 with the FE's exact payloads ✅.
- **Execution state machine**: invalid transition (pause COMPLETED) → 409 ✅; test-trigger validation → 400 ✅; status/logs/activities reads → 200 ✅.
- Realtime Socket.IO connects.

## Cross-cutting observations

- OBS1: `GET /auth/me` fires **4×** on every page load — dedupe via AuthContext/React-Query.
- OBS2: `/production-errors` opens **two** Socket.IO connections (two sids) — possible duplicate client.
- OBS3: several list endpoints fetched 2× on mount (`/users`, `/auth/invitations`, `/pm-dashboard/projects`).

## Lifecycle — execution model (corrected)

Execution does **not** use the Anthropic API. Per the OpenHarness pivot, runs go through the
**first-party Claude Code CLI on a Claude subscription** — `config/configuration.ts:134`
`OPENHARNESS_RUNTIME="claude"` → `scripts/claude-run-skill.sh`, model `sonnet`,
`isolateWorkspace=true`. Flat-rate, **zero marginal cost** (`ANTHROPIC_API_KEY` in `.env` is
vestigial, not the execution path). Driven by ClickUp status via the OHP-2 dispatcher; manual
entry point `POST /api/v1/executions/test`.

The **full implement→review→QA→approve loop was already validated in OHP-2.6** (ticket
`86ey22p7b`: `to do → ready for review → ready for qa → Closed`, QA passed, with a real
`changes_requested → re-implement` loop-back) — see `docs/epics.md`. This QA session did **not**
re-run a live loop; I verified the control/monitoring/state-machine surfaces are healthy
(status/logs/activities 200, invalid-transition 409, trigger-validation 400). The local DB shows
0 approval/PR/QA rows only because per-leg artifacts aren't retained in-repo (same convention as
OHP-1.2/OHP-2.6) and the validated run used auto-approve — not because the tail is unproven.
A fresh supervised run (subscription, no cost) against a throwaway ClickUp ticket can be done on
request.

## F8 detail — removing `ANTHROPIC_API_KEY` (safe, but disables 3 ancillary AI features)

`ANTHROPIC_API_KEY` is **not** required at boot — `env.validation.ts` does not mandate it, and
every consumer null-guards (`apiKey ? new Anthropic({apiKey}) : null`). So deleting the env var
(and the `apiKey` line in `configuration.ts:163`) will not crash the app. But it is **not the
execution runtime** — execution is the subscription-based Claude Code CLI. The key is only used
by three direct, pay-per-token Anthropic API consumers, which silently go to their fallback/no-op
when it's absent:

| Consumer                 | File                                                   | Feature lost without the key                 |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------- |
| PM field auto-fill       | `integrations/pm-field-auto-fill.service.ts:50`        | AI auto-fill of missing PM/ticket fields     |
| PR orchestrator          | `github/services/github-pr-orchestrator.service.ts:43` | AI-generated PR description / commit message |
| File-conflict prediction | `file-locks/file-prediction.provider.ts:29`            | AI prediction of files a ticket will touch   |

**Decision (agreed): migrate these 3 consumers to the subscription path, then remove the API key.**
DSF must have **zero pay-per-token Anthropic usage** — all AI goes through the Claude subscription,
consistent with the execution runtime. Plan:

1. **Add a one-shot subscription completion helper** (e.g. `SubscriptionCompletionService`) that
   shells out to the first-party `claude` CLI in print mode — mirroring `scripts/claude-run-skill.sh`
   but without MCP/skills:
   `claude -p "<prompt>" [--append-system-prompt "<system>"] --model sonnet --output-format json --max-turns 1`
   spawned with **`ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN` unset for the child** (so the CLI draws
   the subscription plan, not the API key — same trick as the skill runner), with an in-process
   timeout + non-zero-exit → throw. Parse the CLI's JSON envelope (`.result`) and return the text.
   Confirmed available locally: `claude` 2.1.190 on PATH.
2. **Refactor the 3 call sites** to call the helper instead of `new Anthropic().messages.create()` —
   all three already build a prompt → expect JSON text → parse → fall back, so the swap is clean and
   their existing fail-open/timeout/fallback behavior is preserved (gate on helper availability instead
   of `anthropic.apiKey`):
   - `file-locks/file-prediction.provider.ts:46` (heuristic fallback already exists)
   - `integrations/pm-field-auto-fill.service.ts:193` (system prompt + 10s timeout)
   - `github/services/github-pr-orchestrator.service.ts:326` (title/body fallback already exists)
3. **Remove** `ANTHROPIC_API_KEY` from `.env` + `.env.example:162`, the `anthropic.apiKey` line in
   `configuration.ts:163`, and the `@anthropic-ai/sdk` dependency once no code imports it. Boot is
   unaffected (`env.validation.ts` never required the key).

(This QA pass only documents the plan — no code changed.)

## Test data created (in dev DB — clean up if undesired)

Project "QA Test Project" (`cd6740a5…`), invitation `qa.invite.test@example.com`, 1 notification pref, 1 architecture constraint, 1 capability limitation (CODE_GENERATION).
