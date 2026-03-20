# Epic Files Index

## Active Epic Files

| File                                                          | Epic Group                   | Last Updated | Status      |
| ------------------------------------------------------------- | ---------------------------- | ------------ | ----------- |
| `_bmad-output/planning-artifacts/epics.md`                    | Main DSF Epics (1–15, 24–27) | 2026-03-05   | ✅ Active   |
| `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` | ClickUp Smart Sync (CS0–CS4) | 2026-03-11   | ✅ All done |
| `_bmad-output/planning-artifacts/epics-connected-apps.md`     | Connected Apps (CS5)         | 2026-03-11   | ✅ All done |
| `_bmad-output/planning-artifacts/epics-containerization.md`   | Containerization             | 2026-02-02   | Backlog     |

## Epic Completion Summary

### Core Epics (epics.md)

| Epic  | Name                            | Status                     |
| ----- | ------------------------------- | -------------------------- |
| 1     | Foundation & Dev Environment    | ✅ done                    |
| 2     | Ticket Intake & AI Routing      | ✅ done                    |
| 3     | Automated QA & Quality Gates    | ✅ done                    |
| 4     | GitHub Integration & CI/CD      | ✅ done                    |
| 5     | PM Dashboard & Orchestration    | ✅ done                    |
| 6     | Cost Tracking & Budget          | ✅ done                    |
| 7     | Architecture Review (ADRs)      | ✅ done                    |
| 8     | Lead QA Dashboard               | 🔄 partial                 |
| 9     | Production Error Monitoring     | 🔄 partial                 |
| 10    | Real-Time & Notifications       | 🔄 partial                 |
| 11    | Audit Log Viewer                | ✅ done                    |
| 12    | AI Resource Manager             | ✅ done                    |
| 13–14 | Observability Control           | ✅ done                    |
| 15    | V3 Config & Production Rollout  | 🔄 contexted (in-progress) |
| 24    | GitHub Multi-Account            | ✅ done                    |
| 25    | QA Stabilization                | ✅ done                    |
| 26    | PM Dashboard Feature Completion | ✅ done                    |
| 27    | Platform Polish & Mobile Nav    | ✅ done                    |

### ClickUp Smart Sync Epics (epics-clickup-smart-sync.md)

| Epic | Name                                    | Status  |
| ---- | --------------------------------------- | ------- |
| CS0  | PM Tool Integration Framework           | ✅ done |
| CS1  | Per-Project Workflow Configuration      | ✅ done |
| CS2  | Intelligent Field Pre-Check & Auto-Fill | ✅ done |
| CS3  | Actionable Sync Failure Handling        | ✅ done |
| CS4  | Legacy ClickUp Cleanup                  | ✅ done |

### Connected Apps Epics (epics-connected-apps.md)

| Epic | Name                              | Status  |
| ---- | --------------------------------- | ------- |
| CS5  | Connected Apps (User-Level OAuth) | ✅ done |

## Sprint Tracking File

Live epic/story status: `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Adding New Epics

1. Add to the appropriate epic source file in `_bmad-output/planning-artifacts/`
2. Create a context entry in `sprint-status.yaml`
3. Create story files in `_bmad-output/implementation-artifacts/stories/`
4. Update `../AI-CONTEXT.md` sections 1 and 2
5. Add entry to `../CHANGELOG.md`
