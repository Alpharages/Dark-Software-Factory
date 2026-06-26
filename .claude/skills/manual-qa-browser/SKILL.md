---
name: manual-qa-browser
description: Run a web project and perform manual quality assurance (QA) testing of it through a browser, the way a human QA tester would — first starting the project (installing dependencies and launching its dev/server), then clicking, typing, navigating, and verifying behavior against expectations. Use this skill whenever the user wants to test a website or project, "QA" a web app, check a user flow, validate a feature, find bugs in a UI, do exploratory testing, run a smoke test, verify a deployment, or check that a page "works" in a browser. Trigger even when the user phrases it casually like "test my project", "run it and QA it", "can you test my site", "go through the signup flow", or "click around and see what breaks". By default, locate and run the project first, then test the running instance. Produces a structured bug report with reproduction steps, severity, and evidence.
---

# Manual QA in the Browser

This skill makes Claude behave like a thoughtful human manual QA tester: locate and run the project, open it in a browser, exercise it like a real user, observe what actually happens, compare it to what _should_ happen, and report defects clearly so a developer can act on them.

## Default behavior

Unless the user gives a live URL to test directly, **run the project first, then QA the running instance.** Do not block on questions when a project is present (uploaded, in the working directory, or referenced) — detect it, start it, and proceed. Only ask the user something if running genuinely can't proceed without it (e.g. missing secret credentials with no defaults).

## Prerequisites

**A target to test** — one of:

- A project to run (uploaded archive, files in the working directory, or a repo the user points to). This is the default path.
- A live URL the user supplies (skip the "run the project" phase and go straight to testing).

**A browser-driving tool** — check, in order:

1. **Claude in Chrome / a browsing-agent tool** — preferred for testing live/deployed URLs in a real browser.
2. **A connected MCP browser/automation server** (e.g. Playwright/Puppeteer-style) — search the registry if the user references one or none is present.
3. **bash + an installable driver** (Playwright/Selenium) in a code-execution environment — the default when running a project locally in the sandbox.

If no browser tool is available and one can't be installed, tell the user what's needed rather than guessing or simulating results. Never fabricate test outcomes — every result must come from a real interaction.

## The QA Workflow

Follow these phases in order. Don't skip the planning phase; ad-hoc clicking misses things and produces noise.

### 0. Locate and run the project

Skip this phase only if the user gave a live URL to test directly.

1. **Find the project.** Check the working directory and `/mnt/user-data/uploads` (extract any archive into a writable dir). If the user named a repo, clone it (only domains on the network allowlist are reachable).
2. **Detect the type and entry point** by inspecting files:
   - `package.json` → Node. Read its `scripts`; prefer `dev`, else `start`, else `preview`. Note the framework (Vite, Next, CRA, etc.) for the default port.
   - `requirements.txt` / `pyproject.toml` / `manage.py` / `app.py` → Python (Flask/Django/FastAPI/etc.).
   - Static `index.html` with no build → serve it (e.g. `python -m http.server`).
   - Other stacks → identify the documented run command from the README.
3. **Install dependencies** (`npm install` / `pip install -r requirements.txt --break-system-packages` / etc.). If install fails, capture the error — that's itself a finding — and report it before stopping.
4. **Start the server in the background** so it keeps running while you test (e.g. `nohup <cmd> &` or a backgrounded process), and capture its stdout/stderr to a log file.
5. **Wait until it's ready** — poll the expected URL until it responds (don't assume instant startup). Read the startup log to find the actual host/port it bound to; don't hardcode a guess.
6. **Record** the base URL, the run command, and any startup warnings/errors from the log (these often surface real bugs).

If the project can't be started, report exactly why (missing env var, failed build, port conflict, unsupported stack) with the relevant log output, then stop — don't pretend to test it.

### 1. Understand scope and expectations

Before touching the app, establish:

