# Epic CS5 Retrospective: Connected Apps — User-Level Provider Accounts & Import Onboarding

**Date:** 2026-03-17
**Epic:** Epic CS5 (Connected Apps — User-Level Provider Accounts & Import Onboarding)
**Status:** Completed
**Documentation Path:** `_bmad-output/implementation-artifacts/epic-CS5-retro-2026-03-17.md`

---

## Team Discussion

Bob (Scrum Master): "Welcome back, team. Epic CS5 is done — all 5 stories shipped today. This was the onboarding epic we've been waiting on since CS0. Let me pull up the data."

Alice (Product Owner): "Five stories in one day. That's not normal. What happened?"

Charlie (Senior Dev): "It's a combination of the pattern being extremely well-established from CS0–CS4, and the story specs being unusually precise. CS5-1 was the only technically complex one — CS5-3 through CS5-5 were largely pattern application."

Dana (QA Engineer): "I want to flag something before we celebrate — CS5-1 code review caught a parameter order inversion that was an auth bypass. That needs discussion."

Bob (Scrum Master): "It's on the agenda. Let's get the numbers up first."

---

## 1. Executive Summary

Epic CS5 delivered the complete self-serve onboarding layer for DSF: a generic `ConnectedApp` model, user-level ClickUp OAuth, a central Connected Apps settings page, account-first import modal, and automatic `ProjectIntegration` creation on import. All 5 stories shipped on 2026-03-17 with 25 story points.

The epic closes the chicken-and-egg gap introduced by CS0–CS4: PMs can now go from zero to a connected project entirely through the UI, without admin intervention and without pre-creating a project first.

Critical code review catch in CS5-1: `ConnectedAppService.getDecrypted(id, userId)` and `delete(id, userId)` had their parameter order reversed in the initial implementation. This would have allowed any authenticated user to fetch or delete any `ConnectedApp` record by ID — an ownership enforcement bypass. Caught and fixed before any story reached `done`.

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

| Metric                     | Value                                                  |
| -------------------------- | ------------------------------------------------------ |
| Completed stories          | 5 / 5 (100%)                                           |
| Story points (actual)      | 25 (CS5-1:5, CS5-2:5, CS5-3:5, CS5-4:5, CS5-5:5)       |
| Blockers encountered       | 0                                                      |
| Technical debt items (new) | 1 (localStorage key format inconsistency — see 3.3)    |
| Code review issues fixed   | ~25+ across all stories                                |
| Unit tests added           | ~54+ (CS5-1:12, CS5-2:8, CS5-3:14, CS5-4:10, CS5-5:20) |
| Production incidents       | 0                                                      |
| Critical security fix      | 1 (CS5-1 ownership bypass — caught in code review)     |

### 3.2 What Went Well

**The generic `ConnectedApp` model is architecturally sound:**
The decision to use `AppProvider` (broader: CLICKUP, JIRA, GITHUB, GMAIL, SLACK, etc.) separate from `PMProvider` (narrow: CLICKUP, JIRA, ASANA only) was the right call. `ProjectIntegration` will never hold a `GMAIL` or `BITBUCKET` — the separation enforces semantic correctness at the schema level. Future integrations (GitHub, Jira, Asana) plug in with zero schema changes.

Bob (Scrum Master): "CS5-1's enum consolidation — renaming `IntegrationProvider` → `PMProvider`, removing `ProjectProvider`, adding `AppProvider` — touched 17+ files. All clean. Zero regressions."

Charlie (Senior Dev): "The migration warning was well-documented. Prisma's drop/recreate pattern for enum renames would have destroyed data. The manual SQL edit was flagged in the story spec before anyone ran a migration."

**Complete onboarding flow delivered end-to-end:**
A PM can now: (1) open the Connected Apps settings page, (2) click "Connect ClickUp Account", (3) complete OAuth, (4) land back at settings or directly at the import modal, (5) select their workspace, (6) import a project, and (7) have `ProjectIntegration` auto-created — all without touching project settings manually. This is the full self-serve path.

