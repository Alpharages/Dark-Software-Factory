# ADR-008: AI Delegation Pattern for Code Generation and Tool Execution

**Status:** Accepted  
**Date:** 2025-12-08  
**Context:** Epic 4 Development, Epic 3 Retrospective  
**Decision Makers:** Development Team, Technical Lead

---

## Context

### The Problem

During Epic 3 (QA Automation & Quality Gates), we built approximately **2,000 lines of custom service code** to handle tasks like linting, test execution, coverage analysis, and security scanning. This approach resulted in:

- **High maintenance burden:** Each linter, test framework, and language required custom parsers and adapters
- **Language-specific implementations:** Separate services for Node.js, Python, Ruby, etc.
- **Fragile parsing logic:** Complex regex patterns to parse tool outputs (ESLint, Pytest, Jest)
- **Duplicated effort:** Rebuilding functionality that client projects already have via `npm scripts`
- **Poor scalability:** Adding support for new tools required significant code changes

**Epic 3 Example:**
```typescript
class LintingService {
  async lint(ticketId: string): Promise<LintResult> {
    // 1. Detect linter (ESLint vs Flake8 vs RuboCop)
    // 2. Execute linter command (exec)
    // 3. Parse output with custom regex (fragile)
    // 4. Transform to internal format
    // Total: ~500 LOC
  }
}
```

### The Discovery

In Epic 4 (GitHub Integration & Deployment), we experimented with **delegating tasks to AI agents** instead of building custom services. The results were transformative:

**Epic 4 Success:**
- **50% reduction in development time** compared to Epic 3 (similar complexity)
- **90% reduction in code** (~200 LOC vs ~2,000 LOC)
- **Zero language-specific code** - AI adapts to any tech stack
- **Automatic tool support** - AI handles new tools without code changes

**Epic 4 Example (Story 4.3 - Commit Message Generation):**
```typescript
class GitHubCommitOrchestrator {
  async generateCommitMessage(diff: string): Promise<string> {
    const prompt = `Generate conventional commit message for: ${diff}`;
    const result = await this.orchestratorService.executeTask(prompt);
    return result.output; // AI returns formatted message
    // Total: ~30 LOC
  }
}
```

### The Realization

**AI agents can already do three things we didn't realize:**

1. **Execute commands** - Run shell commands, git operations, npm scripts
2. **Parse outputs** - Read and interpret command results (better than regex)
3. **Format results** - Return structured JSON/data to our system

**This means:** For any task involving tool execution + parsing + formatting, we should **delegate to AI** rather than build custom services.

### References

- [Epic 3 Retrospective](../sprint-artifacts/epic-3-retrospective.md) - Over-engineering analysis
- [Epic 4 Retrospective](../sprint-artifacts/epic-4-retro-2025-12-08.md) - AI delegation success metrics
- [Story 4.3: Git Commit Generation](../sprint-artifacts/4-3-git-commit-generation-push.md) - First AI delegation example
- [Story 4.4: PR Creation](../sprint-artifacts/4-4-pull-request-creation-metadata.md) - AI delegation pattern
- [Story 3.10: QA Automation Refactor](../sprint-artifacts/3-10-qa-automation-ai-delegation-refactor.md) - Applying pattern to Epic 3

---

## Decision

**We will use AI delegation as the default pattern for:**

1. **CLI tool execution** (npm, git, linters, test runners, security scanners)
2. **Output parsing** (interpreting tool results, extracting structured data)
3. **Natural language processing** (summarization, analysis, generation)
4. **Format conversions** (transforming data between representations)

**We will NOT use AI delegation for:**

1. **Business logic** (quality gates, approval workflows, routing decisions)
2. **Data storage/retrieval** (database operations, state management)
3. **Observability** (metrics recording, audit logging, error tracking)
4. **System orchestration** (deciding WHEN to execute operations)

### Division of Responsibilities

**Dark Software Factory (DSF) Owns:**
- **Orchestration** - Decide WHEN to execute operations
- **Instruction** - Tell AI WHAT to execute and WHAT format to return
- **Storage** - Save AI's structured results to database
- **Decision** - Use business logic to decide pass/fail
- **Observability** - Record metrics, audit logs, error tracking

**AI Tool (Cursor/Claude/OpenAI) Owns:**
- **Execution** - Run shell commands, git operations, npm scripts
- **Parsing** - Read and interpret command outputs
- **Analysis** - Summarize results, identify patterns, categorize issues
- **Formatting** - Return structured JSON/data to DSF

### Implementation Pattern

```typescript
// AI Delegation Pattern Template
class FeatureOrchestrator {
  constructor(
    private orchestratorService: OrchestratorService, // AI execution
    private repository: Repository, // Database
    private metricsService: MetricsService, // Observability
  ) {}

  async executeFeature(context: Context): Promise<Result> {
    // 1. ORCHESTRATION: Decide to execute
    const shouldExecute = this.decideIfNeeded(context);
    
    // 2. INSTRUCTION: Prepare AI prompt
    const prompt = this.buildPrompt(context);
    
    // 3. EXECUTION: Delegate to AI
    const aiResult = await this.orchestratorService.executeTask(prompt);
    
    // 4. STORAGE: Save results
    await this.repository.save(aiResult);
    
    // 5. DECISION: Apply business logic
    const decision = this.applyBusinessRules(aiResult);
    
    // 6. OBSERVABILITY: Record metrics
    this.metricsService.record('feature_executed', decision);
    
    return decision;
  }
}
```

---

## Consequences

### Positive

1. **Dramatic code reduction:** 90% less code to write and maintain
2. **Universal tech stack support:** One implementation works for Node.js, Python, Ruby, Go, etc.
3. **Automatic tool adaptation:** AI handles new tools without code changes
4. **Better parsing:** AI understands context better than regex patterns
5. **Faster development:** 50% reduction in implementation time
6. **Leverage existing tooling:** Use client's `npm scripts` instead of rebuilding
7. **Natural language interfaces:** AI can handle unstructured inputs

