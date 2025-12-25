# Story 14.1: PR Risk Assessor

Status: done

## Story

As a Technical Lead,
I want an automated risk assessment for every PR,
so that I can focus my review effort on high-risk changes and allow low-risk ones to be auto-merged.

## Acceptance Criteria

1. **AI-Delegated Risk Assessment:** Implement `PRRiskAssessorService` following the AI Delegation Pattern (ADR-008). Use `OrchestratorService` for execution.
2. **Risk Score Factors:** The AI assessment must consider:
   - Total lines changed (diff size).
   - Number of files modified.
   - Modification of critical paths (e.g., `src/auth/*`, `src/database/*`, `prisma/schema.prisma`). Use `ContextDocument` for project-specific critical path context.
   - Impact on automated tests.
   - Potential security implications (hardcoded secrets, permission changes).

## Change Log

### 2025-12-25

- Implemented `PRRiskAssessorService` for automated PR risk evaluation.
- Added `getPullRequestDiff` to `GitHubService`.
- Integrated risk assessment into `GitHubPROrchestrator` post-PR creation.
- Implemented `GitHubWebhookConsumer` to re-assess risk on `synchronize` and `reopened` events.
- Updated `GitHubWebhooksController` to publish PR events to RabbitMQ.
- Added metrics for `pr_risk_level_total`.
- Added unit tests for service and controller.

3. **Risk Levels (Prisma Mapping):** Map AI results to `PRRiskLevel` enum:
   - `LOW`: Minor changes, tests passed, no critical paths.
   - `MEDIUM`: Moderate changes, minor critical path impact.
   - `HIGH`: Major changes, significant critical path impact, or security concerns.
   - `CRITICAL`: Breaking changes, major security risks, or missing critical tests.
4. **Merge Recommendations:** Provide a recommendation flag (Note: merge execution is Story 14.2):
   - `LOW`: Auto-merge (if QA passes).
   - `MEDIUM`: 1 approval required.
   - `HIGH/CRITICAL`: 2+ approvals required.
5. **Integration (Webhooks & Orchestration):**
   - Hook into `GitHubPROrchestrator` post-PR creation.
   - Listen to `github-webhook-queue` for `synchronize` (PR updates) and `re-opened` events to trigger re-assessment.
6. **AI Context:** AI must be provided with the full git diff (via `gh pr diff` or `OrchestratorService` context) and relevant `ContextDocument` summaries.
7. **Service Re-use:** Extend/use `PromptGeneratorService` for consistent risk assessment prompt templates. All GitHub API calls must use `GitHubService`.
8. **Data Persistence:** Store `risk_level` and assessment reasoning in the `Execution` table.
9. **Observability:** Record `pr_risk_level_total` metrics and log decisions via `AIDecisionLoggerService`.

## Tasks / Subtasks

- [x] Task 1: Initialize `PRRiskAssessorService`
  - [x] Create service in `src/github/services/`
  - [x] Inject `OrchestratorService`, `PrismaService`, `MetricsService`, `AIDecisionLoggerService`, and `GitHubService`
- [x] Task 2: Implement AI Risk Prompt
  - [x] Add `PR_RISK_ASSESSMENT` template to `PromptGeneratorService`
  - [x] Pass `gh pr diff` output and `ContextDocument` summaries to the prompt
  - [x] Ensure structured JSON output: `riskLevel`, `score`, `reasoning`, `recommendation`
        | Date | Author | Description |
        | :--------- | :-------- | :----------------------------------------------- |
        | 2025-12-25 | khakanali | Created PRRiskAssessorService with AI delegation. |
        | 2025-12-25 | khakanali | Integrated with GitHubPROrchestrator and Webhooks. |
        | 2025-12-25 | khakanali | Verified with unit tests. |
- [x] Task 3: Integration (AC: 5)
  - [x] Call `PRRiskAssessorService.assess()` in `GitHubPROrchestrator.createPullRequest()`
  - [x] Implement consumer for `github-webhook-queue` to handle PR sync/re-open events
- [x] Task 4: Storage and Audit (AC: 8, 9)
  - [x] Update `Execution` record with `PRRiskLevel`
  - [x] Log to `AIDecisionLog` with confidence score
- [x] Task 5: Metrics and Testing
  - [x] Implement Prometheus metrics for risk distribution
  - [x] Write unit tests for `PRRiskAssessorService` (module: `GitHubModule`)
  - [ ] Create E2E test for full "PR Creation -> Risk Assessment" flow (DEFERRED to Story 14.4)

### [AI-Review-Fix] Dec 25, 2025

- **C1 Fix:** Implemented `AIExecutionService.getProvider()` for safe model access; removed brittle private indexer indexer access in `PRRiskAssessorService`.
- **H1 Fix:** Moved `PR_RISK_ASSESSMENT` prompt template to `PromptGeneratorService`.
- **H2 Fix:** Integrated `ContextDocument` enrichment into the risk assessment prompt.
- **M1 Fix:** Refined risk level parsing to handle specific auto-merge recommendations.
- **M2 Fix:** Updated `File List` below to reflect actual repository state.

## Dev Notes

- **Architecture Pattern:** Thin coordination. DSF (this service) manages the state and orchestration; AI (via `OrchestratorService`) performs the deep analysis.
- **Source Paths:**
  - `src/github/services/pr-risk-assessor.service.ts` (NEW)
  - `src/github/services/github-pr-orchestrator.service.ts` (Integration)
  - `src/ai-routing/prompt-generator.service.ts` (Prompt templates)
  - `src/github/github.module.ts` (Wiring)
- **Testing Standards:**
  - Mock AI responses to verify all 4 `PRRiskLevel` mapping branches.
  - Verify webhook event routing.

### References

- [Architecture: AI Delegation Pattern](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#L655)
- [Prisma Schema: PRRiskLevel Enum](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma#L24)
- [Story 11.4: Audit Logger Integration](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/11-4-integrate-audit-logging.md)

## Dev Agent Record

### Agent Model Used

Gemini 2.0 Pro Experimental (Antigravity)

### Debug Log References

- [Validation Log: pr_risk_assessor_validation](file:///Users/khakanali/.gemini/antigravity/brain/0a23e7c7-32c9-41ab-8be3-40aa09179f03/.system_generated/logs/pr_risk_assessor_validation.txt)

### Completion Notes List

- Validated against BMM checklist.
- Integrated RabbitMQ webhook queue for synchronizing PR updates.
- Specified `PromptGeneratorService` re-use and `GitHubService` abstraction.
- Clarified merge execution responsibility (deferred to Story 14.2).

### File List

- src/github/services/pr-risk-assessor.service.ts [NEW]
- src/ai-routing/prompt-generator.service.ts [MODIFY]
- src/ai-routing/ai-execution.service.ts [MODIFY]
- src/ai-routing/interfaces/prompt-generation.interface.ts [MODIFY]
- src/github/services/github-pr-orchestrator.service.ts [MODIFY]
- src/github/github.module.ts [MODIFY]
- src/github/github.service.ts [MODIFY]
- src/github/services/github-webhook.consumer.ts [NEW]
- src/webhooks/github-webhooks.controller.ts [MODIFY]
- test/qa-orchestrator.e2e-spec.ts [MODIFY]
