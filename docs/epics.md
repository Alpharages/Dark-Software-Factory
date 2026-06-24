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
| OHP-1 | OpenHarness Engine + BMAD/Lore Integration (single-tenant) | 1     | Proposed | OHP-0      |
| OHP-2 | Status-Driven Dispatcher + Loop + Approval Gate            | 2     | Proposed | OHP-1      |
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

## Epic OHP-1 — OpenHarness Engine + BMAD/Lore Integration (single-tenant)

**Goal:** Run the _real_ workflow (a BMAD skill), not a raw prompt, through OpenHarness on
one real ticket from your own ClickUp — and capture/stream the result into DSF.

**Depends on:** OHP-0. **Scope:** single-tenant (your ClickUp token), local MVP, no RabbitMQ
required yet.

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

## Epic OHP-2 — Status-Driven Dispatcher + Loop + Approval Gate

**Goal:** Automate the implement→review→QA loop you run manually today, driven entirely by
ClickUp status — with a human gate before merge.

**Depends on:** OHP-1.

### Stories

- **OHP-2.1 — Status→skill mapping/config.**
  Declarative map of which ClickUp status triggers which BMAD skill.
  _AC:_ config-driven; no hardcoded status names in logic.
- **OHP-2.2 — Dispatcher service.**
  React to ClickUp status changes (via existing multi-tenant webhooks) → spawn the matching
  skill run through the OHP-1 runner.
  _AC:_ a status change to the trigger status starts `clickup-dev-implement`; `in review`
  starts `clickup-code-review`; `ready for qa` starts `clickup-qa`.
- **OHP-2.3 — Loop handling.**
  `changes_requested`/`failed` → re-dispatch `clickup-dev-implement`; `approved` → QA;
  `passed` → done.
  _AC:_ a rejected review loops back to implement automatically; idempotent (no double-runs).
- **OHP-2.4 — Human review/approval gate.**
  No blind auto-merge — an explicit approval step before the PR merges. UI + backend.
  _AC:_ a run cannot merge without recorded approval; the gate is visible in the dashboard.
- **OHP-2.5 — Run guardrails.**
  Format only the agent's own files; wire any repo-mandated MCP tools (e.g. GitNexus);
  enforce `max-turns`/timeouts.
  _AC:_ a run never reformats unrelated files; mandated tools available or the run flags it.
- **OHP-2.6 — End-to-end loop validation.**
  One real ticket flows intake → implement → review → (loop) → QA → approved, hands-off
  except the gate.
  _AC:_ documented passing run with the full status trail in ClickUp.

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
