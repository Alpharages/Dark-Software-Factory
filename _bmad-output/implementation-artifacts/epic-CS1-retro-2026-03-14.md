# Epic CS1 Retrospective: Per-Project Workflow Configuration

**Date:** 2026-03-14
**Epic:** Epic CS1 (Per-Project Workflow Configuration)
**Status:** Completed
**Documentation Path:** `_bmad-output/implementation-artifacts/epic-CS1-retro-2026-03-14.md`

---

## 1. Executive Summary

Epic CS1 delivered the runtime workflow configuration layer — the elimination of all hardcoded ClickUp status maps and env-var status configuration, replaced by per-project `ai_trigger_status` stored in `ProjectIntegration`, live status discovery via `PMStatusService`, a live status picker UI for PMs, bot auto-assignment on execution start, and a development gate that filters all incoming tasks (webhook + polling) before they enter the dev queue. CS1-7 added as a CS0 retro discovery retired `ClickUpPollingOrchestrator` and removed `CLICKUP_API_KEY` as a required env var.

All 7 stories completed with 0 blockers. The planned CS1-1 → CS1-6 relay — intentionally stubbing `evaluateStatus()` to `isActionable: false` then restoring to `true` with the gate moved upstream — executed without unintended regressions. DSF now only processes tasks that reach the PM-configured trigger status; all other tasks are silently discarded.

---

## 2. Team Participants

- **Khakanali** (Project Lead)
- **Bob** (Scrum Master)
- **Alice** (Product Owner)
- **Charlie** (Senior Developer)
- **Dana** (QA Engineer)
- **Elena** (Junior Developer)

---

## 3. Epic Review

### 3.1 Delivery Metrics

| Metric                     | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Completed stories          | 7 / 7 (100%)                                                       |
| Story points (actual)      | 32 (CS1-1:3, CS1-2:8, CS1-3:3, CS1-4:5, CS1-5:5, CS1-6:5, CS1-7:3) |
| Blockers encountered       | 0                                                                  |
| Technical debt items (new) | 4                                                                  |
| Code review issues fixed   | ~30+ across all stories                                            |
| Production incidents       | 0                                                                  |

### 3.2 What Went Well (Successes & Strengths)

**The CS1-1 → CS1-6 planned relay worked perfectly:**
CS1-1 intentionally stubbed `StatusEvaluationService.evaluateStatus()` to `isActionable: false`, deliberately breaking all webhook-triggered AI processing as a safe baseline. CS1-6 then flipped it to `isActionable: true` and moved the gate upstream into `PmWebhookRouterService` and `PmPollingOrchestrator`. Every story in between ran on top of this planned regression without triggering unintended side effects. This is team design discipline executing correctly.

**Zero blockers across 7 stories:**
CS0's solid foundation — `ProjectIntegrationService`, `PMProviderFactory`, `ClickUpProvider`, the OAuth flow, polling, and webhooks — composed cleanly. CS1 built on it without friction. The architectural investment paid off immediately.

**`BotAssignmentService` design quality (CS1-5):**
Fire-and-forget, never rethrows, logs and Sentry-captures all errors, skips gracefully when no integration or bot_user_id exists. Clean single-responsibility service that does exactly what it claims. Set a good pattern for integration-adjacent services.

**Retiring `ClickUpPollingOrchestrator` (CS1-7):**
Two polling services running in parallel was the CS0 retro's biggest technical debt flag. CS1-7 eliminated it as a planned story — not an emergency fix. Only one polling path exists in the codebase now. The git commit `chore: remove ClickUpPollingOrchestrator and add StartupChecksService` is a clean architectural milestone.

**Code review continued to deliver real value:**
~30 issues caught across 7 stories. Highlights: CS1-3 caught `BadRequestException → NotFoundException` semantic error; CS1-4 caught 6 missing `StatusConfigSection` tests and the `react-hot-toast` mock gap; CS1-7 caught `OnModuleInit → OnApplicationBootstrap` — a non-trivial architectural correction on what looked like a simple cleanup story.

**Story File Lists consistently populated:**
Every story shipped with a complete File List in the Dev Agent Record. CS0's CS0-3 gap (empty Dev Agent Record, unclear what was implemented) did not recur. The File List improvement from the CS0 retro stuck.

### 3.3 Challenges & Growth Areas

**CS1-3 scope complexity:**
Circular dependency resolution between `ClickUpModule` ↔ `IntegrationsModule`, four new API endpoints (two in `ProjectController`, one in `IntegrationsController`, one existing modified), the consumer gate in `ClickUpTaskUpdateConsumer` with `forwardRef()` injection — all in one story. High cognitive load. The `forwardRef()` pattern is now a permanent maintenance cost on both modules.

