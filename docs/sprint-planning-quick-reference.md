# Sprint Planning Quick Reference
## Dark Software Factory - Phase 1 MVP

**Duration:** 12 Sprints (24 Weeks / 6 Months)  
**Team Velocity Target:** 50 points/sprint  
**Total Points:** ~598 points

---

## Sprint Overview (2-Week Sprints)

| Sprint | Weeks | Focus | Epics | Points | Status |
|--------|-------|-------|-------|--------|--------|
| **1** | 1-2 | Foundation | Epic 1 | 53 | 🔴 Not Started |
| **2** | 3-4 | Foundation + Webhooks | Epic 1, 2.1-2.2 | 50 | 🔴 Not Started |
| **3** | 5-6 | AI Routing Core | Epic 2.3-2.5 | 52 | 🔴 Not Started |
| **4** | 7-8 | AI Providers (CRITICAL) | Epic 2.6-2.7 | 42 | 🔴 Not Started |
| **5** | 9-10 | Multi-Provider + Retry | Epic 2.8-2.10 | 50 | 🔴 Not Started |
| **6** | 11-12 | Context + QA Start | Epic 2.11-2.12, 3.1 | 48 | 🔴 Not Started |
| **7** | 13-14 | QA Automation | Epic 3.2-3.5, 6.1 | 52 | 🔴 Not Started |
| **8** | 15-16 | QA Complete + GitHub | Epic 3.6-3.8, 4.1-4.2, 6.2 | 51 | 🔴 Not Started |
| **9** | 17-18 | GitHub Integration | Epic 4.3-4.6, 7.1-7.2, 8.1-8.2 | 48 | 🔴 Not Started |
| **10** | 19-20 | GitHub + Reviews | Epic 4.7-4.9, 7.3-7.4, 8.3-8.4, 9.1-9.2 | 52 | 🔴 Not Started |
| **11** | 21-22 | Dashboards | Epic 5, 7.5-7.7, 8.5-8.6, 9.3-9.5, 10.3-10.5 | 52 | 🔴 Not Started |
| **12** | 23-24 | Polish & Deploy | Epic 5, 6, 8, 9, 10 remaining | 48 | 🔴 Not Started |

---

## Critical Milestones

### Milestone 1: Foundation Complete (End of Sprint 2)
**Week 4 - Sprint 2**
- ✅ NestJS app running
- ✅ Database + Auth working
- ✅ RabbitMQ connected
- ✅ ClickUp webhooks receiving events
- ✅ Tickets being parsed

**Risk:** Foundation delays block all subsequent work  
**Mitigation:** Prioritize P0 stories, skip P3 items if needed

---

### Milestone 2: Cursor Integration Complete (End of Sprint 4)
**Week 8 - Sprint 4**
- ✅ Cursor CLI Headless provider working
- ✅ AI routing logic functional
- ✅ First ticket → AI → code flow complete
- ✅ Workspace isolation validated

**Risk:** Cursor CLI compatibility issues  
**Mitigation:** POC in Sprint 4 week 1, fallback to Claude Code only if blocked

---

### Milestone 3: Multi-Provider Working (End of Sprint 5)
**Week 10 - Sprint 5**
- ✅ Claude Code provider integrated
- ✅ Multi-provider orchestration working
- ✅ Fallback logic tested
- ✅ Complexity-based routing validated

**Risk:** Provider integration complexity  
**Mitigation:** Dedicated sprint, parallel team work

---

### Milestone 4: End-to-End Flow (End of Sprint 8)
**Week 16 - Sprint 8**
- ✅ ClickUp → AI → QA → GitHub complete
- ✅ Quality gates enforcing
- ✅ First PR created automatically

**Risk:** Integration points failing  
**Mitigation:** Integration testing from Sprint 7

---

### Milestone 5: MVP Deployment (End of Sprint 12)
**Week 24 - Sprint 12**
- ✅ All dashboards live
- ✅ Cost tracking operational
- ✅ Monitoring in place
- ✅ Pilot project ready to start
- ✅ Production deployment complete

**Risk:** Polish taking too long  
**Mitigation:** P3 items deferred to Phase 2 if needed

---

## Sprint Details

### SPRINT 1 (Weeks 1-2): Foundation - Part 1
**Goal:** Runnable application with core infrastructure  
**Points:** 53

