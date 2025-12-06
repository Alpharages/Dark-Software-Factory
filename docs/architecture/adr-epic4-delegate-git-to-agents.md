# ADR: Delegate GitHub Operations to Agentic AI Providers

**Date:** 2025-12-07  
**Status:** Accepted  
**Decision Makers:** PM (Product Manager), Development Team  
**Impact:** Epic 4 Stories 4.3, 4.4, 4.7

---

## Context

Epic 4 originally planned to build custom GitHub integration services for:
- **Story 4.3:** Git commit generation and push to GitHub
- **Story 4.4:** Pull request creation with metadata
- **Story 4.7:** GitHub push error handling and rollback

This would involve:
- Building a `GitHubCommitService` to create git trees, blobs, commits via GitHub API
- Implementing commit message generation logic with conventional commit format
- Creating PR template rendering and reviewer assignment logic
- Complex error handling, retry strategies, and rollback mechanisms
- Estimated effort: ~3 weeks of development

## Decision

**We will delegate GitHub git operations (commit, push, PR creation) to agentic AI providers (Cursor CLI, Claude Code) instead of building custom services.**

The orchestrator will:
1. Prepare git task instructions for AI agents
2. Delegate execution to AI providers
3. Parse structured output (commit SHA, PR URL)
4. Update tracking tables (`github_pushes`)
5. Monitor outcomes and extract metrics

## Rationale

### Technical Capabilities Confirmed
- ✅ AI agents execute git commands in terminal
- ✅ AI agents return structured output (commit SHA, PR URL, PR number)
- ✅ AI agents handle their own retry logic
- ✅ We can extract deployment data for PM dashboard

### Strategic Alignment
- **Dark Software Factory is an orchestrator**, not a git client
- Core value proposition is **coordination, quality gates, and routing**, not git implementation
- Leverage AI provider strengths for what they do best

### Effort Reduction
- Story 4.3: 80% reduction (1 week → 1-2 days)
- Story 4.4: 80% reduction (5 days → 1 day)  
- Story 4.7: 70% reduction (1 week → 2 days)
- **Total:** ~50% reduction in Epic 4 effort (4 weeks → 2 weeks)

### Maintainability
- Less code to maintain
- GitHub API changes handled by AI providers
- Simplified error handling (agents retry themselves)
- Focus development on higher-value orchestration logic

## Implementation Approach

### Story 4.3: Git Commit & Push (Delegated)
```typescript
const gitTask = {
  type: 'github-commit-push',
  instructions: `
    Push code changes to GitHub:
    1. Stage all changed files
    2. Generate commit message from ticket context
    3. Commit with conventional format
    4. Push to branch: ${branchName}
    5. Return commit SHA
  `,
  context: { ticketId, description, acceptanceCriteria, branchName }
};

const result = await aiProvider.execute(gitTask);
const commitSha = extractCommitSha(result.output);
await githubPushRepository.update({ commit_sha: commitSha });
```

### Story 4.4: PR Creation (Delegated)
```typescript
const prTask = {
  type: 'github-create-pr',
  instructions: `
    Create GitHub Pull Request:
    1. Title: ${ticket.title}
    2. Description: Include ticket context, QA results
    3. Labels: ai-generated, needs-review
    4. Return PR URL and number
  `,
  context: { ticketDescription, qaResults, aiProvider, confidence }
};

const result = await aiProvider.execute(prTask);
const { prUrl, prNumber } = extractPrInfo(result.output);
```

### Story 4.7: Error Handling (Simplified)
```typescript
try {
  const result = await aiProvider.execute(gitTask);
  // Success tracking
} catch (error) {
  await sentryService.captureException(error);
  await executionRepository.update({ status: 'GITHUB_PUSH_FAILED' });
  await clickupService.addComment(ticketId, `⚠️ GitHub push failed: ${error.message}`);
  metricsService.incrementGithubPushFailed(error.type);
}
// No complex retry logic - AI agents handle retries
```

## Consequences