- **URL / environment** (prod, staging, local) and any credentials provided.
- **What to test** — a specific flow (signup, checkout), a feature, or general exploratory coverage.
- **Expected behavior / acceptance criteria** — what "correct" looks like. If the user didn't give criteria, infer reasonable ones from common UX conventions and state your assumptions.
- **Constraints** — browsers, viewports, data not to modify, destructive actions to avoid.

Ask only what you genuinely can't infer, and ask it once. If the user said "just test the site," proceed with exploratory testing and reasonable assumptions rather than blocking on questions.

### 2. Build a test plan

List the scenarios you'll run as concrete, ordered test cases. A good case has: a goal, steps, and an expected result. Cover the **happy path first**, then branch out. See `references/test-design.md` for how to derive cases, and `references/checklists.md` for ready-made coverage lists (forms, auth, navigation, responsive, accessibility basics).

Always include these classes of test, scope permitting:

- Happy path (the intended flow completes).
- Input validation (empty, invalid, boundary, too-long, special characters, XSS-ish strings like `<script>`).
- Negative / error paths (wrong password, declined card, network failure).
- State & navigation (back button, refresh, deep links, re-submission, browser back after submit).
- Edge cases (duplicate submit, double-click, slow network, logged-out access to gated pages).

### 3. Execute like a human

Drive the browser one deliberate step at a time. For each test case:

1. State the case you're running.
2. Perform the actions (navigate, click, type, scroll, wait).
3. **Observe** the actual result — take a screenshot or read the DOM/console as evidence.
4. **Compare** actual vs expected and record PASS / FAIL / BLOCKED.

Behave like an attentive tester, not a script: notice things outside the immediate assertion — layout breakage, console errors, slow loads, confusing copy, broken images, misaligned elements, missing loading states, focus traps. Check the **browser console and network tab** for errors even when the UI looks fine; many real bugs are invisible on the surface. Read `references/observation.md` for what to actively look for and how to gather evidence.

Be careful with destructive or irreversible actions (deleting data, real payments, sending emails). On non-test environments, stop and confirm before doing anything that mutates real data.

### 4. Reproduce and triage every defect

When something looks wrong:

- **Reproduce it** at least once more to confirm it's real and not a fluke. Note exact preconditions.
- Capture evidence: screenshot, console error text, network response, the exact URL and inputs.
- Assign **severity** (see `references/reporting.md`): Critical (blocks core flow / data loss / security), Major (feature broken, no reasonable workaround), Minor (degraded but usable), Trivial (cosmetic).
- Distinguish a **bug** (violates expected behavior) from a **suggestion** (works but could be better) and label accordingly.

### 5. Report

Produce a clear, structured report. The default format and a template are in `references/reporting.md`. At minimum, deliver:

- A short **summary**: what was tested, environment, overall verdict, counts of pass/fail by severity.
- A **results table** of test cases (case, expected, actual, status).
- **Detailed bug entries**, each with: title, severity, steps to reproduce, expected, actual, evidence.
- For substantial QA passes, write the report to a file (Markdown) and present it; for a quick check, an inline summary is fine. Match the depth to the request.

Be precise and non-blaming. Reproduction steps must be specific enough that a developer can follow them exactly without you present.

## Operating principles

- **Real interactions only.** Every PASS/FAIL must trace to something you actually did in the browser. Never infer that a flow works without exercising it.
- **Curiosity over checklist.** The checklist is a floor, not a ceiling — chase anything that smells off.
- **Reproducibility is the product.** A bug a developer can't reproduce is nearly worthless; nail down the steps.
- **Stay in scope, but report incidental findings** you stumble on, clearly marked as outside the requested scope.
- **No silent assumptions.** When you assume acceptance criteria, say so in the report.

## Reference files

- `references/running-projects.md` — Detecting project type, installing deps, starting the server, finding the URL, common stacks.
- `references/test-design.md` — Deriving test cases, techniques (boundary, equivalence, negative testing).
- `references/checklists.md` — Reusable coverage checklists by area (forms, auth, nav, responsive, a11y, performance).
- `references/observation.md` — What to watch for and how to collect evidence (console, network, screenshots).
- `references/reporting.md` — Severity definitions, bug-entry template, full report template.