### Negative

1. **AI API costs:** Increased token usage compared to custom code
   - **Mitigation:** Costs are negligible compared to developer time savings
   - **Example:** Epic 4 token costs ~$50/month vs ~$20,000/month developer time saved
2. **AI provider dependency:** Reliance on external AI service availability
   - **Mitigation:** Multi-provider fallback (Cursor → Claude → OpenAI)
   - **Mitigation:** 99%+ availability with provider redundancy
3. **Response time variability:** AI calls slower than direct code execution
   - **Mitigation:** Acceptable for async workflows (queue-based)
   - **Mitigation:** Not suitable for real-time request/response APIs

### Risks

1. **AI misinterpretation:** AI might misunderstand complex commands or outputs
   - **Mitigation:** Structured prompts with clear success criteria
   - **Mitigation:** Validation layer checks AI responses before storage
   - **Mitigation:** Audit logs track all AI responses for debugging

2. **Token cost explosion:** Unconstrained AI usage could increase costs significantly
   - **Mitigation:** Monitor token usage per ticket/project
   - **Mitigation:** Budget alerts and automatic cost caps (Epic 6)
   - **Mitigation:** Optimize prompts to minimize token usage

3. **Provider rate limits:** API rate limits could block execution
   - **Mitigation:** Multi-provider fallback with automatic switching
   - **Mitigation:** Exponential backoff with RabbitMQ delayed retries
   - **Mitigation:** Provider health monitoring and load balancing

4. **Lack of determinism:** AI responses may vary for identical inputs
   - **Mitigation:** Acceptable for tasks with binary outcomes (lint pass/fail)
   - **Mitigation:** Not suitable for cryptographic or financial calculations
   - **Mitigation:** Human review for critical decisions (approval workflows)

---

## Alternatives Considered

### Alternative 1: Custom Service Implementations (Rejected)

**Approach:** Continue Epic 3 pattern - build custom services for each tool/language.

**Pros:**
- Deterministic results
- No external dependencies
- No API costs

**Cons:**
- High maintenance burden (~2,000 LOC)
- Language-specific implementations required
- Fragile regex parsing
- Slow to add new tool support
- Duplicates client's existing tooling

**Rejection Reason:** Development and maintenance costs far exceed AI API costs. Epic 4 proved 50% time savings with AI delegation.

---

### Alternative 2: Hybrid Approach (Rejected)

**Approach:** Use custom services for simple tasks, AI delegation for complex tasks.

**Pros:**
- Optimize costs for simple operations
- Deterministic for basic tasks

**Cons:**
- Dual codebases to maintain (custom + AI)
- Complexity in deciding which approach to use
- Still requires custom parsers for "simple" cases
- Team confusion about which pattern to follow

**Rejection Reason:** Adds unnecessary complexity. Token costs are negligible, so optimizing for them is premature. Single pattern (AI delegation) simplifies codebase and team cognition.

---

### Alternative 3: Build Internal AI Service (Rejected)

**Approach:** Self-host open-source LLM (Llama, CodeLlama) instead of using commercial APIs.

**Pros:**
- No external API costs
- Full control over infrastructure
- Data privacy

**Cons:**
- Infrastructure complexity (GPU servers, model hosting)
- Performance and quality below commercial AI models
- DevOps burden (monitoring, scaling, updates)
- Not the team's core competency

**Rejection Reason:** Dark Software Factory's value is orchestration logic, not AI infrastructure. Use best-in-class AI providers and focus on building differentiated orchestration.

---

## Implementation Roadmap

### Phase 1: Document and Validate (Current)
- ✅ Create this ADR
- ⏳ Update architecture.md with delegation guidelines
- ⏳ Refactor Epic 3 QA Automation (Story 3.10)
- ⏳ Validate LOC reduction and time savings

### Phase 2: Expand to Epic 5-10
- Apply delegation pattern to PM Dashboard (Epic 5)
- Apply delegation pattern to Cost Monitoring (Epic 6)
- Apply delegation pattern to Architecture Review (Epic 7)
- 30-40% effort reduction expected across Epics 5-10

### Phase 3: Optimization
- Monitor token costs and optimize prompts
- Implement caching for repeated operations
- Build reusable prompt templates

---

## Metrics and Validation

**Epic 4 Results (Baseline):**
- Development time: **50% faster** than Epic 3 (similar complexity)
- Code volume: **90% reduction** (~200 LOC vs ~2,000 LOC)
- Tech stack coverage: **Universal** (works across Node.js, Python, Ruby, Go)
- Reliability: **99%+ availability** with multi-provider fallback
- Token costs: **$50/month** (negligible vs $20,000/month developer time saved)

**Epic 3 Refactor Predictions (Story 3.10):**
- Delete ~1,800 LOC of custom services
- Replace with ~180 LOC AI orchestrator
- Maintain identical functionality
- Eliminate language-specific code

**Epic 5-10 Projections:**
- Effort reduction: **30-40%** across all epics
- Story count reduction: **10-15%** (consolidate similar stories)
- Maintenance burden: **Minimal** (AI handles tool changes automatically)

---

## Related Documents

- [Architecture Overview](./architecture.md) - AI Delegation Pattern section
- [Epic 4 Retrospective](../sprint-artifacts/epic-4-retro-2025-12-08.md) - Success metrics
- [Story 3.10: QA Automation Refactor](../sprint-artifacts/3-10-qa-automation-ai-delegation-refactor.md) - Refactor plan
- [Epic 5-10 Delegation Strategy](./epic-5-10-delegation-strategy.md) - Future application
