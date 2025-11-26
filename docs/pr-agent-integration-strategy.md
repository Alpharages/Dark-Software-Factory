# pr-agent Integration Strategy
## Dark Software Factory

**Version:** 2.0  
**Last Updated:** 2025-11-25  
**Purpose:** Clarify pr-agent's role as secondary AI code reviewer in Cursor Headless architecture

---

## pr-agent Overview

**pr-agent** is an open-source AI-powered PR review tool originally created by Qodo (formerly CodiumAI). The Dark Software Factory has forked this repository to customize for internal use.

**Repository**: `/Volumes/Data/project/products/alpharages/pr-agent`

**Current Status**: Legacy/open-source version with basic PR review capabilities

---

## Role Clarification

### ❌ What pr-agent is NOT

pr-agent is **NOT** the primary AI orchestrator for the Dark Software Factory. Specifically:

- ❌ **NOT** the AI code generation engine
- ❌ **NOT** the ticket-to-code automation system
- ❌ **NOT** the ClickUp webhook listener
- ❌ **NOT** the 20% gap solution mentioned in architecture docs

### ✅ What pr-agent IS

pr-agent is a **secondary AI code reviewer** (AI #2) that provides quality assurance:

- ✅ **Automated PR review** after AI #1 generates code
- ✅ **Code quality scoring** (maintainability, security, performance)
- ✅ **Effort estimation** for PRs
- ✅ **Best practices enforcement** based on team standards
- ✅ **Pull request chat interface** for explanations

---

## Integration Pattern

### Flow Diagram

```
1. PM creates ticket in AetherFlow (BMAD agents ensure quality)
   ↓
2. Dark Software Factory Orchestrator receives ClickUp webhook
   ↓
3. Orchestrator prepares isolated workspace (git clone)
   ↓
4. Cursor Headless generates code ← AI #1 (Code Writer)
   cursor --headless --dir /workspace --apply "ticket prompt"
   ↓
5. Automated QA Pipeline (ESLint, Jest, Coverage)
   ↓
6. Code pushed to GitHub → PR created
   ↓
7. pr-agent reviews PR ← AI #2 (Code Reviewer)
   ↓
8. pr-agent posts review comments, scores, suggestions
   ↓
9. Lead QA or PM reviews and approves
   ↓
10. CI/CD deploys to production
```

**Key Insight**: pr-agent operates **AFTER** Cursor Headless code generation, not instead of it.

**Architecture Change (Nov 25, 2025)**: We now use **Cursor CLI headless mode** instead of custom AI API integration. This provides full Cursor power (repository context, multi-file editing, semantic understanding) via official CLI.

---

## Phase Rollout

### Phase 1: MVP (Months 1-3)

**Status**: Optional, manual trigger

- pr-agent is **not critical** for Phase 1 MVP validation
- Focus on: Orchestrator → AI Code Gen → GitHub automation
- pr-agent can be manually triggered by PMs for specific PRs

**Configuration**:
```bash
# Manual PR review trigger
cd /path/to/pr-agent
python pr_agent/cli.py --pr_url="https://github.com/org/repo/pull/123" review
```

### Phase 2: Scale (Months 4-9)

**Status**: Automated secondary review

- Integrate pr-agent as **automated AI #2 reviewer**
- Triggered automatically after orchestrator creates GitHub PR (after Cursor Headless generation)
- Acts as peer review layer before human QA

**Integration Approach**:
```typescript
// In Dark Software Factory Orchestrator
async function handleCursorCodeGeneration(ticket: Ticket, workspace: string) {
  // 1. Execute Cursor headless
  await execAsync(`cursor --headless --dir "${workspace}" --apply "${ticket.prompt}"`);
  
  // 2. Collect changes via git diff
  const changes = await getGitDiff(workspace);
  
  // 3. Create GitHub PR
  const pr = await github.createPR({
    title: ticket.title,
    body: ticket.description,
    head: `feature/ticket-${ticket.id}`,
    base: 'main',
  });

  // 4. Trigger pr-agent review (Phase 2) ← AI #2
  await triggerPRAgentReview(pr.url);
  
  // 5. Wait for pr-agent feedback
  const review = await waitForPRAgentReview(pr.number);
  
  // 6. Route to human QA if needed
  if (review.score < 70) {
    await escalateToLeadQA(pr, review);
  }
}
```

### Phase 3: Transform (Months 10-21)

**Status**: Multi-layer AI review

- AI #1 (Cursor Headless) writes code with full repo context
- AI #2 (pr-agent) reviews code for quality, security, best practices
- AI #3 (optional) verifies tests pass and coverage
- Human QA does statistical sampling (20%)

---

## pr-agent Capabilities

### What pr-agent Provides

| Feature | Description | Value to Dark Factory |
|---------|-------------|----------------------|
| **PR Review** | Automated code review with feedback | Catch issues before human review |
| **Code Scoring** | 0-100 quality score | Filter low-quality AI output |
| **Effort Estimation** | Predict PR complexity | Help PMs prioritize reviews |
| **Best Practices** | Enforce team standards | Consistency across AI-generated code |
| **PR Chat** | Ask questions about PR | Help PMs understand AI decisions |

### Configuration

pr-agent uses `.pr_agent.toml` files for per-repo configuration:

```toml
# /path/to/client-project/.pr_agent.toml
[pr_reviewer]
num_code_suggestions = 5
require_score_review = true
require_tests_review = true
require_security_review = true

[pr_code_suggestions]
num_code_suggestions = 3

[config]
model = "gpt-4-turbo-preview"
```

---

## Customization Opportunities

### Fork Customizations (Future)

The pr-agent fork can be customized for Dark Software Factory needs:

1. **Custom Scoring Model**: Train on historical "good" vs "bad" AI-generated code
2. **Dark Factory Rules**: Add custom linting rules specific to AI code patterns
3. **Integration Hooks**: Direct webhook integration with orchestrator
4. **Cost Tracking**: Embed cost metadata in PR reviews
5. **Ticket Traceability**: Link PR reviews back to ClickUp tickets

**Note**: Phase 1 uses pr-agent as-is. Customizations deferred to Phase 2-3.

---

## Cost Considerations

### pr-agent API Costs

pr-agent itself uses OpenAI GPT-4 for reviews, which adds to AI budget:

- **Estimated cost per PR review**: $0.10 - $0.50 (depending on PR size)
- **Monthly cost estimate** (20 projects, 100 PRs/month): $10 - $50/month
- **Compared to orchestrator AI costs**: Minimal (~5% of total AI spend)

**Recommendation**: Include pr-agent costs in overall AI budget tracking.

---

## Alternative Approaches

If pr-agent doesn't meet needs, alternatives for AI #2 review:

| Alternative | Pros | Cons |
|-------------|------|------|
| **Custom AI Review** | Full control, tailored to needs | Build from scratch, maintenance burden |
| **GitHub Copilot for Businesses** | Native GitHub integration | Expensive, limited customization |
| **SonarQube + AI** | Strong security/quality focus | Not AI-native, requires integration |
| **No AI #2** | Lower cost, simpler architecture | Higher risk of low-quality code reaching production |

**Recommendation**: Stick with pr-agent for Phase 1-2, reevaluate in Phase 3.

---

## Success Metrics

### How to Measure pr-agent Value

Track these metrics to validate pr-agent's contribution:

1. **Bug Catch Rate**: % of bugs caught by pr-agent vs. human QA
2. **False Positive Rate**: % of pr-agent flags that are incorrect
3. **Time Savings**: Reduction in Lead QA review time
4. **Quality Improvement**: Correlation between pr-agent score and production bugs

**Phase 1 Goal**: Establish baseline metrics (manual pr-agent runs)  
**Phase 2 Goal**: Demonstrate 20%+ time savings in QA review  
**Phase 3 Goal**: Automate 80% of code reviews (only 20% human sampling)

---

## Implementation Checklist

### Phase 1 (Optional)
- [ ] Document pr-agent as "secondary reviewer" in all architecture docs
- [ ] Set up pr-agent in test repository
- [ ] Create `.pr_agent.toml` configuration template
- [ ] Train 2-3 PMs on manual pr-agent usage
- [ ] Run pr-agent on 5 pilot PRs (manual)
- [ ] Collect feedback and metrics

### Phase 2 (Automated)
- [ ] Build orchestrator → pr-agent webhook integration
- [ ] Implement automatic PR review trigger
- [ ] Create pr-agent review dashboard in AetherFlow
- [ ] Define escalation rules (score thresholds)
- [ ] Measure time savings vs. Phase 1

### Phase 3 (Multi-layer)
- [ ] Implement AI #3 test verification layer
- [ ] Optimize pr-agent configuration based on historical data
- [ ] Consider custom scoring model training
- [ ] Achieve 80% automated review rate

---

## Key Takeaways

1. ✅ **pr-agent = AI #2** (secondary reviewer, not primary code generator)
2. ✅ **Cursor Headless = AI #1** (primary code generator with full repo context)
3. ✅ **Phase 1**: pr-agent optional, manual trigger only
4. ✅ **Phase 2**: pr-agent automated secondary review layer
5. ✅ **Integration**: Orchestrator → Cursor Headless → GitHub PR → pr-agent → Human QA
6. ✅ **Architecture**: Uses official Cursor CLI `--headless` mode (not custom APIs)

---

## Related Documents

- [Architecture Document](./architecture.md) - Overall system design with Cursor Headless integration
- [PRD](./prd.md) - Functional requirements for quality review (FR34-43)
- Cursor CLI Docs: https://cursor.com/docs/cli/overview

## Architecture Update (Nov 25, 2025)

**Critical Change:** We are now using **Cursor's official CLI with `--headless` mode** for AI code generation instead of attempting to build custom AI API integrations.

**Why This Matters:**
- ✅ Cursor CLI provides official, documented automation support
- ✅ Full repository context automatically handled
- ✅ Multi-file editing with semantic understanding
- ✅ Purpose-built for CI/CD and server-side automation
- ✅ No need to build AI capabilities from scratch
- ✅ Scales to 50+ concurrent projects (Phase 3 goal)

**Integration Command:**
```bash
cursor --headless \
  --dir /workspaces/project-repo \
  --apply "Ticket description with acceptance criteria" \
  --wait
```

This provides the full power of Cursor AI (which uses Claude/GPT-4 under the hood) with all the repository context, codebase understanding, and multi-file editing capabilities - without building custom AI integration.
