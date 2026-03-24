# PRD Version Index

## Current Active PRDs

| Version               | File                                                                 | Date       | Scope                                              | Status    |
| --------------------- | -------------------------------------------------------------------- | ---------- | -------------------------------------------------- | --------- |
| v1.0                  | `../../_bmad-output/planning-artifacts/prd.md`                       | 2025-11-20 | Full platform PRD                                  | ✅ Active |
| v1.1 (Connected Apps) | `../../_bmad-output/planning-artifacts/prd-connected-apps.md`        | 2026-03-11 | Connected Apps (CS5) addendum                      | ✅ Active |
| v1.2 (OpenSandbox)    | `../../_bmad-output/planning-artifacts/prd-opensandbox-migration.md` | 2026-03-21 | OpenSandbox migration, multi-provider, env cleanup | 📝 Draft  |

## Version History

### PRD v1.0 — 2025-11-20

**File:** `_bmad-output/planning-artifacts/prd.md`
**Author:** BMad
**Scope:** Full Dark Software Factory platform — 136 functional requirements across 9 capability areas
**Status:** Active — this is the primary product requirements document

Key sections:

- Vision: orchestration-based software development
- PM Capabilities (FR1–FR23)
- TL Capabilities (FR24–FR33)
- Lead QA Capabilities (FR34–FR43)
- Manager Capabilities (FR44–FR55)
- AI Orchestrator System (FR56–FR95)
- Dashboard & Reporting (FR96–FR115)
- Knowledge Base (FR116–FR120)
- Client Portal (FR121–FR127)
- Advanced Capabilities (FR128–FR136)

### PRD v1.1 — Connected Apps Addendum — 2026-03-11

**File:** `_bmad-output/planning-artifacts/prd-connected-apps.md`
**Scope:** Connected Apps feature (Epic CS5) — user-level OAuth, central management, self-serve import onboarding
**Status:** Active — implemented and complete as of 2026-03-17

Adds requirements:

- FR-CA1–CA3: ConnectedApp model with encrypted token storage
- FR-CA4–CA8: User-level ClickUp OAuth flow
- FR-CA9–CA12: Connected Apps settings page
- FR-CA13–CA17: Account-first import modal redesign
- FR-CA18–CA20: Auto-create ProjectIntegration on import

## How to Create a New PRD Version

When product requirements change significantly:

1. Copy the source file: `cp prd.md prd-v2.0.md` (in `_bmad-output/planning-artifacts/`)
2. Update this README with the new version entry
3. Add an entry to `../CHANGELOG.md`
4. Update `../AI-CONTEXT.md` section 4 (Document Map) to point to new version