Alice (Product Owner): "The `returnTo` routing through the OAuth callback is the piece that makes the flow seamless. The callback knows whether to send the user back to settings or straight to the import modal. That UX detail matters."

**CS5-4 code review caught 10+ issues before they shipped:**
The import modal rewrite was complex — new step type, account auto-selection, localStorage flag, URL param handling, hierarchy hook swap, callback routing. The code review caught: `ProjectsSyncPage ?openImport=true` handler missing, `PmIntegrationCallback returnTo=import` flow missing, missing loading/error states on step 0, single-account "confirmed" state not implemented, footer Back hidden on step 0, Next button gating, localStorage JSON format inconsistency, `HierarchyResponse` type alignment, `enabled` param on `useAppHierarchy`. That's 10 correctness issues on a single story — all caught before `done`.

Dana (QA Engineer): "The `enabled` param on `useAppHierarchy` is the one I was most worried about. Without it, the hook fires on every render regardless of whether an account is selected — unnecessary API calls on modal open."

**Atomicity in CS5-5 is correctly designed:**
Project creation and `ProjectIntegration` creation run inside `PrismaService.$transaction()`. If the integration insert fails, the project is rolled back. If `accountId` is omitted (backwards compatibility), the transaction is skipped entirely — no unnecessary overhead for the default path.

Elena (Junior Dev): "The backwards compatibility is important. Existing importers don't break — they just don't get the auto-integration."

**Code review process continues to operate well:**
Every story went through code review. CS5-1 had the highest review density — 10+ issues including the critical security find. CS5-2 and CS5-3 were lighter. CS5-4 and CS5-5 had moderate density. The pattern is consistent: critical/high issues get fixed before `done`, medium/low issues fixed in the same commit.

### 3.3 Challenges & Growth Areas

**CS5-1: Critical auth bypass — parameter order inversion:**
`ConnectedAppService.getDecrypted(id, userId)` and `delete(id, userId)` had their parameters reversed in the initial implementation. The enforcement logic checked `record.user_id !== userId` where `userId` was actually the `id` string being passed as first arg. Any authenticated user could call `DELETE /api/v1/apps/:id` with any ID and the ownership check would pass. This is a HIGH severity security issue — not a correctness nitpick.

Charlie (Senior Dev): "The fix is simple — swap the parameters — but the root cause is that the method signature matches the epic spec exactly (`getDecrypted(id: string, userId: string)`) while the service code was written with them transposed. The spec and the tests were consistent with each other and both wrong."

Bob (Scrum Master): "Which means the tests were testing the wrong behavior and still passing. The code review caught it because the reviewer looked at the ownership check logic directly, not just at test pass/fail."

Dana (QA Engineer): "This is the value of code review over test coverage. Tests verified internal consistency. Code review verified correctness against spec intent."

**CS5-1: `ConnectedAppResponseDto` field mapping — DTO/spec drift:**
Initial implementation used snake_case field names (`workspace_id`, `workspace_name`, `updated_at`) in the DTO instead of the camelCase spec (`workspaceId`, `workspaceName`, `connectedAt`). Also included `user_id`, `updated_at`, and `token_expiry` which are explicitly excluded from the spec. This is a frontend contract breakage — the frontend would have received wrong field names and extra sensitive metadata fields.

Elena (Junior Dev): "CS5-3 was written expecting `workspaceId` and `workspaceName`. If CS5-1 shipped with `workspace_id`, CS5-3 would have had runtime failures that looked like backend bugs."

**CS5-3 story file shows `Status: ready-for-dev` — not `done`:**
The story file for CS5-3 (`CS5-3-connected-apps-settings-page.md`) still shows `Status: ready-for-dev` in its header despite the sprint-status.yaml showing it as `done` with a completion date. The Dev Agent likely updated the sprint-status but not the story file header. Minor bookkeeping issue.