### Positive
- ✅ **50% effort reduction** for Epic 4
- ✅ **Simpler codebase** - less git implementation logic
- ✅ **Leverage AI strengths** - agents optimized for git operations
- ✅ **Faster time-to-market** - deploy Epic 4 sooner
- ✅ **Reduced maintenance** - GitHub API changes handled upstream
- ✅ **Focus on value** - orchestration, quality gates, coordination

### Neutral
- ⚠️ **Dependency on AI providers** - git capabilities must remain stable
- ⚠️ **Output parsing required** - extract SHA/URL from agent responses (low risk, stable patterns)

### Trade-offs
- We lose fine-grained control over git operations (acceptable - not core value)
- Metrics extracted from agent output vs. instrumented code (acceptable - still observable)

## Scope Changes

| Story | Original Scope | Revised Scope | Status |
|-------|---------------|---------------|---------|
| 4.1 | GitHub API Client | ✅ Keep (Done) | No change |
| 4.2 | Branch Creation | ✅ Keep (Review) | No change |
| 4.3 | Commit & Push | 🔄 Delegate to Agent | Revised |
| 4.4 | PR Creation | 🔄 Delegate to Agent | Revised |
| 4.5 | CI/CD Trigger | ✅ Keep | No change |
| 4.6 | Deployment Sync | ✅ Keep | No change |
| 4.7 | Error Handling | ⚡ Simplified | Revised |
| 4.8 | Metrics | ✅ Keep | No change |

## Alternatives Considered

### Alternative 1: Build Custom GitHub Services (Original Plan)
- **Pros:** Full control, instrumented code, no dependency
- **Cons:** 3 weeks effort, complex maintenance, reinvent git operations
- **Rejected:** Not aligned with orchestrator vision, high effort for low value

### Alternative 2: Use GitHub Actions for Everything
- **Pros:** Native GitHub integration
- **Cons:** Tight coupling to GitHub, less flexibility for multi-provider approach
- **Rejected:** Reduces orchestrator's coordination value

### Alternative 3: Hybrid - Build Core, Delegate Edge Cases
- **Pros:** Balance of control and delegation
- **Cons:** Still significant effort, complex decision boundaries
- **Rejected:** Adds unnecessary complexity

## Migration Path

1. ✅ Complete Story 4.2 review (already in progress)
2. **Story 4.3:** Implement thin git task delegation wrapper (1-2 days)
3. **Story 4.4:** Implement thin PR task delegation wrapper (1 day)
4. **Story 4.7:** Simplified error monitoring (2 days)
5. **Stories 4.5-4.6:** Implement as planned (CI/CD monitoring)
6. **Story 4.8:** Extract metrics from agent output

**No breaking changes** - database schema unchanged, just different implementation.

## Success Criteria

- ✅ AI agents successfully execute git commit + push
- ✅ Orchestrator extracts commit SHA from agent output
- ✅ AI agents successfully create PRs with proper context
- ✅ Orchestrator extracts PR URL/number
- ✅ Metrics collected: `github_push_total`, `github_pr_created_total`
- ✅ PM dashboard displays deployment status (Epic 5 dependency)
- ✅ Epic 4 completed in ~2 weeks vs. original 4 weeks

## Related Documents

- [Implementation Plan](./implementation_plan.md) - Detailed technical approach
- [Sprint Status](../docs/sprint-artifacts/sprint-status.yaml) - Updated story statuses
- [Epics](../docs/epics.md) - Epic 4 breakdown

## Decision Log

- **2025-12-07:** PM identified opportunity to delegate git operations to AI agents
- **2025-12-07:** User confirmed AI agent capabilities (git commands, structured output, retries)
- **2025-12-07:** Created implementation plan with 50% effort reduction
- **2025-12-07:** User approved with "LGTM"
- **2025-12-07:** Updated sprint-status.yaml, created ADR

---

**Approved By:** Product Manager  
**Implementation:** Starting Story 4.3 (delegated approach)