**Stories:**
- 1.1: Project Init (5) - P0
- 1.2: TypeScript Config (3) - P0
- 1.3: Database + Prisma (8) - P0
- 1.4: Environment Config (3) - P0
- 1.5: RabbitMQ (5) - P0
- 1.6: Auth Service (8) - P0
- 1.7: Logging (5) - P1
- 1.8: Error Handling (5) - P1
- 1.9: Sentry (3) - P1
- 1.10: CI/CD Pipeline (8) - P1

**Deliverable:** Working NestJS app, deployed to staging

**Definition of Done:**
- [ ] App runs locally
- [ ] Database migrations work
- [ ] Auth endpoints return JWT
- [ ] RabbitMQ connected
- [ ] CI/CD deploys to staging
- [ ] Health check endpoint works

---

### SPRINT 2 (Weeks 3-4): Webhooks + Foundation
**Goal:** ClickUp integration receiving tickets  
**Points:** 50

**Stories from Epic 1:**
- 1.9: Sentry Integration (3) - P1 [if not done]
- 1.10: CI/CD Pipeline (8) - P1 [if not done]

**Stories from Epic 2:**
- 2.1: ClickUp Webhooks (8) - P0
- 2.2: Ticket Parsing (8) - P0

**Parallel Work:**
- Team A: Stories 1.9-1.10
- Team B: Story 2.1
- Team C: Story 2.2

**Deliverable:** ClickUp webhooks successfully creating ticket records

**Definition of Done:**
- [ ] Webhook endpoint validates signatures
- [ ] Tickets parsed and stored in DB
- [ ] Validation errors returned to ClickUp
- [ ] CI/CD pipeline complete

---

### SPRINT 3 (Weeks 5-6): AI Routing Core
**Goal:** Routing logic + prompt generation  
**Points:** 52

**Stories:**
- 2.3: AI Routing Logic (13) - P0
- 2.4: Prompt Generation (8) - P0
- 2.5: Execution Tracking (8) - P0
- 6.1: Cost Tracking Setup (8) - P1 [START]
- 10.1: Socket.IO Setup (5) - P1 [START]
- 10.2: Event Emitters (8) - P1 [START]

**Parallel Work:**
- Team A: Stories 2.3-2.5 (AI core)
- Team B: Story 6.1 (Cost)
- Team C: Stories 10.1-10.2 (Real-time)

**Deliverable:** Tickets routed, prompts generated, ready for AI providers

**Definition of Done:**
- [ ] Complexity scoring working
- [ ] Provider selection logic tested
- [ ] Prompts generated for both Cursor + Claude Code
- [ ] Execution states tracked
- [ ] Cost tracking service created

---

### SPRINT 4 (Weeks 7-8): AI PROVIDERS - CRITICAL SPRINT
**Goal:** Cursor + Claude Code integrations working  
**Points:** 42

**Stories:**
- 2.6: Cursor CLI Headless (21) - P0 **CRITICAL**
- 2.7: Claude Code (21) - P0 **CRITICAL**

**THIS IS THE MAKE-OR-BREAK SPRINT**

**Approach:**
- Week 1 (Week 7): Both POCs in parallel
  - Team A: Cursor POC
  - Team B: Claude Code POC
  - Daily standups to unblock issues
- Week 2 (Week 8): Production implementation
  - Both teams implement full providers
  - Integration testing throughout

**POC Success Criteria (End of Week 7):**
- [ ] Cursor CLI headless executes and returns code
- [ ] Claude Code API responds with code
- [ ] Workspace isolation working for both
- [ ] Git diff collection working
- [ ] Decision: GO/NO-GO for production implementation

**Deliverable:** Both AI providers integrated and working

**Definition of Done:**
- [ ] Cursor headless provider executes tickets
- [ ] Claude Code provider executes tickets
- [ ] Code changes collected via git diff
- [ ] Both providers tracked in metrics
- [ ] Workspace cleanup working
- [ ] Integration tests passing

**Risk Mitigation:**
- If Cursor CLI issues → Claude Code only (acceptable)
- If Claude Code issues → Cursor only (acceptable)
- If both have issues → ESCALATE to PM/CTO (blocker)

---

### SPRINT 5 (Weeks 9-10): Multi-Provider + Retry
**Goal:** Fallback logic + retry working  
**Points:** 50

**Stories:**
- 2.8: Multi-Provider Orchestration (13) - P0
- 2.9: Retry Logic (8) - P1
- 2.10: RabbitMQ Queue (8) - P1
- 6.2: Cost Metrics API (5) - P1
- 7.1: ADR Parser (5) - P2
- 7.2: TL Review Queue (5) - P2