Bob (Scrum Master): "Same situation for CS5-5 — story file says `ready-for-dev`, sprint-status says `done`. The authoritative source is sprint-status.yaml, but having divergent status between files is confusing."

**CS5-3 hook location deviation:**
The epic spec and story spec describe the hook as `src/hooks/useConnectedApps.ts`. The story completion notes reference `src/hooks/queries/useConnectedApps.ts` (with a `queries/` subfolder). This is a minor structural deviation — the queries subfolder may reflect a frontend convention — but it means CS5-4's `import { connectedAppsKeys } from '@/hooks/queries/useConnectedApps'` would fail if it assumed the root path.

**CS3/CS4 retrospectives were skipped:**
Two epics between CS2 and CS5 (CS3 and CS4) were completed with retros marked "optional" but not executed. CS2's action items are therefore 2+ epics old with unknown follow-through status. We cannot confirm whether the CS2 action items (CS1-7 lint checkbox, class naming convention, scope bleed flagging, forwardRef JSDoc) were addressed.

Alice (Product Owner): "That's a real gap. CS3 and CS4 had their own lessons — sync failure handling, webhook routing cleanup. Those lessons weren't captured."

Bob (Scrum Master): "The pattern: optional retros get skipped. For CS5 and forward, let's not mark any retro as optional unless we consciously decide it's a trivial story."

### 3.4 Key Insights

1. **Parameter order in ownership guards must be verified in code review, not just tested.** Tests can be internally consistent but wrong. Direct inspection of the ownership check condition is necessary when implementing guarded resource access methods.

2. **DTO field names are a frontend contract.** A snake_case/camelCase mismatch in a response DTO is a silent runtime breakage that won't appear in backend tests. Code review must compare DTO field names to the spec explicitly.

3. **Story file `Status:` headers should be updated when moving to `done`.** sprint-status.yaml is authoritative but story file headers create confusion when divergent. The dev agent should update both.

4. **Optional retros don't get done.** CS3 and CS4 retros were marked optional and skipped entirely. Action items from CS2 have unknown follow-through. Retros should be treated as mandatory after any epic that delivers real functionality.

5. **The CS0–CS5 architecture is complete and extensible.** The full ClickUp integration stack — project-level OAuth (CS0), status discovery (CS1), field auto-fill (CS2), sync failure handling (CS3), cleanup (CS4), user-level OAuth + onboarding (CS5) — is live. Adding Jira or Asana requires implementing `IJiraProvider` and `IAsanaProvider` — no schema changes, no new endpoints.

---

## 4. Previous Retrospective Follow-Through

The most recent completed retrospective is CS2 (2026-03-15). CS3 and CS4 retrospectives were marked optional and not executed. Follow-through from CS2 is assessed here; CS3 and CS4 lessons are not captured (gap acknowledged).

| Action Item (CS2 Retro)                                         | Status in CS5 | Evidence                                                                               |
| --------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| Add "class name matches NestJS convention" to code review check | ⚠️ Unknown    | No explicit evidence in CS5 story records; no class naming issues found in CS5 either  |
| Cross-story scope bleed flagged in story header                 | ⚠️ Unknown    | CS3/CS4 retros skipped — not tracked; CS5 stories don't show cross-story scope notes   |
| CS1-7 pnpm lint unchecked checkbox verify                       | ⚠️ Unknown    | No evidence in CS3, CS4, or CS5 completion notes                                       |
| `forwardRef()` JSDoc documentation                              | ⚠️ Unknown    | No mention in any story since CS2                                                      |
| Pre-flight test `getRequiredFields()` against live integration  | ⚠️ Unknown    | Not mentioned in CS3/CS4 (skipped) or CS5 completion notes                             |
| `webhooks.controller.ts` legacy gate bypass — document in CS3-3 | ✅ Addressed  | CS3 is `done` — CS3-3 story completed; legacy webhook endpoint was part of CS4 cleanup |

**Continuity score: 1/6 confirmed, 5 unknown.** The 2-epic retro gap has broken the action item accountability chain.

