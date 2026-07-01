---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
inputDocuments:
  - docs/openharness-pivot-plan.md
author: John (PM)
status: Proposed
date: 2026-06-19
---

# Dark Software Factory — Epic Breakdown (OpenHarness Pivot)

## Overview

This document decomposes the **DSF Engineering Pivot** (`docs/openharness-pivot-plan.md`)
into implementable epics and stories. The pivot re-architects DSF from a bespoke AI
execution platform into a thin **control shell** over a four-layer stack:

- **Workflow brain** — BMAD skills (`bmad-mcp-server`): implement→review→QA logic + the
  ClickUp state machine (already built).
- **Memory** — Lore: lessons, patterns, sessions, propagation (already built).
- **Engine** — OpenHarness: runs a BMAD skill headlessly via MCP, on a Codex/Claude
  subscription.
- **Control shell** — DSF: status→skill dispatcher, live dashboards, execution/cost/audit,
  human approval gate, and the multi-tenant ClickUp OAuth credential vault.

DSF **deletes** its bespoke runtime (`ai-routing/`, `execution/` state machine, bespoke
`sandbox/`, bespoke `qa-automation/`, prompt-gen) because the BMAD skills + ClickUp statuses
already are the state machine.

## Epic Summary

| Epic  | Name                                                       | Phase | Status   | Depends on |
| ----- | ---------------------------------------------------------- | ----- | -------- | ---------- |
| OHP-0 | Pivot Validation Spike                                     | 0     | ✅ Done  | —          |
| OHP-1 | OpenHarness Engine + BMAD/Lore Integration (single-tenant) | 1     | ✅ Done  | OHP-0      |
| OHP-2 | Status-Driven Dispatcher + Loop + Approval Gate            | 2     | ✅ Done  | OHP-1      |
| OHP-3 | Decommission Bespoke DSF Runtime                           | 3     | Proposed | OHP-2      |
| OHP-4 | Multi-Tenant Control Plane + Productionize                 | 4     | Proposed | OHP-2      |

**Sequencing:** OHP-0 → OHP-1 → OHP-2 → (OHP-3 and OHP-4 in parallel). OHP-3 must not begin
until OHP-2 proves the dispatcher is the sole execution path.

---

## Epic OHP-0 — Pivot Validation Spike ✅ Done

**Goal:** Prove, before any re-architecture, that a powerful agent harness can be driven
headlessly on a subscription and produce near-mergeable work that streams to a dashboard.