**Deliverable:** Complete AI routing with fallback

**Definition of Done:**
- [ ] Fallback triggers on provider failure
- [ ] Retry logic with exponential backoff
- [ ] RabbitMQ async processing
- [ ] Cost APIs returning data
- [ ] ADR parsing from AI output

---

### SPRINT 6 (Weeks 11-12): Context + QA Start
**Goal:** Complete Epic 2, start QA automation  
**Points:** 48

**Stories:**
- 2.11: Quality Scoring (5) - P2
- 2.12: Context Extraction (8) - P2
- 3.1: Linting Integration (8) - P0
- 8.1: QA Review Queue (5) - P1
- 8.2: Sampling Strategy (5) - P2
- 9.1: Error Log Integration (8) - P2
- 9.2: Error Pattern Recognition (8) - P2

**Deliverable:** Epic 2 complete, linting working

---

### SPRINT 7 (Weeks 13-14): QA Automation
**Goal:** Automated testing + security  
**Points:** 52

**Stories:**
- 3.2: Test Execution (13) - P0
- 3.3: Code Review Checks (8) - P1
- 3.4: Coverage Calculation (5) - P1
- 3.5: Security Scanning (8) - P1
- 10.3: Socket.IO Client (5) - P1 [if not done]
- 10.4: System Health Dashboard (8) - P1
- 10.5: Alert System (5) - P2

**Deliverable:** Full QA automation suite

---

### SPRINT 8 (Weeks 15-16): Quality Gates + GitHub
**Goal:** QA enforcement + GitHub integration starts  
**Points:** 51

**Stories:**
- 3.6: Quality Gate Enforcement (8) - P0
- 3.7: QA Results Storage (5) - P1
- 3.8: QA Reports (5) - P2
- 4.1: GitHub API (5) - P0
- 4.2: Branch Creation (5) - P0
- 6.3: Cost Dashboard (13) - P1
- 8.3: QA Review UI (13) - P1 [START]

**Deliverable:** Quality gates blocking bad code, GitHub connected

**Definition of Done:**
- [ ] Failed QA blocks PR creation
- [ ] GitHub branches created
- [ ] Cost dashboard showing data

---

### SPRINT 9 (Weeks 17-18): GitHub Integration
**Goal:** Complete GitHub flow  
**Points:** 48

**Stories:**
- 4.3: Code Push (8) - P0
- 4.4: Commit Messages (3) - P1
- 4.5: PR Creation (8) - P0
- 4.6: PR Descriptions (5) - P1
- 7.3: Architecture Review UI (8) - P2
- 7.4: Pattern Constraints (5) - P3
- 8.3: QA Review UI (13) - P1 [FINISH]
- 8.4: Sampling Config (3) - P2

**Deliverable:** PRs created automatically

---

### SPRINT 10 (Weeks 19-20): CI/CD + Reviews
**Goal:** Deployment automation + review workflows  
**Points:** 52

**Stories:**
- 4.7: CI/CD Trigger (5) - P0
- 4.8: Deployment Monitoring (8) - P1
- 4.9: ClickUp Status Sync (5) - P1
- 7.5: Violation Detection (8) - P2
- 7.6: TL Dashboard (5) - P3
- 7.7: Architecture History (3) - P3
- 8.5: Quality Metrics (5) - P2
- 8.6: QA Dashboard (8) - P2
- 9.3: Bug Ticket Creation (8) - P2
- 9.4: Severity Assignment (5) - P2

**Deliverable:** End-to-end flow complete (ClickUp → GitHub → Deployed)

**Definition of Done:**
- [ ] PR triggers CI/CD
- [ ] Deployment status tracked
- [ ] ClickUp updated on deploy

---

### SPRINT 11 (Weeks 21-22): Dashboards - Part 1
**Goal:** PM + Manager dashboards functional  
**Points:** 52

**Stories from Epic 5 (PM Dashboard):**
- 5.1: Dashboard Layout (8) - P1
- 5.2: Real-Time Status Cards (8) - P1
- 5.3: Ticket Timeline (8) - P1
- 5.4: Code Approval UI (13) - P0
- 5.9: Search & Filtering (5) - P2
- 5.10: Metrics Summary (5) - P2

**Stories from Epic 9:**
- 9.5: Fix Ticket Routing (5) - P2

**Deliverable:** PM dashboard working with real-time updates

---

