# code-review-14-1.md

**🔥 CODE REVIEW FINDINGS, khakanali!**

**Story:** 14-1-pr-risk-assessor.md
**Git vs Story Discrepancies:** 10 found (Missing modifications, untracked files, status mismatches)
**Issues Found:** 1 Critical, 3 High, 5 Medium, 1 Low

## 🔴 CRITICAL ISSUES

- **C1: Brittle Private Access.** `PRRiskAssessorService` accesses the private `providers` map in `AIExecutionService` using indexer bypass (`aiExecution['providers']`). This is a dangerous architectural violation and will break if the service implementation changes.

## 🔴 HIGH ISSUES

- **H1: AC#7 Violation.** The `PR_RISK_ASSESSMENT` prompt template is hardcoded in `PRRiskAssessorService` instead of being implemented in `PromptGeneratorService` as required for consistency.
- **H2: AC#6 Violation.** Context documents (`ContextDocument`) are NOT being passed to the AI risk assessment logic, meaning the AI lacks project-specific context for critical path analysis.
- **H3: File List False Claim.** `PromptGeneratorService` is listed as `[MODIFY]` in the story but has no actual changes in git.

## 🟡 MEDIUM ISSUES

- **M1: AC#4 Logic Mismatch.** The AI returns generic risk recommendations (`PROCEED | CAUTION | BLOCKED`) instead of the specific auto-merge rules required by AC#4 (Auto-merge for LOW, 1 approval for MEDIUM, etc.).
- **M2: Documentation Gaps.** 8+ source files were modified but not documented in the story File List (e.g., `github.service.ts`, `webhooks.controller.ts`, `rabbitmq.config.ts`).
- **M3: Task 5 Proof Missing.** Task 5 (E2E test) is marked complete (`[x]`), but no new E2E test file exists in the `test/` directory.
- **M4: File Type Error.** `GitHubWebhookConsumer` is marked as `[MODIFY]` in the story but is actually a `[NEW]` file in git.
- **M5: Status Descrepancy.** The story file still claims `Status: ready-for-dev` while `sprint-status.yaml` marks it as `done`.

## 🟢 LOW ISSUES

- **L1: Code Style.** Inconsistent empty lines in `pr-risk-assessor.service.ts`.

---

**What should I do?**

1. **Fix them automatically** - I'll refactor the service, implement the missing prompt template, and update the docs.
2. **Create action items** - Add these as [AI-Review] tasks to the story file.
3. **Show me details** - Deep dive into specific issues.
