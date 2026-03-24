# AI-CONTEXT.md — Dark Software Factory

## ⚠️ READ THIS FIRST BEFORE ANY CODE WORK

**Last Updated:** 2026-03-20
**Project:** Dark Software Factory (DSF) — AI-powered software development orchestration platform
**Backend:** NestJS + Fastify + Prisma (this repo)
**Frontend:** `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`

---

## 1. What Has Been Built (Completed Epics)

Use this section to understand what already exists before making any changes.

### Phase 1 MVP Epics (Foundational — all done)

| Epic  | Name                           | Status          | Key Deliverable                             |
| ----- | ------------------------------ | --------------- | ------------------------------------------- |
| 1     | Foundation & Dev Environment   | ✅ done         | NestJS, Prisma, auth, CI/CD                 |
| 2     | Ticket Intake & AI Routing     | ✅ done         | ClickUp webhook, AI routing, RabbitMQ       |
| 3     | Automated QA & Quality Gates   | ✅ done         | Linting, test execution, quality gates      |
| 4     | GitHub Integration & CI/CD     | ✅ done         | Branch mgmt, PR creation, deployment        |
| 5     | PM Dashboard & Orchestration   | ✅ done         | PM dashboard, approval workflows            |
| 6     | Cost Tracking & Budget         | ✅ done         | AI cost tracking, budget alerts             |
| 7     | Architecture Review (ADRs)     | ✅ done         | ADR generation, TL review queue             |
| 8     | Lead QA Dashboard              | 🔄 partial      | 8-1 (review), 8-3 (drafted), 8-UI (backlog) |
| 9     | Production Error Monitoring    | 🔄 partial      | 9-U-1 (done), 9-U-5 (review)                |
| 10    | Real-Time & Notifications      | 🔄 partial      | 10-U-1/2 (review), 10-U-3/4/5/7 (review)    |
| 11    | Audit Log Viewer               | ✅ done         | Audit log UI complete                       |
| 12    | AI Resource Manager            | ✅ done         | Resource manager UI complete                |
| 13-15 | V3 Config & Production Rollout | 🔄 15 contexted | 15-4 backlog, 15-5 in-progress              |

### ClickUp Smart Sync Epics (New Feature Sprint — all done)

| Epic | Name                             | Status  | Key Deliverable                                                                         |
| ---- | -------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| CS0  | PM Tool Integration Framework    | ✅ done | IPMProvider interface, ClickUpProvider, PMProviderFactory, OAuth, multi-tenant webhooks |
| CS1  | Per-Project Workflow Config      | ✅ done | Runtime status discovery, ai_trigger_status field, live status picker UI, dev gate      |
| CS2  | Intelligent Field Pre-Check      | ✅ done | Required field check, factual auto-fill, Claude-inferred fill, verification comment     |
| CS3  | Actionable Sync Failure Handling | ✅ done | 4xx/5xx classification, pm_synced field, failure comments, SYNC_PENDING state           |
| CS4  | Legacy ClickUp Cleanup           | ✅ done | Removed LEGACY env vars, global webhook secret, dead polling code                       |

### Connected Apps Epics

| Epic | Name                              | Status  | Key Deliverable                                                                                                                           |
| ---- | --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CS5  | Connected Apps (User-Level OAuth) | ✅ done | ConnectedApp model, user ClickUp OAuth, Connected Apps settings page, import modal with account selection, auto-create ProjectIntegration |

### OpenSandbox Migration Epics

| Epic | Name                                   | Status   | Key Deliverable                                                                                          |
| ---- | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| OS   | OpenSandbox Migration & Multi-Provider | 📝 draft | Replace DooD with OpenSandbox, add Gemini/Codex/Kimi providers, retire Cursor, clean up 27 dead env vars |

### QA Stabilization & Polish Epics

| Epic | Name                             | Status  | Key Deliverable                                                        |
| ---- | -------------------------------- | ------- | ---------------------------------------------------------------------- |
| 24   | GitHub Multi-Account Integration | ✅ done | GitHub App flow, repo selector, token retrieval, disconnect            |
| 25   | QA Stabilization (Critical Bugs) | ✅ done | HMAC enforcement, startup health, 3 critical + 14 high bugs fixed      |
| 26   | PM Dashboard Feature Completion  | ✅ done | Project creation dialog, filters, KPI widgets (STAT-1–8)               |
| 27   | Platform Polish & Mobile Nav     | ✅ done | Mobile navigation, 404 page, document titles, integration health panel |

