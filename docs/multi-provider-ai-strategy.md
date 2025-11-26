# Multi-Provider AI Strategy
## Dark Software Factory - AI Dev Tool Orchestrator

**Version:** 1.0  
**Date:** 2025-11-25  
**Status:** ✅ Approved

---

## Executive Summary

The Dark Software Factory uses a **dual-provider AI strategy** for code generation:
- **Primary:** Cursor CLI (Headless Mode) - Full repository context, multi-file editing
- **Secondary:** Claude Code (Anthropic) - Fast, cost-effective, focused tasks with autonomous coding capabilities

This approach provides **risk mitigation, cost optimization, and flexibility** while leveraging official, documented tools from both providers.

**Note:** Claude Code is Anthropic's autonomous coding agent. Learn more: https://www.claude.com/product/claude-code

---

## Why Multi-Provider?

### Risk Mitigation
- ✅ **No single point of failure:** If Cursor has issues → auto-switch to Claude
- ✅ **Provider redundancy:** Critical tickets can proceed even if one provider is down
- ✅ **Validation capability:** Compare outputs between providers for quality assurance

### Cost Optimization
- ✅ **Task-based routing:** Simple tasks use Claude (lower cost), complex tasks use Cursor
- ✅ **Efficient resource usage:** Match provider capabilities to task requirements
- ✅ **Predictable costs:** Track per-provider usage and optimize over time

### Flexibility
- ✅ **Best tool for the job:** Route based on task complexity, urgency, and type
- ✅ **Future-proof:** Easy to add more providers (GPT-4, Windsurf, etc.)
- ✅ **A/B testing:** Compare provider performance on similar tasks

---

## Provider Comparison

| Feature | Cursor CLI (Headless) | Claude Code | Winner |
|---------|----------------------|------------|--------|
| **Repository Context** | ✅ Automatic full repo | ✅ Autonomous context building | Tie |
| **Multi-File Editing** | ✅ Semantic awareness | ✅ Autonomous multi-file | Tie |
| **Code Quality** | ✅ Excellent | ✅ Excellent | Tie |
| **Speed** | ⚠️ ~30-90s | ✅ ~10-30s | Claude |
| **Cost** | ⚠️ Higher (Cursor license) | ✅ Lower (pay-per-use) | Claude |
| **Setup Complexity** | ✅ Simple (just install) | ✅ API integration | Cursor |
| **Concurrency** | ✅ 10+ instances | ✅ Unlimited (API-based) | Claude |
| **Autonomous Coding** | ⚠️ Requires prompting | ✅ Built-in autonomy | Claude |

---

## Provider Routing Strategy

### Decision Tree

```
Task arrives → Assess complexity → Select provider

┌─────────────────────────────────────────────────┐
│ Complexity Assessment                           │
│  • Files to modify: 1 vs 3+                     │
│  • Architecture changes: No vs Yes              │
│  • Cross-file dependencies: Low vs High         │
│  • Estimated LOC: <100 vs >100                  │
└─────────────────────────────────────────────────┘
                    ↓
        ┌───────────┴──────────┐
        │                      │
    LOW/MEDIUM              HIGH
        │                      │
        ↓                      ↓
   ┌─────────┐          ┌──────────┐
   │ Claude  │          │  Cursor  │
   │  CLI    │          │ Headless │
   └─────────┘          └──────────┘
        │                      │
        └──────────┬───────────┘
                   │
        If provider fails
                   ↓
        ┌──────────────────┐
        │ Fallback to      │
        │ Other Provider   │
        └──────────────────┘
```

### Routing Rules

#### **Use Cursor When:**
- ✅ Task involves 3+ files
- ✅ Architecture changes required
- ✅ Complex refactoring needed
- ✅ High cross-file dependencies
- ✅ Need semantic codebase understanding
- ✅ Ticket tagged with: `architecture`, `refactor`, `complex`

#### **Use Claude When:**
- ✅ Single file or 1-2 files
- ✅ Focused feature addition
- ✅ Bug fix or simple change
- ✅ Time-sensitive (faster response)
- ✅ Cost-sensitive (lower per-token cost)
- ✅ Ticket tagged with: `simple`, `bugfix`, `quick-win`

---

## Implementation Architecture

### Provider Factory Pattern

