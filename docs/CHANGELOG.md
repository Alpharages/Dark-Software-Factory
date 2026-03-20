# CHANGELOG — Dark Software Factory

Chronological log of all major product decisions, completed work, and architectural changes.
Used by AI to understand "what was done and why" before making any modifications.

---

## 2026-03-17 — Epic CS5: Connected Apps Complete

**What:** Delivered complete self-serve onboarding layer for DSF.

**Delivered:**

- `ConnectedApp` Prisma model (user-level, vs `ProjectIntegration` which is project-level)
- `AppProvider` enum (separate from `PMProvider` — covers all integration types)
- User-level ClickUp OAuth flow (CS5-2)
- Connected Apps settings page in frontend (CS5-3)
- Redesigned import modal with account-first selection + inline OAuth (CS5-4)
- Auto-create `ProjectIntegration` when project is imported (CS5-5)

**Why:** CS0–CS4 created a chicken-and-egg problem — PM tool integration was per-project only, but new PMs had no project yet. CS5 solves this so PMs can self-serve from zero.

**Security fix caught in code review:** `ConnectedAppService.getDecrypted(id, userId)` and `delete(id, userId)` had parameter order reversed in initial implementation — would have allowed any user to access any ConnectedApp. Fixed before story reached `done`.

**Retro:** `_bmad-output/implementation-artifacts/epic-CS5-retro-2026-03-17.md`

---

## 2026-03-16 — Epic CS4: Legacy ClickUp Cleanup Complete

**What:** Removed all LEGACY/DEPRECATED env vars and dead code from ClickUp era.

**Removed:**

- `CLICKUP_USE_WEBHOOKS`, `CLICKUP_WEBHOOK_SECRET` (global), `ACTIONABLE_STATUSES`, `NON_ACTIONABLE_STATUSES`, `CLICKUP_STATUS_*`
- `WebhookSignatureGuard` global-secret pattern → replaced by per-workspace DB lookup
- Dead `commentOnClickUpTask()` method from ticket-intake.service.ts
- Empty `WebhooksController`
- Orphaned e2e specs

---

## 2026-03-14 to 2026-03-15 — Epics CS1 + CS2 Complete

**Epic CS1 — Per-Project Workflow Configuration:**

- Removed all hardcoded ClickUp status maps
- `PMStatusService` with 5-min TTL cache + stale fallback to Sentry
- `ai_trigger_status` field on `ProjectIntegration`
- Live status picker UI in PM integration panel
- `DevelopmentGateService` — only tasks at trigger status enter dev queue
- `ClickUp` credential transition — `CLICKUP_API_KEY` deprecated, OAuth-only path now clean

**Epic CS2 — Intelligent Field Pre-Check:**

- `RequiredFieldPreCheckService` — calls `IPMProvider.getRequiredFields()` before every status push
- `FactualAutoFillService` — fills execution duration, PR link, dates, commit count
- `AIInferredFillService` — Claude fills story points, priority, tags (skips if low confidence)
- `PMVerificationCommentService` — posts summary comment listing what was auto-filled vs needs manual review

---

## 2026-03-13 — Epic CS0 Complete

**What:** Provider-agnostic PM integration layer.

**Delivered:** `IPMProvider` interface, `ClickUpProvider`, `PMProviderFactory`, per-project OAuth, polling orchestrator, multi-tenant webhook routing.

**Architectural decision:** `PMProviderFactory` resolves provider from `ProjectIntegration.provider` enum. Token refresh happens transparently (5-min window). All PM operations go through the interface — never call ClickUp API directly.

**Retro:** `_bmad-output/implementation-artifacts/epic-CS0-retro-2026-03-13.md`

---

## 2026-03-10 — Sprint Planning: ClickUp Smart Sync Epics Added

CS0, CS1, CS2, CS3 added to sprint plan. Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md`

---

## 2026-03-03 — Epic 27 Complete: Platform Polish & Mobile Nav

Mobile/tablet navigation, proper 404 page, per-page document titles, notification bell badge, integration health panel in Settings (Docker/SendGrid/OpenAI/Slack status).

**Retro:** `_bmad-output/implementation-artifacts/epic-27-retro-2026-03-03.md`

---

## 2026-03-02 — Epic 26 Complete: PM Dashboard Feature Completion

New project creation dialog, filter panel, sort + view mode toggle, role guards, observability error states, AI execution KPI widgets (STAT-1/2/7), financial KPI widgets (STAT-3/4), quality + provider KPI widgets (STAT-5/6/8).

**Key fix:** Budget ceiling moved to `SystemConfig` (not hardcoded). All 79 tests green.

**Retro:** `_bmad-output/implementation-artifacts/epic-26-retro-2026-03-02.md`

---

## 2026-03-01 — Epic 25 Complete: QA Stabilization

Fixed all 3 Critical + 14 High bugs from QA-REPORT-2026-02-27.

**Critical fixes:**

- `GITHUB_WEBHOOK_SECRET` HMAC enforcement (was completely bypassed — security)
- Wildcard route fix (NestJS startup errors)
- 3 broken frontend routes: `/cost`, `/admin/users`, `/admin/invitations`

**Key pattern changes:**

- Replaced `localStorage` auth with `useAuth()` hook everywhere
- Centralized `SocketProvider` (was re-created per component)
- Global `staleTime: 300_000` in React Query `QueryClient`

**Retro:** `_bmad-output/implementation-artifacts/epic-25-retro-2026-03-01.md`

---

## 2026-02-27 — QA Report Generated

Full QA audit of the platform. Source for Epics 25, 26, 27.
**Report:** `docs/QA-REPORT-2026-02-27.md`

---

## 2026-02-20 — Sprint Status File Created

`_bmad-output/implementation-artifacts/sprint-status.yaml` created as source of truth for all epic/story status tracking.

---

## 2026-02-02 — Implementation Readiness Report v2

Second readiness assessment. Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-02-02.md`

---

## 2026-01-31 — Architecture v2 Finalized

`architecture.md` (126K) — comprehensive system architecture covering all components.

---

## 2025-11-27 — UX Design Specification Created

`ux-design-specification.md` — core UX patterns for all dashboard views.

---

## 2025-11-27 — Implementation Readiness Report v1

First readiness assessment. Source: `docs/implementation-readiness-report-2025-11-27.md`

---

## 2025-11-21 — Epic Breakdown v1 Created

`docs/epics.md` — first epic breakdown (136 FRs across 9 capability areas, 10 Phase 1 MVP epics).

---

## 2025-11-20 — PRD v1.0 Published

`_bmad-output/planning-artifacts/prd.md` — Primary PRD.

**Vision:** Transform from execution-based (humans write code) to orchestration-based (humans direct AI, validate quality). Target: 15 → 50+ projects, 30 → 12–15 people.

**Key insight from brainstorming:** Model evolved from "AI replaces all developers" to "AI augments humans in orchestration roles" — hybrid approach.

---

## 2025-11-18 — Brainstorming Session

`_bmad-output/planning-artifacts/brainstorming-session-results-2025-11-18.md`
Methods used: First Principles, Assumption Reversal, Devil's Advocate, Risk Matrix, SWOT.
