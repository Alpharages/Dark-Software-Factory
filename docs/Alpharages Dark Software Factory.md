# Alpharages “Dark Software Factory”

> **Vision**: A self‑running software delivery system where AI and automations handle planning → coding → review → test → deploy → observe with minimal human touch, while humans steer strategy and creativity.

**Company**: Alpharages — Services (MERN, Python, Laravel, AI/Agentic AI)  
**Mgmt**: ClickUp  
**Cloud**: AWS + DigitalOcean  
**AI**: PR‑Agent for PR workflows; custom Task Automation module using **BMED** method + OpenAI.

---

## 1) Operating Model

- **Always‑on pipelines**: Repos are prod‑ready; every PR triggers autonomous checks, effort estimates, and merges/rollbacks.
- **AI as staff engineer**: PR‑Agent + linting + SAST + test‑gen act as first‑line reviewers; humans approve exceptions.
- **Task autopilot**: Commits/PRs/events create/update ClickUp tasks with predicted **Effort Hours**, **Risk**, **Owner**, **Due**.
- **Policy‑as‑code**: Quality gates (coverage, security, perf budgets) enforced in CI/CD.
- **Closed‑loop telemetry**: Runtime signals generate fix‑tasks and even draft patches.

---

## 2) Reference Architecture

```text
Developers ─┐                         ┌──────── Observability ──┐
            ├─► GitHub (Repos/PRs) ──►│ CI/CD Orchestrator     │──► APM / Logs / Traces
            │                         │ (GitHub Actions)       │     (CloudWatch, Grafana/Loki)
            │                         └──────────┬─────────────┘
            │                                     │
            │                       Build/Test/Scan Jobs (Node.js, Python, PHP)
            │                                     │
            │                         ┌───────────▼───────────┐
            │                         │ Deployment Controller │──► AWS (EKS/ECS/Lambda) / DO (Apps/K8s)
            │                         └───────────┬───────────┘
            │                                     │
            │                         ┌───────────▼───────────┐
            │                         │ Feature Flags & DB     │──► RDS/Aurora/Dynamo / DO Managed DB
            │                         └────────────────────────┘
            │
            └─► PR‑Agent (alpharages/pr-agent) ─┐
                                                 ├─► Code Quality Scoring + Effort Estimation
ClickUp  ◄────────────────────────────────────────┤    (BMED + OpenAI; risk, scope, complexity)
                                                 └─► Auto‑Feedback to PR (review notes, fixes)

Security & Compliance: SSO, Secrets Mgmt (AWS Secrets Manager/DO), SAST/DAST, SBOM, artifact signing
```

**Data Flows (high‑level)**

1.  **PR Opened** → PR‑Agent scores quality, predicts **Effort Hours**, posts review + suggested patches.
2.  **CI Runs** → Unit/e2e tests; SAST (CodeQL), dependency audit (npm/yarn/pip/composer), coverage gates.
3.  **Gates Pass** → Auto‑merge; **Deploy** via Actions → AWS/DO.
4.  **Post‑Deploy** → Smoke tests + canary + automatic rollback on SLO breach.
5.  **Signals** (errors/latency) → Auto‑create ClickUp tasks with context + suggested fix PRs.

---

## 3) Core Components (Alpharages Stack)

- **Review & PR Automation**: PR‑Agent (https://github.com/Alpharages/pr-agent) with org‑specific rules, coverage hints, style.
- **Task Automation (BMED + OpenAI)**: parses diff + context → **B**reakdown, **M**easure effort, **E**valuate risk, **D**irect next steps.
    - Outputs: _Effort Hours_, _Confidence_, _Risk Score_, suggested assignee, SLA.
- **CI/CD**: GitHub Actions reusable workflows per language (Node/React, Python, Laravel).
    - Caching, matrix builds, parallel tests, artifact signing (cosign), SBOM (Syft), container scan (Trivy).
- **Runtime**: Kubernetes (EKS/DO Kubernetes) + Argo Rollouts (canary/blue‑green) + Feature Flags (OpenFeature/Unleash).
- **Observability**: OpenTelemetry → CloudWatch/Grafana Tempo/Loki/Prom + Error trackers (Sentry/Raygun).
- **Secrets & Policy**: OIDC to cloud, least‑privilege IAM, secrets in AWS SM / DO Secrets.

---

## 4) Quality & Governance

- **Quality Gates**: Coverage ≥ 80% (per service), LCP/API latency budgets, CVE severity ≤ Medium.
- **Branch Strategy**: Trunk‑based + short‑lived PRs; protected main, required checks, linear history.
- **Change Mgmt**: RFCs as markdown; auto‑render to PR description and Notion.
- **Release Cadence**: Daily by default; feature‑flag first, canary 10% → 50% → 100%.

---

## 5) KPIs (Auto‑tracked)

- Lead Time for Change, MTTR, Change Failure Rate, Deployment Frequency.
- PR Cycle Time, Auto‑merged %; Review‑to‑Merge ratio.
- Cost per Env / per Request; Test Flakiness; Coverage delta.

---

## 6) Rollout Plan (90 Days)

**Phase 1 – Foundation (Weeks 1‑3)**  
• Stand up shared Actions workflows; enable PR‑Agent on top 3 repos.  
• Connect ClickUp webhooks; map status ↔ PR states.

**Phase 2 – Autopilot CI (Weeks 4‑6)**  
• Add SAST/DAST, SBOM, container scans; enforce quality gates.  
• Implement BMED effort estimation comments on PRs + ClickUp.

**Phase 3 – Progressive Delivery (Weeks 7‑9)**  
• Canary rollouts + auto‑rollback; feature flags; smoke tests.

**Phase 4 – Closed Loop (Weeks 10‑12)**  
• Observability → Auto‑task + draft fix PRs; dashboard in Notion/Grafana.

---

## 7) Page Structure (suggested)

1.  **Overview** (This one‑pager)
2.  **Operating Handbook** (policies, checklists, SLOs)
3.  **Runbooks** (failures, rollbacks, incident comms)
4.  **Platform Playbooks** (MERN, Python, Laravel templates)
5.  **Dashboards** (KPIs + links)
6.  **References**: PR‑Agent source: https://github.com/Alpharages/pr-agent

---

## 8) Mermaid Diagram

```
flowchart LR
  Devs[Developers] -->|PRs| GH[GitHub]
  GH --> PRA[PR‑Agent\nQuality + Effort (BMED)]
  PRA -->|review notes / patches| PRC[Pull Request]
  GH --> CI[GitHub Actions CI/CD]
  CI --> TEST[Tests + SAST + SBOM + Scan]
  TEST -->|pass| DEPLOY[Argo/K8s Deploy]
  DEPLOY --> AWS[(AWS)]
  DEPLOY --> DO[(DigitalOcean)]
  DEPLOY --> FF[Feature Flags]
  AWS --> O11y[OpenTelemetry/Observability]
  DO --> O11y
  O11y -->|SLO breach| TA[Task Automation (BMED + OpenAI)]
  TA --> CU[ClickUp Tasks]
  PRC --> CU
```

---

### Tagline

**“Alpharages: Shipping software that ships itself.”**