---

## 2. Current Project State (as of 2026-03-20)

### What's In Progress / Next

| Item                                | Status      | Priority | Notes                                          |
| ----------------------------------- | ----------- | -------- | ---------------------------------------------- |
| 15-5 E2E Testing & Validation       | in-progress | HIGH     | Full E2E flow, 100 concurrent ticket load test |
| 15-4 Production Rollout Plan        | backlog     | HIGH     | Staging → canary → 100% rollout procedure      |
| 8-1 QA Review Queue Config          | review      | MEDIUM   | Sampling strategy configuration                |
| 8-3 Production Approval Workflow    | drafted     | MEDIUM   |                                                |
| 9-U-5 Production Error Dashboard    | review      | MEDIUM   |                                                |
| 10-U-1 Socket.IO Infrastructure     | review      | MEDIUM   |                                                |
| 10-U-2 Execution Progress Streaming | review      | MEDIUM   |                                                |
| 8-UI Lead QA Dashboard              | backlog     | LOWER    |                                                |

### Sprint Tracking

- **Source of truth:** `_bmad-output/implementation-artifacts/sprint-status.yaml`
- **Story files:** `_bmad-output/implementation-artifacts/stories/`
- **Story format:** `{epic-id}-{story-id}-{slug}.md`

---

## 3. Architecture Overview

### Key Patterns (Do Not Change Without Impact Analysis)

- **PM Integration:** All PM tool operations go through `IPMProvider` interface → `PMProviderFactory` → `ClickUpProvider`. Never call ClickUp API directly.
- **Token Storage:** OAuth tokens stored encrypted via `EncryptionService`. Two models: `ProjectIntegration` (project-level) and `ConnectedApp` (user-level).
- **Ticket Intake:** `ClickUpTaskUpdateConsumer` → `DevelopmentGateService` (checks `ai_trigger_status`) → ticket-intake-queue. Only tasks at the configured trigger status enter.
- **Sync Flow:** `DeploymentStatusSyncService` → pre-check → auto-fill → post → verification comment → `pm_synced = true/false`.
- **Status Discovery:** `PMStatusService` with 5-minute TTL cache + stale fallback to Sentry. Never hardcode ClickUp status names.
- **Auth Model:** JWT + bcrypt. `ConnectedApp` ownership enforced by `(id, userId)` — both params required.

### Critical Technical Decisions

| Decision                                                        | Rationale                                                                                     | Where                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- |
| `AppProvider` vs `PMProvider` enum                              | `AppProvider` = all integrations (ClickUp, GitHub, etc). `PMProvider` = PM tools only         | `prisma/schema.prisma` |
| `ConnectedApp` user-level vs `ProjectIntegration` project-level | Solve chicken-and-egg: user can connect before creating project                               | CS5 retro              |
| No hardcoded status maps                                        | CS1: all statuses discovered at runtime from ClickUp API                                      | `PMStatusService`      |
| RabbitMQ for AI execution                                       | All async AI work goes through queues — never call AI providers synchronously in HTTP request | `rabbitmq/` module     |

### Known Technical Debt

| Item                                                    | Epic    | Priority |
| ------------------------------------------------------- | ------- | -------- |
| `localStorage` key format inconsistency in import modal | CS5     | Low      |
| 8-UI Lead QA dashboard not yet built                    | epic-8  | Medium   |
| E2E tests not yet complete                              | epic-15 | High     |

---

## 4. Document Map

### Core Planning Docs

| Document           | Path                                                                                                    | Description                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Main PRD v1.0      | `docs/prd/prd-v1.0-2025-11-20.md` → source: `_bmad-output/planning-artifacts/prd.md`                    | Primary product requirements                            |
| Connected Apps PRD | `docs/prd/prd-connected-apps-v1.0.md` → source: `_bmad-output/planning-artifacts/prd-connected-apps.md` | CS5 requirements                                        |
| OpenSandbox PRD    | `_bmad-output/planning-artifacts/prd-opensandbox-migration.md`                                          | Epic OS — DooD replacement, multi-provider, env cleanup |
| Architecture       | `_bmad-output/planning-artifacts/architecture.md`                                                       | System architecture (126K)                              |
| UX Design          | `_bmad-output/planning-artifacts/ux-design-specification.md`                                            | UI/UX patterns                                          |
| Sprint Status      | `_bmad-output/implementation-artifacts/sprint-status.yaml`                                              | Current sprint state                                    |