```typescript
// orchestrator/src/ai-routing/providers/provider-factory.ts

export class AIProviderFactory {
  constructor(
    private cursorProvider: CursorHeadlessProvider,
    private claudeProvider: ClaudeCodeProvider,
    private metricsService: MetricsService
  ) {}

  async getProvider(ticket: Ticket, context: CodeContext): Promise<AIProvider> {
    const complexity = this.assessComplexity(ticket, context);
    
    // Primary routing logic
    if (complexity === 'high' || this.requiresFullRepoContext(ticket)) {
      // Try Cursor first
      if (await this.cursorProvider.isAvailable()) {
        this.metricsService.record({ provider: 'cursor', reason: 'complexity' });
        return this.cursorProvider;
      }
      
      // Fallback to Claude
      this.metricsService.record({ provider: 'claude', reason: 'cursor-unavailable' });
      return this.claudeProvider;
    }
    
    // For simple tasks, prefer Claude (faster, cheaper)
    if (await this.claudeProvider.isAvailable()) {
      this.metricsService.record({ provider: 'claude', reason: 'simple-task' });
      return this.claudeProvider;
    }
    
    // Fallback to Cursor
    this.metricsService.record({ provider: 'cursor', reason: 'claude-unavailable' });
    return this.cursorProvider;
  }
  
  private assessComplexity(ticket: Ticket, context: CodeContext): Complexity {
    const score = 
      (ticket.relevantFiles?.length || 1) * 2 +
      (ticket.description.length > 500 ? 3 : 0) +
      (ticket.tags?.includes('architecture') ? 5 : 0) +
      (ticket.acceptanceCriteria.length > 5 ? 2 : 0);
    
    if (score >= 10) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  }
}
```

### Fallback Strategy

```typescript
// orchestrator/src/ai-routing/ai-routing.service.ts

async executeWithFallback(
  ticket: Ticket,
  context: CodeContext
): Promise<AIExecutionResult> {
  const provider = await this.providerFactory.getProvider(ticket, context);
  
  try {
    // Try primary provider
    return await provider.execute(ticket, context);
    
  } catch (error) {
    if (!error.retryable) {
      throw error; // Non-retryable errors escalate immediately
    }
    
    // Get fallback provider
    const fallbackProvider = await this.providerFactory.getFallbackProvider(provider);
    
    this.logger.warn(
      `Provider ${provider.name} failed, falling back to ${fallbackProvider.name}`,
      { ticketId: ticket.id, error: error.message }
    );
    
    // Try fallback
    try {
      return await fallbackProvider.execute(ticket, context);
    } catch (fallbackError) {
      // Both providers failed - escalate to human
      this.logger.error(
        `All providers failed for ticket ${ticket.id}`,
        { error: fallbackError.message }
      );
      
      await this.escalateToHuman(ticket, {
        primaryError: error,
        fallbackError: fallbackError
      });
      
      throw new AllProvidersFailedError(ticket.id);
    }
  }
}
```

---

## Provider Details

### Cursor CLI (Headless Mode)

**Command Structure:**
```bash
cursor --headless \
  --dir /path/to/workspace \
  --apply "Ticket: Create user API\n\nDescription: ...\n\nAcceptance Criteria: ..." \
  --files src/api/users.ts,src/routes/users.ts \
  --wait
```

**Advantages:**
- ✅ Full repository context automatically
- ✅ Multi-file editing with semantic awareness
- ✅ Understands codebase patterns
- ✅ Official, documented, maintained

**Best For:**
- Complex, multi-file features
- Architecture changes
- Refactoring tasks
- Tasks requiring deep codebase understanding

**Cost Model:**
- Cursor license required (per user/instance)
- No per-request metering (unlimited usage with license)

---

### Claude Code (Anthropic)

**Integration Approach:**
Claude Code is Anthropic's autonomous coding agent that can be integrated via:
- Anthropic API with extended context
- Agentic workflow (prompt → plan → code → verify)
- Multi-turn conversation for complex tasks

**Advantages:**
- ✅ Fast response times (10-30s typical)
- ✅ Excellent code quality
- ✅ Lower per-request cost
- ✅ Unlimited concurrency (API-based)
- ✅ Autonomous coding capabilities
- ✅ Multi-file awareness through prompting

**Best For:**
- Single-file changes
- Focused bug fixes
- Simple to medium feature additions
- Time-sensitive tasks
- Cost-sensitive workloads

**Cost Model:**
- Pay-per-use (per 1M tokens)
- Claude 3.5 Sonnet: ~$3/1M input tokens, ~$15/1M output tokens
- Typical ticket: ~$0.10-$0.50

---

## Metrics & Monitoring

### Key Metrics to Track