Bob (Scrum Master): "Three epics later and we don't know if CS2's HIGH priority action items were addressed. That's the cost of skipping retros."

Charlie (Senior Dev): "We should treat the five 'unknown' items from CS2 as still-open until proven otherwise."

---

## 5. Next Epic Preview

No CS6 epic is currently defined in the planning artifacts. The Connected Apps architecture (CS0–CS5) is complete for ClickUp. The planned next integrations (Jira, Asana, GitHub at user level) would follow the same ConnectedApp pattern.

Bob (Scrum Master): "We're at an interesting inflection point. The full integration stack is done. Next work is either: (1) Jira/Asana/GitHub expansion, (2) the Production Rollout epic (Epic 15), or (3) backlog cleanup."

Alice (Product Owner): "Epic 15 has been waiting since before the CS epics started. It's the staging deploy and E2E validation sprint. That's the most important thing now."

Charlie (Senior Dev): "Epic 15 depends on the integration stack being complete. CS5 closing that dependency chain makes Epic 15 unblocked."

Bob (Scrum Master): "Epic 15 has two stories: 15-4 (Production Rollout Plan) and 15-5 (E2E Testing & Validation). 15-5 is already `in-progress`. That's the path forward."

---

## 6. Action Items & Commitments

### Process Improvements

**1. Retros are not optional after functional epics**

- Owner: Bob (SM — update sprint planning template)
- Effective: immediately
- Success criteria: No future epic with functional stories gets `optional` retrospective status. Retrospectives are scheduled as part of epic closure.

**2. Story file `Status:` header must be updated to `done` when sprint-status.yaml is updated**

- Owner: Dev agent pattern (Bob — add to dev agent story completion checklist)
- Effective: next story
- Success criteria: Story file header `Status:` matches sprint-status.yaml on all stories going forward

**3. Code review must explicitly verify DTO field names against spec for any new response DTO**

- Owner: Bob (SM — add to code review checklist)
- Effective: CS3-1 equivalent in next epics
- Success criteria: Code review checklist includes "DTO field names match spec camelCase contract" item

### Technical Debt

**4. Verify CS2 action items — HIGH priority items still unconfirmed**

- Owner: Charlie (Senior Dev)
- Priority: HIGH — before starting Epic 15
- Action: Confirm status of: (a) CS1-7 pnpm lint checkbox, (b) class naming convention in code review template, (c) forwardRef() JSDoc on `ClickUpModule`/`IntegrationsModule`
- Success criteria: Each item either confirmed done (with evidence) or a new fix committed

**5. Pre-flight test `getRequiredFields()` and `setFieldValue()` against live ClickUp integration**

- Owner: Dana (QA Engineer)
- Priority: HIGH — CS2 action item still unresolved
- Action: Test `PMFieldPreCheckService.checkRequiredFields()` against a live ClickUp-connected project. Document results.
- Success criteria: Test executed and results documented in a QA note

### Epic 15 Preparation

**6. Context step for Epic 15 — verify dependencies are complete**

- Owner: Bob (SM)
- Priority: HIGH — Epic 15 is next
- Action: Verify Epic 15 dependencies (Epic 11, 12, 13, 14 referenced in sprint-status) are complete or acceptable. Check 15-5 `in-progress` status — confirm implementation is still valid after CS5 changes.
- Success criteria: Epic 15 stories 15-4 and 15-5 are either `ready-for-dev` or refreshed

---

## 7. Action Plan Summary

