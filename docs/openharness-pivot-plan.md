# DSF Engineering Pivot — Delegate the Agent Runtime to OpenHarness

**Status:** Proposed (validated by spike) · **Date:** 2026-06-18 · **Owner:** Khakan
**TL;DR:** Stop hand-building DSF's AI execution runtime. You already own the workflow
brain (**BMAD skills**) and the memory (**Lore**); run them on an existing agent harness
(**OpenHarness**), and make DSF the thin, multi-tenant _control shell_ that automates and
supervises the loop. Proven end-to-end by a two-stage spike on the SmartPocket repo.

---

## 1. What We Are Doing — a four-layer architecture

The realization: DSF's `execution/` + `ai-routing/` + `qa-automation/` stack was
re-implementing orchestration logic **you already have** as MCP tools. Split
responsibilities to the layer that already owns each one:

| Layer              | Owner                        | Role                                                                                                                                                                     | Status        |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| **Workflow brain** | **bmad-mcp-server** (skills) | The implement→review→QA logic + ClickUp state machine                                                                                                                    | Already built |
| **Memory**         | **Lore**                     | Lessons, patterns, sessions, cross-project propagation                                                                                                                   | Already built |
| **Engine**         | **OpenHarness**              | Runs a BMAD skill headlessly, `bmad`+`lore` wired in as MCP servers, on a subscription                                                                                   | Adopt         |
| **Control shell**  | **DSF**                      | Watch ClickUp status → dispatch the right skill to OpenHarness → stream live activity → store execution/cost/audit → human approval gate + multi-tenant credential vault | Build (thin)  |

> **DSF = the factory control room. BMAD = the brain. Lore = the memory. OpenHarness = the engine room.**

### Your current workflow already IS the factory (you're just the clock)

The BMAD skills encode a **status-driven state machine** — each skill does work and moves
the ClickUp status, which dictates the next skill:

```
[trigger status]
   └▶ clickup-dev-implement   ─sets─▶ "in review"      (TDD, commits, M1/M2 comments, →Lore)
"in review"
   └▶ clickup-code-review     ─┬ approved ──────────▶ "ready for qa"
                               └ changes_requested ─▶ "in progress" ─▶ back to dev-implement
"ready for qa"
   └▶ clickup-qa              ─┬ passed ▶ "done"
                               └ failed ▶ "in progress" ─▶ back to dev-implement
```

So **DSF needs no state machine of its own** — the state machine _is_ the ClickUp statuses
the skills already set. DSF becomes a **status → skill dispatcher**: "ticket is now
`in review` → run `clickup-code-review` via OpenHarness."

### Keep / Delete map

| DSF area                                                                           | Decision                      | Why                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `ticket-intake/`, `clickup/`, `webhooks/` (OAuth, per-workspace webhooks, CS0–CS5) | **Keep**                      | The multi-tenant trigger + credential vault — the one thing BMAD/Lore/OpenHarness _can't_ do |
| `dashboards/`, `realtime/` (Socket.IO)                                             | **Keep**                      | Oversight layer; OpenHarness stream events feed it ~1:1                                      |
| `auth/`, `audit/`, `cost-tracking/`, `projects/`                                   | **Keep**                      | Governance/business layer + the human approval gate                                          |
| `ai-routing/`, `execution/` state machine, prompt-gen                              | **Delete**                    | Redundant — BMAD skills + ClickUp statuses already are this                                  |
| `qa-automation/` bespoke pipeline                                                  | **Delete / reduce to policy** | `clickup-qa` does the QA; DSF keeps gates, not plumbing                                      |
| `sandbox/`, `docker/` bespoke execution                                            | **Replace**                   | Wrap each `oh` run in a container; delete custom exec plumbing                               |

**New glue to build:** the per-ticket **runner** (spawn `oh` with `bmad`+`lore` MCP) + a
~50-line **adapter** mapping OpenHarness stream events → DSF `RealtimeGateway` events.

---