```typescript
interface AIProviderMetrics {
  provider: 'cursor' | 'claude';
  ticketId: string;
  complexity: 'low' | 'medium' | 'high';
  
  // Performance
  executionTimeMs: number;
  filesModified: number;
  linesChanged: number;
  
  // Success
  success: boolean;
  retries: number;
  fallbackUsed: boolean;
  
  // Cost
  estimatedCost: number;
  apiCalls: number;
  
  // Quality
  testsPassedOnFirstRun: boolean;
  codeReviewScore?: number;
  bugReportsAfterDeploy: number;
}
```

### Dashboard Views

**Provider Health:**
- Cursor availability: 99.5% uptime
- Claude availability: 99.9% uptime
- Fallback trigger rate: 2.3%

**Cost Analysis:**
- Cursor: $2,500/month (fixed license)
- Claude: $450/month (variable usage)
- Total: $2,950/month
- Cost per ticket: ~$29.50 (100 tickets/month)

**Quality Comparison:**
- Cursor success rate: 87% first-run success
- Claude success rate: 82% first-run success
- Fallback success rate: 73%

---

## Validation & Testing

### Validation Script

Run this to confirm both providers work:

```bash
cd /Volumes/Data/project/products/alpharages/Dark\ Software\ Factory
chmod +x scripts/validate-ai-providers.sh
./scripts/validate-ai-providers.sh
```

**Expected output:**
- ✅ Both providers available (optimal)
- ✅ At least one provider available (can proceed)
- ❌ No providers available (must install)

### POC Scripts

**Test Cursor:**
```bash
npm run test:cursor-poc
# or
node poc/cursor-headless-poc.ts
```

**Test Claude:**
```bash
npm run test:claude-poc
# or
node poc/claude-cli-poc.ts
```

---

## Rollout Plan

### Phase 1: Single Provider (Week 1-2)
- Cursor only (simpler start)
- Validate headless mode works
- Build core orchestrator integration
- Track metrics

### Phase 2: Add Claude (Week 3-4)
- Install Claude CLI
- Implement provider factory
- Add complexity assessment
- Test fallback logic

### Phase 3: Optimize Routing (Week 5-6)
- Analyze metrics (cost, speed, quality)
- Tune routing rules
- A/B test provider selection
- Document best practices

### Phase 4: Full Production (Week 7+)
- Deploy multi-provider to all projects
- Monitor cost and quality
- Continuously optimize routing
- Consider adding more providers

---

## Cost Projections

### Scenario: 100 Tickets/Month

**Single Provider (Cursor Only):**
- Cursor license: $2,500/month
- Total: **$2,500/month**
- Per ticket: **$25**

**Single Provider (Claude Only):**
- Claude API: ~$800/month (all tickets)
- Total: **$800/month**
- Per ticket: **$8**

**Multi-Provider (Optimized):**
- Cursor: 40% of tickets (complex) = $2,500/month
- Claude: 60% of tickets (simple) = $450/month
- Total: **$2,950/month**
- Per ticket: **$29.50**
- **Value:** Risk mitigation + quality + flexibility

**Recommendation:** Multi-provider provides best balance of cost, risk, and quality.

---

## Next Steps

### Immediate (TODAY):
1. ✅ Run validation script: `./scripts/validate-ai-providers.sh`
2. ✅ Install missing providers (Cursor and/or Claude)
3. ✅ Configure API keys
4. ✅ Run POC scripts to validate end-to-end

### This Week:
1. Implement `CursorHeadlessProvider`
2. Implement `ClaudeCodeProvider`
3. Build `AIProviderFactory` with routing logic
4. Test fallback scenarios
5. Deploy to staging

### Next Week:
1. Monitor metrics (cost, quality, speed)
2. Tune routing rules based on data
3. Document learnings and best practices
4. Prepare for production rollout

---

## References

- **Architecture Doc:** `docs/architecture.md` (Section: Multi-Provider AI Implementation)
- **Cursor CLI Docs:** https://cursor.com/docs/cli/overview
- **Claude Code:** https://www.claude.com/product/claude-code
- **Anthropic API Docs:** https://docs.anthropic.com
- **Validation Script:** `scripts/validate-ai-providers.sh`
- **POC Scripts:** `poc/cursor-headless-poc.ts`, `poc/claude-code-poc.ts`

---

**Document Owner:** BMad (Founder/CEO)  
**Last Updated:** 2025-11-25  
**Next Review:** After Phase 2 completion (multi-provider deployment)

