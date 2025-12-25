# Story 14.2: PR Auto-Merge Integration

**Status**: done
**Role**: PR Orchestrator / Lead Dev
**Action**: Auto-merge low-risk PRs and manage reminders for others.
**Benefit**: Speed up the review process and ensure no PR is forgotten.

## User Story

As a GitHub PR Orchestrator,
I want to automatically merge low-risk PRs and manage reminders for human reviews,
so that the development pipeline moves faster while maintaining quality for critical changes.

## Acceptance Criteria

1. PRs with `risk_level: LOW` (assessed in 14.1) are automatically merged if `github.auto_merge_low_risk` config is enabled.
2. PRs with `risk_level: MEDIUM` or `HIGH` must wait for human review and are never auto-merged.
3. System sends reminders for pending PR reviews at 2h, 4h, and 24h intervals.
4. Each reminder is logged in the audit trail.
5. Metrics are recorded for auto-merges and reminders sent (`github_pr_auto_merged_total`, `github_pr_reminders_sent_total`).

## Tasks

- [ ] Implement `mergePullRequest` in `GitHubService` and `GitHubClientService`.
- [ ] Create `PRAutoMergeService` to coordinate merging based on risk assessment results.
- [ ] Create `PRReminderService` for scheduling and sending review reminders.
- [ ] Implement RabbitMQ-based delay mechanism for 2h, 4h, 24h reminders.
- [ ] Update `GitHubPROrchestrator` to trigger auto-merge and reminder flows.
- [ ] Add `github.autoMergeLowRisk` and `github.remindersEnabled` to app configuration.
- [ ] Add `PR_AUTO_MERGE` and `PR_REMINDER` actions to `AIDecisionLoggerService`.

## Dev Notes

- **GitHub API**: Use `octokit.pulls.merge` with `merge_method: 'squash'` (default for project).
- **RabbitMQ**: The project uses a `WAIT` queue pattern for retries. Extend this for PR reminders.
- **Risk Assessment**: Check `Execution.risk_level` (updated by 14.1).

## References

- Epic 14: v3 Observability & Operational Features
- Story 14.1: PR Risk Assessor
- [architecture.md](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md)

## Dev Agent Record

### File List

- [MODIFY] [github.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/github.service.ts)
- [MODIFY] [configuration.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/config/configuration.ts)
- [MODIFY] [env.validation.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/config/env.validation.ts)
- [MODIFY] [rabbitmq.config.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/rabbitmq/rabbitmq.config.ts)
- [MODIFY] [github.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/github.module.ts)
- [MODIFY] [github-pr-orchestrator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/github-pr-orchestrator.service.ts)
- [NEW] [pr-auto-merge.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/pr-auto-merge.service.ts)
- [NEW] [pr-reminder.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/pr-reminder.service.ts)
- [NEW] [pr-reminder.consumer.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/pr-reminder.consumer.ts)
- [NEW] [pr-auto-merge.service.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/pr-auto-merge.service.spec.ts)
- [NEW] [pr-reminder.service.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/pr-reminder.service.spec.ts)

### Change Log

- Added `mergePullRequest` and `getPullRequest` to `GitHubService`.
- Implemented `PRAutoMergeService` for automatic merging of LOW risk PRs.
- Implemented `PRReminderService` and `PRReminderConsumer` for scheduled PR review reminders (2h, 4h, 24h).
- Updated RabbitMQ configuration with `GITHUB_PR_REMINDER` queue.
- Integrated auto-merge and reminders into `GitHubPROrchestrator`.
- Added unit tests for new services and verified build.