### Epic Source Files

| Epic Group                   | Source File                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| Main DSF epics (1–15, 24–27) | `_bmad-output/planning-artifacts/epics.md`                    |
| ClickUp Smart Sync (CS0–CS4) | `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` |
| Connected Apps (CS5)         | `_bmad-output/planning-artifacts/epics-connected-apps.md`     |
| Containerization             | `_bmad-output/planning-artifacts/epics-containerization.md`   |

### Retrospectives

| Epic     | File                                                                 |
| -------- | -------------------------------------------------------------------- |
| Epic 25  | `_bmad-output/implementation-artifacts/epic-25-retro-2026-03-01.md`  |
| Epic 26  | `_bmad-output/implementation-artifacts/epic-26-retro-2026-03-02.md`  |
| Epic 27  | `_bmad-output/implementation-artifacts/epic-27-retro-2026-03-03.md`  |
| Epic CS0 | `_bmad-output/implementation-artifacts/epic-CS0-retro-2026-03-13.md` |
| Epic CS1 | `_bmad-output/implementation-artifacts/epic-CS1-retro-2026-03-14.md` |
| Epic CS2 | `_bmad-output/implementation-artifacts/epic-CS2-retro-2026-03-15.md` |
| Epic CS5 | `_bmad-output/implementation-artifacts/epic-CS5-retro-2026-03-17.md` |

### QA Reports

| Report                              | File                                              |
| ----------------------------------- | ------------------------------------------------- |
| 2026-02-27 (source for epics 25–27) | `docs/QA-REPORT-2026-02-27.md`                    |
| 2026-03-04                          | `_bmad-output/qa-reports/qa-report-2026-03-04.md` |

### Architecture Decisions

| ADR                            | File                                                    |
| ------------------------------ | ------------------------------------------------------- |
| ADR-008: AI Delegation Pattern | `docs/architecture/adr-008-ai-delegation-pattern.md`    |
| Epic 4 Git Delegation          | `docs/architecture/adr-epic4-delegate-git-to-agents.md` |
| Branch Strategy v3             | `docs/architecture/branch-strategy-v3.md`               |

---

## 5. What AI Should Know Before Fixing Any Issue

### Before Editing Any Code

1. **Run impact analysis** via `gitnexus_impact({target: "symbolName", direction: "upstream"})` — required per CLAUDE.md
2. **Check sprint status** in `_bmad-output/implementation-artifacts/sprint-status.yaml` to understand what's in-progress
3. **Check the relevant story file** in `_bmad-output/implementation-artifacts/` — it contains the full acceptance criteria, code review findings, and known issues

### Common Mistake Patterns (From Retros)

- **Never call ClickUp API directly** — always go through `IPMProvider` / `PMProviderFactory`
- **Never hardcode ClickUp status names** — use `PMStatusService` for runtime discovery
- **Always pass both `(id, userId)`** to `ConnectedAppService` methods — ownership check requires both
- **Never use `localStorage` for auth** — use `useAuth()` hook (fixed in Epic 25, story 25-5)
- **Always add `staleTime` to React Query calls** — at minimum `staleTime: 60000`
- **OAuth callback route must match** registered app URL exactly — past issue in CS0-6
- **`enabled: !!user`** guard required on all React Query hooks that need auth

### Env Vars That Were Removed (Do NOT Re-Add)

These were cleaned up in Epic CS4 and CS1-7. Do NOT add them back:

- `CLICKUP_USE_WEBHOOKS` — removed
- `CLICKUP_WEBHOOK_SECRET` (global) — replaced by per-workspace DB lookup
- `ACTIONABLE_STATUSES` — replaced by per-project `ai_trigger_status`
- `NON_ACTIONABLE_STATUSES` — removed
- `CLICKUP_STATUS_*` env vars — removed
- `CLICKUP_API_KEY` — replaced by OAuth (still in config but deprecated)

---

## 6. Version History of This Document

| Version | Date       | What Changed                                    |
| ------- | ---------- | ----------------------------------------------- |
| v1.0    | 2026-03-20 | Initial creation. Covers all epics through CS5. |