**CS1-7 surprised with 12 code review findings:**
"Cleanup" stories don't get lighter review treatment — CS1-7's 12 issues (5H+4M+3L) prove the assumption that simple stories are low-risk is wrong. The `OnModuleInit → OnApplicationBootstrap` switch was a real architectural correction. The `Logger.prototype.warn` spy timing bug (spy must be set before module compile or the constructor call isn't captured) is the kind of subtle test issue that only surfaces under scrutiny.

**Completion Notes still inconsistent:**
4 of 7 stories shipped with empty Completion Notes (CS1-1, CS1-3, CS1-4, CS1-7). File Lists improved fully — but the narrative explaining decisions, deviations, and lessons is still not consistent. The CS0 retro established "story file completion is a done-criteria gate" — the gate is being applied to File Lists but not to Completion Notes.

**CS1-7 unchecked lint task:**
Task 8 in CS1-7 (`pnpm lint — pending (run manually)`) was left with an unchecked checkbox. Minor, but indicates done-criteria was declared before full verification. Needs immediate follow-up.

### 3.4 Key Insights

1. **Planned regressions are a valid design tool.** CS1-1's intentional stub of `evaluateStatus()` to `isActionable: false` was described and executed as planned. Zero incidents. This approach — break cleanly, fix cleanly — is preferable to trying to do the full swap in one story.

2. **"Simple" stories need the same review rigor as feature stories.** CS1-7 had more findings than CS1-1 (the actual complex cleanup). Review scope must not scale with perceived story size.

3. **Completion Notes vs. File Lists serve different purposes.** File Lists are a tracking artifact — they tell you what changed. Completion Notes are a handoff artifact — they tell you why decisions were made. Both matter. Currently only one is being consistently filled.

4. **The `forwardRef()` circular dep is a design debt.** CS1-3 introduced it as the pragmatic solution. It works. But every dev who touches `ClickUpModule` or `IntegrationsModule` now needs to understand why it exists. A comment is the minimum; a future refactor to eliminate the circularity is the right long-term path.

---

## 4. Previous Retrospective Follow-Through (Epic CS0)

| Action Item (CS0 Retro)                       | Status in CS1 | Evidence                                                                         |
| --------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| Read Dev Notes references before writing code | ✅ Applied    | No CS0-5/CS0-8 level pattern misses. Stories consistently read referenced files. |
| Story file completion as done-criteria gate   | ⚠️ Partial    | File Lists: 7/7 filled ✅. Completion Notes: 3/7 filled ✅, 4/7 empty ❌         |
| Deployment checklist in code review           | ✅ Applied    | CS1-7 review explicitly caught env var removal completeness (AC2 scope)          |
| Verify CS0-3 caller migrations                | ✅ Completed  | CS1-1 successfully removed all callers — prerequisite was verified               |
| Retire ClickUpPollingOrchestrator             | ✅ Done       | CS1-7 deleted both files + all module references                                 |
| Create CS1-7 story                            | ✅ Done       | Planned, drafted, and shipped                                                    |

**Continuity score:** 5/6 fully applied, 1 partial (Completion Notes). Strong continuity from CS0 commitments.

---

## 5. Next Epic Preview: CS2 — Intelligent Required Field Pre-Check & Auto-Fill

**4 planned stories:**

| Story | Title                    | Points | CS1 Dependency                              |
| ----- | ------------------------ | ------ | ------------------------------------------- |
| CS2-1 | Required Field Pre-Check | 5      | CS1-6 gate, CS1-3 trigger status            |
| CS2-2 | Factual Auto-Fill        | 5      | CS0-2 `IPMProvider.setFieldValue()`         |
| CS2-3 | AI-Inferred Field Fill   | 8      | Claude API pattern, CS1-5 execution context |
| CS2-4 | Verification Comment     | 2      | CS0-2 `IPMProvider.addComment()`            |

**All CS1 foundations confirmed solid** — gate is live, trigger status is configurable, bot assignment is running. CS2 builds directly on these.

**Critical gaps identified:**

1. `IPMProvider.getRequiredFields()` is defined in the interface (CS0-2) but has no real implementation in `ClickUpProvider`. CS2-1 cannot be verified without this.
2. `IPMProvider.setFieldValue()` is defined in the interface but has no real implementation. CS2-2 is blocked without this.
3. CS2-3 Claude API integration pattern — `ai-routing` module exists but CS2-3's use case (lightweight inference, not full execution) needs scoping before the story is drafted.

**Known limitation carried into CS2:** `webhooks.controller.ts` legacy endpoint bypasses the `ai_trigger_status` gate. Tasks entering through this path skip the trigger check. Low probability, known, documented.

---

## 6. Action Items & Commitments

### Process Improvements

**1. Completion Notes required before story moves to `done`**

- Owner: Bob (SM — enforce via story review checklist)
- Effective: CS2-1
- Success criteria: All CS2 stories have non-empty Completion Notes before sprint-status is updated to `done`

**2. "Cleanup" stories receive the same code review rigor as feature stories**

- Owner: Charlie (Senior Dev)
- Effective: CS2-1
- Success criteria: No cleanup story ships without a full code review pass

### Technical Debt

**3. `ClickUpService.statusNameToIdCache` — in-memory status cache**

- Owner: Charlie (Senior Dev)
- Priority: Low — does not block CS2
- Action: Include in a future `ClickUpService` retirement story (post-CS2/CS3)

**4. `webhooks.controller.ts` legacy endpoint — bypasses `ai_trigger_status` gate**

- Owner: Charlie (Senior Dev)
- Priority: Medium — schedule for CS3 or standalone story
- Action: Either gate the legacy endpoint or deprecate it; document in CS3 planning

**5. CS1-7 `pnpm lint` unchecked checkbox — verify immediately**

- Owner: Charlie (Senior Dev)
- Priority: **HIGH — resolve before CS2 begins**
- Action: Run `pnpm lint` on CS1-7 changeset; fix any issues

**6. `forwardRef()` circular dep (`ClickUpModule` ↔ `IntegrationsModule`) — document**

- Owner: Charlie (Senior Dev)
- Priority: Low
- Action: Add JSDoc to both module files explaining why `forwardRef()` is required; schedule future refactor

### CS2 Preparation Tasks

```
═══════════════════════════════════════════════════════════
🚀 EPIC CS2 PREPARATION TASKS:
═══════════════════════════════════════════════════════════
```

**Technical Setup (Must complete before CS2 stories drafted):**

[ ] Implement `ClickUpProvider.getRequiredFields(containerId)` — actual ClickUp API call for list required fields
Owner: Charlie (Senior Dev)
Must complete before: CS2-1 story creation

[ ] Implement `ClickUpProvider.setFieldValue(taskId, fieldId, value)` — actual ClickUp API call
Owner: Charlie (Senior Dev)
Must complete before: CS2-2 story creation

**Knowledge / Research:**

[ ] Scope CS2-3 Claude API integration pattern — is `ai-routing` module reusable for lightweight inference, or does CS2-3 need a dedicated path?
Owner: Charlie (Senior Dev) + Khakanali
Must complete before: CS2-3 story drafted

**Quality:**

[ ] Pre-flight test: verify `getRequiredFields()` returns actual ClickUp field data against a live connected integration
Owner: Dana (QA Engineer)
Must complete before: CS2-1 marked ready-for-dev

---

## 7. Critical Path

```
Before CS2 stories can be drafted:
  1. ClickUpProvider.getRequiredFields() implementation (Charlie) — HIGH
  2. ClickUpProvider.setFieldValue() implementation (Charlie) — HIGH
  3. CS1-7 pnpm lint verification (Charlie) — HIGH, immediate

Before CS2-3 story can be drafted:
  4. CS2-3 Claude API pattern scoping (Charlie + Khakanali) — MEDIUM

No plan changes required for CS2 based on CS1 learnings.
Epic CS2 definition is sound.
```

---

## 8. Readiness Assessment

| Area                       | Status                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| Story completion           | ✅ 7/7 done                                                             |
| Code review                | ✅ ~30+ issues resolved; CS1-7 lint pending                             |
| Core gate & trigger status | ✅ Live and operational                                                 |
| Deployment                 | ⚠️ Merged to main; production release pending                           |
| Stakeholder acceptance     | ⚠️ PM demo of live status picker + gate not yet done                    |
| Technical health           | ✅ Stable; 0 production incidents                                       |
| CS2 readiness              | ⚠️ Blocked on `getRequiredFields()` + `setFieldValue()` implementations |

---

## 9. Retrospective Closure

- **Epic CS1:** Per-Project Workflow Configuration — **REVIEWED & COMPLETE**
- **Commitments:** 2 process improvements, 4 technical debt items, 4 CS2 preparation tasks, 3 critical path items
- **No significant plan changes:** CS2 epic definition is sound — prerequisites above are implementation tasks, not replanning
- **Next steps:** CS1-7 lint → `ClickUpProvider` method implementations → CS2-3 pattern scoping → CS2 story creation

---

_Generated by BMAD retrospective workflow (epic-CS1) — 2026-03-14_