### SPRINT 12 (Weeks 23-24): Polish & Deploy - FINAL SPRINT
**Goal:** Complete all remaining MVP features, deploy to production  
**Points:** 48

**Stories from Epic 5:**
- 5.5: Quick Actions (5) - P2
- 5.6: Project Creation (8) - P2
- 5.7: Project Config (5) - P2
- 5.8: Bulk Operations (5) - P3
- 5.11: Notification Preferences (3) - P3
- 5.12: Mobile Responsive (8) - P3

**Stories from Epic 6:**
- 6.4: Cost Optimization Recommendations (8) - P2
- 6.5: Budget Alerts (5) - P2
- 6.6: Cost Cap Enforcement (5) - P3 [DEFER IF NEEDED]

**Stories from Epic 8:**
- 8.7: QA Feedback Loop (8) - P3 [DEFER]
- 8.8: QA Escalation (5) - P3 [DEFER]

**Stories from Epic 9:**
- 9.6: Self-Healing Monitoring (5) - P3 [DEFER]
- 9.7: Self-Healing Dashboard (8) - P3 [DEFER]

**Stories from Epic 10:**
- 10.6: Performance Metrics (5) - P2
- 10.7: Activity Log (5) - P3 [DEFER]

**Deliverable:** MVP COMPLETE - Ready for pilot project

**Final Definition of Done:**
- [ ] All P0 and P1 stories complete
- [ ] All dashboards functional
- [ ] Cost tracking accurate
- [ ] Monitoring in place
- [ ] Production deployment successful
- [ ] Pilot project can start
- [ ] Runbook documented
- [ ] Training materials ready

**Items to DEFER to Phase 2 if needed:**
- Story 6.6 (Cost Caps) - P3
- Story 8.7-8.8 (QA Feedback) - P3
- Story 9.6-9.7 (Self-Healing Dashboard) - P3
- Story 10.7 (Activity Log) - P3
- Story 5.8, 5.11, 5.12 (Dashboard polish) - P3

---

## Velocity Management

### Baseline Velocity (Sprints 1-2)
- **Target:** 50 points/sprint
- **Expected:** 40-45 points (learning phase)
- **Action:** Adjust Sprint 3+ if velocity <40

### Steady State (Sprints 3-10)
- **Target:** 50 points/sprint
- **Acceptable:** 45-55 points
- **Action:** Buffer Sprint 11-12 for catch-up

### Final Push (Sprints 11-12)
- **Target:** 48-52 points
- **Strategy:** Defer P3 items if behind

---

## Risk & Mitigation Plan

### High-Risk Sprints

**Sprint 4 (AI Providers):**
- **Risk:** Cursor/Claude Code integration fails
- **Mitigation:** Full-time focus, daily standups, escalation path ready
- **Fallback:** Single provider acceptable for MVP

**Sprint 8 (Quality Gates):**
- **Risk:** Integration points fail
- **Mitigation:** Integration testing from Sprint 7
- **Fallback:** Manual gates temporarily

**Sprint 12 (Final Deployment):**
- **Risk:** Too many P3 items, not ready
- **Mitigation:** Defer P3 to Phase 2, focus on P0/P1

### Buffer Strategies

1. **Sprint 6:** Can defer Story 2.11-2.12 if behind
2. **Sprint 10:** Can defer Epic 7 (TL) completely if needed
3. **Sprint 12:** Can defer all P3 items

---

## Success Criteria by Sprint

### Sprint 4 Success = MVP Success
If Sprint 4 delivers working AI providers, the project will succeed.  
If Sprint 4 fails, the project is at risk.

**Sprint 4 GO/NO-GO Decision (End of Week 7):**
- ✅ GO: At least one provider working → Continue
- ❌ NO-GO: No providers working → Escalate, pivot strategy

---

## Team Composition Recommendations

**Ideal Team (Sprints 1-12):**
- 2x Backend Engineers (NestJS, TypeScript)
- 1x Frontend Engineer (React, dashboards)
- 1x DevOps Engineer (CI/CD, infrastructure)
- 1x QA Engineer (Test automation)
- 1x Scrum Master / PM

**Critical Skills:**
- Node.js / NestJS expertise
- AI/LLM integration experience (Sprint 4)
- Git automation (Sprint 9)
- React dashboard development (Sprint 11-12)

---

**Document Status:** ✅ Ready for Sprint Planning  
**Last Updated:** 2025-11-26  
**Owner:** Scrum Master / PM  
**Next Action:** Schedule Sprint 1 Planning Session