## 2. Why We Are Doing It

1. **The hard 80% is already solved** — and partly by _you_. The agent loop is OpenHarness;
   the workflow logic is the BMAD skills; the memory is Lore. DSF was rebuilding all three.
2. **We were stuck because it was breadth-first.** 25+ "done" epics, 50+ models, ~10 queues,
   never run end-to-end. Over-architected for its stage; impossible to launch/debug.
3. **Three independent analyses converged** on the engine split (this assistant, Codex, and
   the OpenHarness/OpenClaw research).
4. **Subscription economics.** OpenHarness bridges to an existing Codex/Claude subscription
   (flat rate) — zero marginal API spend for internal/single-tenant use.
5. **The review gate is the actual product.** The spike found a real bug the agent's own
   green tests missed — DSF's _supervision_ layer, not its execution engine, is the moat.

---

## 3. The Experiment (What We Ran, What We Learned)

**Engine:** OpenHarness `0.1.9` (`pipx install openharness-ai`), auth bridged to a local
**Codex subscription** (`~/.codex/auth.json`), model `gpt-5.4`. No API key, no per-token cost.

- **Stage A — plumbing (toy repo, ~19s):** drove `oh` headlessly to fix a seeded bug — read
  repo, edited file, **ran the test itself**, minimal diff. Parsed `stream-json` into a
  `DSF.Execution` record in ~25 lines. ✅ headless drive + structured output confirmed.
- **Stage B — real story (SmartPocket Story 7.1, ~15 min, branch `spike/story-7.1-openharness`):**
  schema + migration, 7 data-access fns, tRPC router + Zod, idempotent generator, scheduled
  endpoint, 3 test files. Independently verified: ✅ **26/26 new tests pass**; ✅ **build not
  broken** (other failures provably pre-existing via stash test); ✅ mirrored existing
  conventions; ✅ honest about what it couldn't do (no DB / GitNexus).

**Lessons:**

1. **Green tests ≠ correct.** Month-end drift in the generator (Jan31→Feb28→**Mar28**; AC7
   wants Mar31), and the agent's own test named `"…without drift"` passed anyway. →
   **A review/approval gate before merge is mandatory. No blind auto-merge.**
2. **Scope tool side-effects.** `pnpm format` reformatted 8 unrelated files — instruct the
   agent to format only its own files.
3. **Dashboard mapping is real.** `stream-json` events map ~1:1 onto DSF's existing
   `execution.activity/log/completed` Socket.IO events.
4. **Cost/usage not in CLI output** — fine on flat-rate subscription; for reporting, use the
   SDK/transcript (deferred).
5. **Mergeability ≈ 90%** — a reviewer ships it in ~15 min vs ~half a day.

**Verdict:** pivot validated. Engine produces near-mergeable full-stack work, headless, on a
subscription, streaming to the dashboard — _with_ a review gate.

---

## 4. Multi-Tenant ClickUp — control plane vs data plane (DEFERRED)

bmad-mcp-server is **single-tenant** today (one `CLICKUP_API_KEY`, `pk_`-validated, one
`CLICKUP_TEAM_ID`). DSF is **multi-tenant** (ClickUp OAuth; per-customer tokens encrypted in
`ProjectIntegration`/`ConnectedApp`; per-workspace webhooks — the CS0–CS5 work). Reconcile by
making DSF the control plane that feeds **single-tenant runs**:

```
DSF control plane (multi-tenant, KEEP)            Per-ticket run (single-tenant, isolated)
• OAuth vault: each tenant's ClickUp token   ─▶ decrypt tenant creds at dispatch
• per-workspace webhooks detect status change   spawn OpenHarness run with:
• Lore slug + key per tenant                       • bmad-mcp-server (env: THIS tenant's token + team)
                                                   • lore-mcp (THIS tenant's slug/key)
                                                   container-isolated; token lives only here
```

**One run = one tenant, by construction.** Multi-tenancy = DSF orchestrating many isolated
single-tenant runs; bmad itself never becomes multi-tenant.