**Outcome (validated 2026-06-18):** OpenHarness `0.1.9` on a Codex subscription; Stage A
(toy bug-fix, headless, parsed Execution record) and Stage B (real SmartPocket Story 7.1,
26/26 tests pass, build not broken, ~90% mergeable). Key lesson: green tests ≠ correct
(month-end drift bug the agent's own test missed) → a human review/approval gate is mandatory.

### Stories

- **OHP-0.1** Provision OpenHarness + Codex-subscription auth; dry-run readiness — _done_
- **OHP-0.2** Stage A: headless drive on a toy repo → parsed `Execution` record — _done_
- **OHP-0.3** Stage B: real full-stack story; independent verification + verdict — _done_

---

## Epic OHP-1 — OpenHarness Engine + BMAD/Lore Integration (single-tenant) ✅ Done

**Goal:** Run the _real_ workflow (a BMAD skill), not a raw prompt, through OpenHarness on
one real ticket from your own ClickUp — and capture/stream the result into DSF.

**Depends on:** OHP-0. **Scope:** single-tenant (your ClickUp token), local MVP, no RabbitMQ
required yet.

**Outcome (verified 2026-06-25):** All five stories landed and are exercised end-to-end by the
downstream OHP-2 dispatcher loop, which runs entirely on this epic's runner + stream adapter +
Execution persistence. QA gate green: `pnpm typecheck`, `pnpm lint`, `nest build`, and the full
Jest suite (170 suites / 1726 tests) all pass; the OpenHarness module alone covers 6 suites / 50
tests. Code surfaces: MCP wiring (`openharness/mcp-config.json` → bmad + lore + gitnexus,
`scripts/oh-mcp-smoke.sh`, `docs/openharness/mcp-setup.md`); headless skill run wrappers
(`scripts/oh-run-skill.sh`, `scripts/claude-run-skill.sh`); per-ticket runner
(`openharness/openharness-runner.service.ts` + `openharness-stream.parser.ts` → persists an
`Execution` row with status/files/tools/summary, failures recorded with terminal status);
stream→realtime adapter (`openharness/stream/openharness-stream.adapter.ts` maps
`tool_started`/`assistant_delta`/`assistant_complete` → `execution-activity`/`execution.log`);
and the local MVP entry point (`POST /api/v1/executions/test`,
`openharness/openharness-execution.controller.ts`, config-driven run profile in
`config/configuration.ts`). _Note:_ the OHP-1.2 per-leg `oh`/Claude stream logs were intentionally
not retained in-repo (same convention as OHP-2.6); the durable record is the live ClickUp trail and
this Outcome block. Lore lesson-saving is AI-discretionary — zero writes on a no-signal run is the
correct outcome, not a gap (see `docs/AI-CONTEXT.md`).

### Stories

- **OHP-1.1 — Wire BMAD + Lore into OpenHarness as MCP servers.**
  Configure `oh` (`oh mcp` / `--mcp-config`) to connect to `bmad-mcp-server` and `lore`.
  _AC:_ `oh --dry-run` lists both MCP servers as configured; a smoke call reaches a `bmad`
  list op and a `lore` query.
- **OHP-1.2 — Run `clickup-dev-implement` headlessly on one real ticket.**
  Drive the skill end-to-end via OpenHarness on the Codex subscription.
  _AC:_ the skill completes; code is produced; ClickUp status moves to `in review`; lessons
  saved to Lore. _AC:_ validate skill-following fidelity on `gpt-5.4` (and capture whether a
  Claude profile is needed). _AC:_ confirm OpenHarness can drive `bmad({operation:"execute"})`
  through the full multi-step workflow.
- **OHP-1.3 — Per-ticket runner.**
  Service that spawns `oh` for a ticket, reads `stream-json` from stdout, and persists a
  `DSF.Execution` record (status, files changed, tools used, summary).
  _AC:_ a run produces a stored Execution row; failures recorded with status.
- **OHP-1.4 — Stream→RealtimeGateway adapter.**
  Map OpenHarness events (`tool_started`, `assistant_delta`, `assistant_complete`) →
  DSF `execution.activity`/`log`/`completed`; emit via existing `RealtimeGateway`.
  _AC:_ live activity feed renders on the DSF dashboard during a run.
- **OHP-1.5 — Local MVP entry point.**
  `POST /api/v1/executions/test` + a minimal run profile to trigger a skill run locally.
  _AC:_ one command starts infra + backend; one request runs a ticket and returns a visible
  execution result.

---

## Epic OHP-2 — Status-Driven Dispatcher + Loop + Approval Gate ✅ Done

**Goal:** Automate the implement→review→QA loop you run manually today, driven entirely by
ClickUp status — with a human gate before merge.

**Depends on:** OHP-1.

**Outcome (validated 2026-06-25):** The full status-driven loop ran hands-off end-to-end on an
independent throwaway ticket (`86ey22p7b`): `to do → ready for review → ready for qa → Closed`,
QA PASSED, plus a genuine `changes_requested → re-implement → approved` loop-back in the prior
pass. Validation surfaced and fixed three real dispatch defects (no workspace isolation,
double-dispatch, cross-leg diff loss), each with tests. QA gate green: typecheck, lint, `nest
build`, and full Jest suite (170 suites / 1726 tests) all pass. The per-leg run artifacts were not
retained in-repo; the durable record is the live ClickUp trail on `86ey22p7b`. _Residual:_ AC3's
manual approval
hold was not exercised in the live run (auto-approve was on); the gate logic is covered by unit
tests (`approval-gate.service.spec.ts`, `approval-gate.controller.spec.ts`) — refuses merge
without a recorded decision, atomic single-merge claim, fails closed on missing decider.

### Stories

- **OHP-2.1 — Status→skill mapping/config.**
  Declarative map of which ClickUp status triggers which BMAD skill.
  _AC:_ config-driven; no hardcoded status names in logic. — _done_ (`config/status-skill-map.config.ts`,
  `openharness/status-skill-map.service.ts`; `STATUS_SKILL_MAP` env override, normalized lookups).
- **OHP-2.2 — Dispatcher service.**
  React to ClickUp status changes (via existing multi-tenant webhooks) → spawn the matching
  skill run through the OHP-1 runner.
  _AC:_ a status change to the trigger status starts `clickup-dev-implement`; `in review`
  starts `clickup-code-review`; `ready for qa` starts `clickup-qa`. — _done_ (`dispatcher/dispatcher.service.ts`
  → `OpenHarnessRunnerService.runForTicket`).
- **OHP-2.3 — Loop handling.**
  `changes_requested`/`failed` → re-dispatch `clickup-dev-implement`; `approved` → QA;
  `passed` → done.
  _AC:_ a rejected review loops back to implement automatically; idempotent (no double-runs). — _done_
  (loop-cap `LOOP_MAX_ITERATIONS`, in-flight per-ticket lock, active-execution check).
- **OHP-2.4 — Human review/approval gate.**
  No blind auto-merge — an explicit approval step before the PR merges. UI + backend.
  _AC:_ a run cannot merge without recorded approval; the gate is visible in the dashboard. — _done_
  (`approval-gate/`: `openGate`/`recordDecision`/`approve`/`loopBack`, atomic gate claim, role-gated
  API, `ApprovalRecord` audit trail; emits `execution.approval-required`).
- **OHP-2.5 — Run guardrails.**
  Format only the agent's own files; wire any repo-mandated MCP tools (e.g. GitNexus);
  enforce `max-turns`/timeouts.
  _AC:_ a run never reformats unrelated files; mandated tools available or the run flags it. — _done_
  (`openharness/run-guardrails.service.ts`: format-own-files allowlist + traversal guard; mandated-MCP
  warn/fail mode; `OPENHARNESS_MAX_TURNS`/`OPENHARNESS_RUN_TIMEOUT_MS`).
- **OHP-2.6 — End-to-end loop validation.**
  One real ticket flows intake → implement → review → (loop) → QA → approved, hands-off
  except the gate.
  _AC:_ documented passing run with the full status trail in ClickUp. — _done_ (see Outcome above;
  durable record is the live ClickUp trail on `86ey22p7b`).

---

## Epic OHP-3 — Decommission Bespoke DSF Runtime

**Goal:** Delete the painful 80% — the hand-built runtime now redundant with BMAD skills +
ClickUp statuses + OpenHarness.

**Depends on:** OHP-2. **Guardrail (applies to OHP-3.1 & OHP-3.2):** deletion may not begin
until OHP-2 proves the dispatcher is the sole execution path; each deletion exits with
`pnpm check` green and dashboards intact.

### Stories

- **OHP-3.1 — Remove `ai-routing/` entirely.**
  Delete the provider factory, fallback strategy, complexity scorer, and all wiring/tests.
  _AC:_ module gone; `app.module.ts` and queues cleaned; `pnpm check` green.
- **OHP-3.2 — Remove `execution/` state machine + retry/self-healing entirely.**
  Delete the bespoke state machine, retry handler, self-healing orchestrator.
  _AC:_ bespoke runtime gone (`ai-execution.consumer`, `retry.consumer`, retry/self-healing
  code); no references remain; `pnpm check` green. _Note:_ the `execution/` module is **retained
  and repurposed** as the execution-record store (tracker, repository, gateway, log streaming,
  activity persistence) that the OpenHarness runner writes to — only the bespoke state-machine
  and retry/self-healing code was deleted, not the directory.
- **OHP-3.3 — Replace bespoke `sandbox/`+`docker/` exec.**
  Remove custom execution plumbing; keep only the thin container wrapper around `oh`.
  _AC:_ only the OpenHarness container wrapper remains; old exec paths deleted.
- **OHP-3.4 — Reduce `qa-automation/` to policy gates.**
  Remove the bespoke QA pipeline; keep configurable gates as policy (the agent runs tests).
  _AC:_ pipeline code removed; gate config retained and honored.
- **OHP-3.5 — Remove prompt-gen + cleanup.**
  Delete prompt generation; clean dead config/env vars; verify tests + dashboards.
  _AC:_ dead code/env removed; `pnpm check` green; dashboards unaffected.

---

## Epic OHP-4 — Multi-Tenant Control Plane + Productionize

**Goal:** Make the factory safe for real/multi-customer use by layering DSF's existing
OAuth vault (CS0–CS5) back in as the control plane that feeds isolated single-tenant runs.

**Depends on:** OHP-2. **Note:** deferred until the loop is proven single-tenant. Lore is
natively multi-project (no Lore code change — provision + inject a per-tenant token);
only `bmad-mcp-server` needs a code change (OHP-4.2).

### Stories

- **OHP-4.1 — Per-run credential injection.**
  DSF decrypts the tenant's credentials and injects them into an isolated `bmad`+`lore` run;
  one run = one tenant. Two sources, differing in difficulty:
  - **Lore** — inject the deployed Lore URL + the tenant's bearer token (`lore_<slug>_…`),
    registering the MCP server under the name `lore-memory-<slug>` (the bmad skills' tool
    names embed the slug). No Lore code change — Postgres RLS scopes everything by the token.
  - **ClickUp** — inject the tenant's OAuth token + `TEAM_ID` (requires the bmad change, OHP-4.2).
    _AC:_ a run uses only the dispatched tenant's credentials; no cross-tenant leakage
    (Lore RLS verified — lessons land only in that tenant's project).
- **OHP-4.2 — Update `bmad-mcp-server` for ClickUp OAuth (cross-repo, deferred).**
  Relax `clickup-env.ts` to accept OAuth tokens (not just `pk_`) + per-run `CLICKUP_TEAM_ID`.
  _AC:_ bmad authenticates to ClickUp with an injected OAuth access token.
- **OHP-4.3 — OAuth token refresh on spawn.**
  Reuse DSF's refresh handling to inject a fresh token at each run.
  _AC:_ runs never fail due to an expired token.
- **OHP-4.4 — Container-per-run isolation.**
  Each `oh` run executes in an ephemeral container; the tenant secret lives only there.
  _AC:_ concurrent runs for different tenants are OS-isolated.
- **OHP-4.5 — Cost/usage capture + reporting.**
  Pull usage from the OpenHarness SDK/transcript into `cost-tracking` + reports.
  _AC:_ per-run cost/usage recorded and visible in dashboards.
- **OHP-4.6 — ToS/licensing + billing decision (decision spike).**
  Decide subscription (internal) vs API billing (commercial multi-tenant SaaS).
  _AC:_ a written decision with the chosen model and its triggers.
- **OHP-4.7 — Lore tenant provisioning.**
  On tenant onboarding, DSF calls Lore `POST /api/projects/register` (auth: `ADMIN_SECRET`),
  maps the customer/org → one Lore project (its repos → Lore repos), and stores the returned
  `api_key` ENCRYPTED in its vault (plaintext is returned once only). Lazy + idempotent: reuse
  the stored key if already mapped; regenerate via the admin key if lost.
  _AC:_ onboarding a tenant yields a usable, isolated Lore project; provisioning twice does not
  duplicate or error; the key is never persisted in plaintext.

---

## Open Questions / Decisions

- Skill-following fidelity on `gpt-5.4` vs Claude — resolved in OHP-1.2.
- Whether OpenHarness can drive the full `bmad` execute workflow — resolved in OHP-1.2.
- Commercial ToS / billing model — resolved in OHP-4.6.
- OpenHarness maturity (young HKUDS/MIT project) — mitigate by vendoring/pinning.

---

# Post-Pivot Feature Epics

These epics extend the post-pivot control shell with new capabilities. They are independent of
the OHP-3/OHP-4 roadmap above and of each other. Authored from an in-session feature discussion
on 2026-07-01.

## Epic Summary

| Epic   | Name                                         | Status   | Depends on | ClickUp                                          |
| ------ | -------------------------------------------- | -------- | ---------- | ------------------------------------------------ |
| Epic A | Skill & Model Routing                        | Proposed | —          | [86ey4235p](https://app.clickup.com/t/86ey4235p) |
| Epic B | Dependency-aware ticket execution sequencing | Proposed | —          | [86ey4237n](https://app.clickup.com/t/86ey4237n) |

---

## Epic A — Skill & Model Routing

**Goal:** Replace DSF's static, single-model, single-account agent execution with (1) a **global
skill→model mapping** managed by admins, (2) a **multi-account, quota-aware load balancer** spanning
Claude + ChatGPT/OpenAI accounts, and (3) a **per-project status→skill map** with a global fallback,
plus per-skill compute stats.

This combines two layers of one system: the skill→model map and status→skill map are the **control
plane**, and the load balancer is the **data plane** that enforces them at dispatch time.

**Depends on:** — (independent). **Scope:** backend routing + admin config UI; no new skills beyond
the existing 3-skill enum.

**Current state (as-is):**

- Model/runtime selection is static & global — `OpenHarnessRunnerService.runForTicket()`
  (`src/openharness/openharness-runner.service.ts:73-79`) reads `openharness.model`/`runtime`/`claudeModel`
  straight from config. No per-skill model choice, no account pool, no failover (`maxRetries: 0`, line 96).
- Skills are a fixed enum of 3 (`src/openharness/skills.enum.ts`): `clickup-dev-implement`,
  `clickup-code-review`, `clickup-qa`.
- The status→skill map is a global env var (`STATUS_SKILL_MAP`), parsed in
  `src/config/status-skill-map.config.ts`, resolved by `StatusSkillMapService.resolveSkill()`.
- `CostOptimizerService.selectOptimalModel()` (`src/cost-tracking/cost-optimizer.service.ts:56`)
  exists but is **dead code** (zero callers) — the natural selector seam.
- No per-skill cost/compute tracking; OpenHarness runs emit **zero** cost rows today.
- ChatGPT/OpenAI via the `oh` runtime is already proven working; Claude runs via
  `scripts/claude-run-skill.sh` on the subscription (zero-token rule still holds — see `docs/AI-CONTEXT.md`).

### Stories

- **A1 — Project-level status→skill map with global fallback.**
  Move `STATUS_SKILL_MAP` out of `.env` into the DB. Per-project `{status, skill}` entries where
  **multiple statuses MAY map to one skill** (e.g. `rejected` + `in progress` → `clickup-dev-implement`).
  Keep a global default map. Resolution: project-level if set, else global default;
  `StatusSkillMapService.resolveSkill()` becomes project-aware.
  _AC:_ env behavior preserved as the global default; a project with no map behaves as today; loop
  terminals (`passed`/`done`) and `loopMaxIterations` still work.
- **A2 — Admin UI: global status→skill defaults.**
  Backend API + dashboard surface to view/edit the global default status→skill map.
  _AC:_ admin can add/remove/edit `{status, skill}` entries; changes take effect without redeploy.
- **A3 — Global skill→model mapping (admin UI).**
  One global map (not per-project): each skill → a model, where each model resolves to a
  **provider + runtime** (e.g. `implement → OpenAI via oh`; `code-review` + `qa → Claude top model via claude`).
  _AC:_ cheap model for `clickup-dev-implement`; top-rated model for `clickup-code-review` and
  `clickup-qa`; map drives the runner's model/runtime choice (replaces static config read).
- **A4 — Multi-account credential pool (encrypted).**
  Pool covering both providers: Claude (`claude` runtime, subscription email/password) and
  OpenAI/ChatGPT (`oh` runtime, already working). Import via **CSV** → **encrypted at rest** using
  existing `ENCRYPTION_KEY`/`common/encryption`. One row per account: `provider`, `runtime`,
  encrypted credentials, per-provider quota config.
  _AC:_ credentials encrypted at rest; CSV is import-only and gitignored, never logged; account can
  be enabled/disabled.
- **A5 — Quota-aware load balancer (core).**
  Track each account's quota — Claude: **5-hour rolling window AND weekly limit** (must not burn one
  account's weekly budget early and starve the rest of the week); OpenAI/ChatGPT: its own limits.
  Pick an account of the right provider for the chosen model (A3), respecting availability + remaining
  budget; rotate/spread; failover when exhausted/failing. Repurpose `CostOptimizerService` as the seam.
  _AC:_ with N accounts, load spreads so no single account is exhausted prematurely; an
  exhausted/failing account is skipped and the next eligible one is chosen.
- **A6 — Wire selection into the runner.**
  `runForTicket()` selects model (A3) → eligible account (A5) → drives the correct wrapper
  (`oh` vs `claude`) + env (`OH_RUN_MODEL`/`CLAUDE_RUN_MODEL`, account credentials); persists
  `selected_model` + account on the `Execution`.
  _AC:_ no static `openharness.model`/`runtime` read on the hot path; chosen model + account recorded.
- **A7 — Per-skill compute stats.**
  Emit a cost/compute record per skill run (none today), aggregated per skill (+ per project).
  _AC:_ each completed run writes a record keyed by skill + project + account/model with
  tokens/cost/duration; aggregation queryable.

**Proposed data model:** `ProjectStatusSkillMap` (or JSON on `Project`); global default map
(`SystemConfig`/table); `SkillModelMap` (global skill → {model, provider, runtime}); `AiAccount`
(pool row, encrypted creds, quota config); `AiAccountUsage` (rolling 5h + weekly accounting);
per-skill cost rows (extend `AICostLog`/`CostRecord` with `skill` + `project_id`, or new table).

**Risks / decisions:**

- **Credential security** — email/password is sensitive; encrypt at rest, gitignore the CSV, never
  log (hard AC on A4).
- **Claude login automation** — subscription login is an interactive OAuth/browser flow, possibly
  MFA/captcha. **Recommend a spike before A5.** ChatGPT via `oh` is already proven, so this narrows
  to Claude only.
- **Quota visibility** — Claude does not cleanly expose remaining 5h/weekly quota; A5 likely tracks
  our own consumption estimates against a configured weekly budget per account.

---

## Epic B — Dependency-aware ticket execution sequencing

**Goal:** DSF must respect ticket/task **dependencies**. If ticket A depends on ticket B, B must
finish executing before A starts. Today the dispatcher treats every ticket independently and has no
dependency awareness.

**Depends on:** — (independent).

**Current state (as-is):** `DispatcherService` (`src/dispatcher/dispatcher.service.ts`) is purely
status-driven and per-ticket — it resolves a skill from status and dispatches immediately
(`runner.runForTicket`, line 210), hardcoding `ai_provider: AIProvider.OPENHARNESS` (lines 193, 273).
No concept of inter-ticket dependencies exists in the dispatch path.

### Stories

- **B1 — Dependency sync (provider-abstracted).**
  Pull ticket dependencies from **ClickUp** native links (`waiting_on` / `blocking`), behind an
  abstraction so **Jira / Asana** can plug in later (each provider has its own representation).
  _AC:_ ClickUp dependency links are synced into DSF; source is abstracted behind a provider
  interface; existing ClickUp sync/polling is reused where possible.
- **B2 — Dependency model.**
  Store blockers / blocked-by per ticket in DSF's DB.
  _AC:_ a ticket records which tickets it is waiting on; relationships survive resyncs and are
  queryable by the dispatcher.
- **B3 — Dispatcher gate with PM-configurable behavior.**
  Before dispatching ticket A, check its blockers; if any is not terminal/done, do not dispatch.
  PM chooses, per project (and/or per ticket), between **hold** (wait for manual release) and
  **auto-resume** (dispatch automatically when all blockers complete).
  _AC:_ a ticket with unfinished blockers is never dispatched; when blockers complete, behavior
  follows the PM's hold/auto-resume setting; auto-resume needs no manual action; hold requires
  explicit release.

**Proposed data model:** `TicketDependency` (`ticket_id` ↔ `depends_on_ticket_id` + provider source);
per-project (or per-ticket) `dependency_block_behavior` = `hold | auto_resume` (column on
`Project`/`ProjectIntegration` + optional per-ticket override).

**Notes / decisions:**

- Dependency source of truth = ClickUp for now (future: Jira, Asana), each via its own provider mapping.
- Blocked behavior is PM-configurable (hold vs auto-resume), not hardcoded.
- Out of scope: cross-project dependencies (single-project graph first); cycle-resolution UX beyond
  detect-and-surface (a cycle should be detected and reported, not silently deadlocked).