```
═══════════════════════════════════════════════════════════
📝 EPIC CS5 ACTION ITEMS:
═══════════════════════════════════════════════════════════

Process Improvements:
1. Retros are mandatory after functional epics
   Owner: Bob (SM)
   Effective: immediately

2. Story Status: header must sync with sprint-status.yaml
   Owner: Dev agent pattern (Bob — checklist)
   Effective: next story

3. DTO field names explicitly verified in code review
   Owner: Bob (SM — checklist update)
   Effective: next story

Technical Debt:
4. Verify CS2 action items — HIGH (lint, convention, forwardRef)
   Owner: Charlie (Senior Dev)
   Priority: HIGH — before Epic 15

5. Pre-flight live integration test for CS2 services
   Owner: Dana (QA Engineer)
   Priority: HIGH

═══════════════════════════════════════════════════════════
🚀 EPIC 15 PREPARATION TASKS:
═══════════════════════════════════════════════════════════

[ ] Verify Epic 15 dependencies are complete
    Owner: Bob (SM)
    Priority: HIGH

[ ] Confirm 15-5 implementation still current after CS5 changes
    Owner: Charlie (Senior Dev)
    Priority: HIGH

[ ] Resolve CS2 HIGH action items before deploying to production
    Owner: Charlie + Dana
    Priority: HIGH
```

---

## 8. Readiness Assessment

**Epic CS5:**

Testing & Quality: ✅ 54+ unit tests added across all 5 stories. Critical auth bypass found and fixed. DTO contract verified.

Deployment: ⚠️ Requires `pnpm db:migrate` in production to apply the `connected_apps_enum_consolidation` migration. Migration contains manual SQL edits (ALTER TYPE rename) — must not be auto-generated.

Stakeholder Acceptance: ⚠️ Full E2E flow not yet production-tested. Epic 15 (E2E validation sprint) covers this.

Technical Health: ✅ Architecture is clean. ConnectedApp model is provider-agnostic. AppProvider/PMProvider separation enforced at schema level. Backwards compatibility maintained.

Unresolved Items: ⚠️ CS2 HIGH action items unconfirmed. Story file status headers diverged for CS5-3 and CS5-5.

Bob (Scrum Master): "CS5 is functionally complete. The deployment migration needs careful handling — that manual SQL edit is the one thing that can go wrong if automation bypasses the manual review step."

---

## 9. Retrospective Closure

```
═══════════════════════════════════════════════════════════
✅ RETROSPECTIVE COMPLETE
═══════════════════════════════════════════════════════════
```

Bob (Scrum Master): "Epic CS5: Connected Apps — done. 5 stories, 25 story points, 54+ tests, zero production incidents."

**Key Takeaways:**

1. **Code review caught a critical auth bypass** — parameter order in ownership guards must be reviewed directly, not just tested. Internal test consistency ≠ correct behavior.
2. **DTO field names are a frontend contract** — snake_case/camelCase drift breaks the frontend silently; must be verified in review.
3. **Optional retros don't get done** — CS3 and CS4 lessons are lost. Retros must be treated as mandatory after functional epics.
4. **The ConnectedApp architecture is extensible** — Jira, Asana, GitHub can add user-level OAuth with zero schema changes.
5. **Epic 15 is the clear next priority** — all CS dependencies are now complete.

Alice (Product Owner): "The onboarding gap is finally closed. PMs can get themselves set up without admin help. That was the whole point."

Charlie (Senior Dev): "And the architecture handles it cleanly — the same `ConnectedApp` model works for every future OAuth provider."

Dana (QA Engineer): "I want those CS2 action items confirmed before we put anything in production. The pre-flight test matters."

Bob (Scrum Master): "Agreed. Charlie, Dana — those two items before Epic 15 starts. Khakanali, great work this sprint. The CS epics are a genuinely complete integration layer."

```
═══════════════════════════════════════════════════════════
🎯 NEXT STEPS:
═══════════════════════════════════════════════════════════
```

1. Resolve CS2 HIGH action items (Charlie + Dana)
2. Verify Epic 15 readiness — context step (Bob)
3. Execute production migration with manual SQL review (Charlie)
4. Begin Epic 15 — Production Rollout Plan + E2E Validation

---

## 10. Commitments Made

- Action Items: 5
- Preparation Tasks: 3
- Critical Path Items: 2 (CS2 action item resolution, Epic 15 readiness verification)

**Next Epic:** Epic 15 — v3 Configuration & Production Rollout

Bob (Scrum Master): "Meeting adjourned. See you at Epic 15."