**Deferred work (agreed — do later, after the loop is proven single-tenant):**

- Update `bmad-mcp-server` `clickup-env.ts` to accept **OAuth tokens** (not just `pk_`) and
  per-run `CLICKUP_TEAM_ID` injection.
- OAuth token refresh injected per spawn (DSF already has refresh handling).
- Per-tenant Lore slug/key injection.

---

## 5. Risks & Open Decisions

- **Skill-following fidelity across models.** Skills are likely run today in Claude Code
  (Claude); OpenHarness on Codex runs `gpt-5.4`. Validate the long BMAD prompts are followed
  faithfully — or point OpenHarness at a Claude-subscription profile.
- **Can OpenHarness drive `bmad({operation:"execute", workflow:…})`** through its full
  multi-step workflow as an MCP client. Validate in the Phase-1 spike.
- **Commercial ToS / cost model.** Subscription auth is individual-use + rate-capped. Internal:
  fine. Multi-tenant SaaS: needs API billing or enterprise deal. Decision needed before GA.
- **Dependency maturity** (OpenHarness, young HKUDS/MIT project) — vendor/pin to mitigate.
- **Cost/usage reporting gap** (Learning #4).

---

## 6. The Next Plan (phased — keep it runnable at every step)

**Phase 0 — Pivot spike** ✅ _Done._ Engine + headless drive + mergeable output validated.

**Phase 1 — BMAD-skill-in-OpenHarness spike (single-tenant).** _Goal: run the real workflow,
not a raw prompt._

- Wire `bmad-mcp-server` + `lore` into OpenHarness as MCP servers (`oh mcp` / `--mcp-config`).
- Run `clickup-dev-implement` against a real ticket in **your own** ClickUp, headless, on the
  Codex subscription. Confirm skill fidelity + that it drives the `bmad` execute tool.
- Build the **runner** + the stream→`RealtimeGateway` **adapter**; stream live to a DSF
  dashboard; persist the execution record. Add `POST /api/v1/executions/test`.
- **Exit:** a real ticket runs `clickup-dev-implement` via OpenHarness, streaming live to DSF,
  status moved to `in review`, lessons saved to Lore.

**Phase 2 — Close the status-driven loop + review gate.** _Goal: the full implement→review→QA
loop, automated._

- DSF dispatcher reacts to ClickUp status → runs the matching skill (implement/review/qa),
  including the loop-back on `changes_requested`/`failed`.
- Insert the **human review/approval gate** before merge (the Stage-B drift bug is why).
- **Exit:** a real ticket flows intake → implement → review → (loop or) QA → approved, hands-off
  except the gate.

**Phase 3 — Decommission bespoke runtime.** _Goal: delete the painful 80%._

- Retire `ai-routing/`, `execution/` state machine, custom `sandbox/` exec, bespoke
  `qa-automation/` pipeline. Reduce QA to policy gates.
- **Exit:** OpenHarness+BMAD is the sole execution path; dead modules removed; tests green.

**Phase 4 — Multi-tenant + productionize.** _Goal: safe for real/multi-customer use._

- Layer DSF's OAuth vault back in as the control plane (per-run credential injection, §4);
  **update bmad-mcp-server for OAuth** (the deferred change); container-per-run isolation;
  cost/usage capture; ToS/licensing + billing decision.
- **Exit:** multiple customer ClickUp accounts run isolated, with cost reporting + a clear
  licensing model.

---

## Appendix — Reproduce the spike

```bash
pipx install openharness-ai
oh auth codex-login          # bridges ~/.codex/auth.json (subscription, no API key)
oh provider use codex
oh -p "<task or path to story.md>" --output-format stream-json \
   --permission-mode full_auto --max-turns 200 > run.stream.json
```

Artifacts: branch `spike/story-7.1-openharness` (SmartPocket); `/tmp/oh-spike/` (stream logs,
`watch.py` live viewer, parser).
