# Reporting

How to communicate results so they're actionable.

## Severity levels

- **Critical** — core flow blocked, data loss/corruption, security exposure, app crash. Ship-stopper.
- **Major** — a feature is broken with no reasonable workaround, but the app is otherwise usable.
- **Minor** — works but degraded: confusing UX, wrong-but-recoverable behavior, minor validation gap.
- **Trivial** — cosmetic: small misalignment, typo, inconsistent spacing. No functional impact.

Also tag each finding as **Bug** (violates expected behavior) or **Suggestion** (works but could be better). Keep these separate so the user can prioritize.

## Bug entry template

```
### [SEVERITY] Short, specific title

- **Severity:** Critical | Major | Minor | Trivial
- **Type:** Bug | Suggestion
- **Environment:** <browser>, <viewport>, <URL/env>
- **Preconditions:** <state needed to reproduce>

**Steps to reproduce**
1. ...
2. ...
3. ...

**Expected:** <what should happen>
**Actual:** <what actually happened>
**Consistency:** Always | Intermittent
**Evidence:** <screenshot ref, console error, network status, inputs used>
**Notes:** <scope flag if incidental, suspected cause if known>
```

A good title names the thing and the problem: "Checkout — 'Place order' button does nothing after declined card," not "button broken."

## Full report template

```
# QA Report — <app/feature>

**Date:** <date>   **Environment:** <prod/staging/local + URL>
**Browser/viewport:** <details>   **Scope:** <what was tested>
**Run command:** <how the project was started, if run locally>
**Startup log notes:** <warnings/errors at boot, or "none">
**Tester:** Claude (manual QA)

## Summary
<2–4 sentences: what was tested, overall verdict, headline issues.>

**Verdict:** Pass | Pass with issues | Fail
**Findings:** Critical: N · Major: N · Minor: N · Trivial: N

## Assumptions
<Inferred acceptance criteria, if no spec was given.>

## Test results
| ID | Test case | Expected | Actual | Status |
|----|-----------|----------|--------|--------|
| TC-01 | ... | ... | ... | PASS/FAIL/BLOCKED |

## Defects
<One bug entry per defect, ordered by severity.>

## Suggestions
<Non-bug improvements, optional.>

## Coverage & gaps
<What was not tested and why (out of scope, blocked, needs credentials).>
```

## Tone

Be specific, neutral, and non-blaming. Report facts and observed behavior, not speculation about who wrote what. If you suspect a cause, label it as a hypothesis. Lead with the highest-severity findings.

## Depth matching

- **Quick check / smoke test** → inline summary + a short list of any issues. No file needed.
- **Substantial QA pass** → write the full report to a Markdown file and present it, so the user can save and share it.
