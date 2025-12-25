# Story 6.7: Cost Optimization Recommendations - Implementation Playbook

**Epic:** 6 - Cost Tracking & Budget Monitoring  
**Priority:** Phase 1 (Business Value)  
**Effort Reduction:** ~50% (1 week → 3-4 days)  
**Status:** Ready for implementation when Epic 6 becomes active

---

## Overview

### Original Approach (Don't Do This)

❌ Build ML model or rule-based recommendation engine  
❌ Implement pattern detection algorithms  
❌ Create provider performance comparison logic  
❌ Build opportunity cost calculators  
❌ ~300 lines of complex analysis code

### Delegation Approach (Do This Instead)

✅ AI analyzes cost patterns and generates recommendations  
✅ Orchestrator aggregates cost data for AI  
✅ UI displays recommendations with apply/dismiss actions  
✅ ~80 lines of data prep + UI logic

**Key Insight:** Pattern analysis = AI's strength, not ours!

---

## Implementation Steps

### Step 0: Prerequisites (COMPLETED)

**Component:** Cost Dashboard API (Story 13.5)
The foundational data extraction APIs are now implemented, providing the following critical data points for analysis:

- Aggregated costs by provider/model (Cost Summary API)
- Detailed per-ticket execution context (Ticket Cost API)
- Grouped breakdown with pagination/filtering (Breakdown API)

These endpoints serve as the "Data Layer" for the optimization engine.

### Step 1: Create Optimization Interfaces

**File:** `src/modules/cost-tracking/interfaces/optimization.interface.ts`

```typescript
export interface CostOptimizationTask {
  type: 'cost-optimization-analysis';
  instructions: string;
  context: {
    costRecords: CostDataSummary;
    providerPricing: ProviderPricingInfo;
    executionMetrics: ExecutionMetricsSummary;
    period: { start: Date; end: Date };
  };
}

export interface CostDataSummary {
  totalSpend: number; // Total cost in cents
  spendByProvider: Record<string, number>; // Provider → cost
  spendByTaskType: Record<string, number>; // Task type → cost
  spendByPM: Record<string, number>; // PM → cost
  ticketCount: number;
  avgCostPerTicket: number;
  failedExecutionCost: number; // Wasted on failures
}

export interface ProviderPricingInfo {
  cursor: {
    type: 'fixed_monthly';
    monthlyCost: number; // e.g., $2500
    estimatedTicketsPerMonth: number;
  };
  claude: {
    type: 'pay_per_use';
    inputTokenCost: number; // e.g., $3 per 1M tokens
    outputTokenCost: number; // e.g., $15 per 1M tokens
    avgTokensPerTicket: number;
  };
}

export interface ExecutionMetricsSummary {
  providerSuccessRates: Record<string, number>; // Provider → %
  avgExecutionTime: Record<string, number>; // Provider → seconds
  fallbackUsageRate: number; // % using fallback
  ticketComplexityDistribution: {
    simple: number;
    moderate: number;
    complex: number;
  };
}

export interface CostOptimizationRecommendation {
  id: string;
  title: string;
  category: 'ROUTING' | 'TICKET_QUALITY' | 'PROCESS' | 'INFRASTRUCTURE';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedSavings: {
    monthly: number; // Dollars per month
    annual: number;
    percentage: number; // % of current spend
  };
  description: string;
  reasoning: string; // Why this saves money
  implementation: {
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    estimatedEffort: string; // e.g., "2 days"
    steps: string[]; // How to implement
  };
  risks: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    description: string;
  };
  metrics: {
    currentState: string;
    targetState: string;
    successCriteria: string;
  };
  status: 'PENDING' | 'APPROVED' | 'IMPLEMENTED' | ' DISMISSED';
  aiConfidence: number; // 0-100
}
```

---

### Step 2: Create Cost Analysis Service

**File:** `src/modules/cost-tracking/services/cost-optimization.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { AIProviderService } from '@/modules/ai-routing/services/ai-provider.service';
import { CostRepository } from '../repositories/cost.repository';
import { CostOptimizationRecommendation } from '../interfaces/optimization.interface';

@Injectable()
export class CostOptimizationService {
  constructor(
    private readonly aiProvider: AIProviderService,
    private readonly costRepo: CostRepository,
  ) {}

  async generateOptimizationRecommendations(
    periodDays: number = 30,
  ): Promise<CostOptimizationRecommendation[]> {
    // 1. Aggregate cost data for AI analysis
    const costData = await this.aggregateCostData(periodDays);

    // 2. Get provider pricing info
    const pricing = this.getProviderPricing();

    // 3. Get execution metrics
    const metrics = await this.getExecutionMetrics(periodDays);

    // 4. Delegate analysis to AI
    const analysisTask = {
      type: 'cost-optimization-analysis',
      instructions: this.buildOptimizationPrompt(costData, pricing, metrics),
      context: { costData, pricing, metrics },
    };

    const result = await this.aiProvider.execute(analysisTask);
    return this.parseRecommendations(result.output);
  }

  private buildOptimizationPrompt(costData: any, pricing: any, metrics: any): string {
    return `
Analyze our AI compute costs and generate optimization recommendations.

**Current Spending (Last 30 Days):**
- Total spend: $${(costData.totalSpend / 100).toFixed(2)}
- Tickets processed: ${costData.ticketCount}
- Avg cost per ticket: $${(costData.avgCostPerTicket / 100).toFixed(2)}
- Failed execution waste: $${(costData.failedExecutionCost / 100).toFixed(2)}

**Spending by AI Provider:**
${Object.entries(costData.spendByProvider)
  .map(
    ([provider, cost]: [string, any]) =>
      `- ${provider}: $${(cost / 100).toFixed(2)} (${((cost / costData.totalSpend) * 100).toFixed(1)}%)`,
  )
  .join('\n')}

**Provider Performance:**
${Object.entries(metrics.providerSuccessRates)
  .map(
    ([provider, rate]: [string, any]) =>
      `- ${provider}: ${rate.toFixed(1)}% success rate, ${metrics.avgExecutionTime[provider]}s avg time`,
  )
  .join('\n')}

**Provider Pricing Models:**
- Cursor CLI: Fixed $${(pricing.cursor.monthlyCost / 100).toFixed(0)}/month
  (Est. ${pricing.cursor.estimatedTicketsPerMonth} tickets → $${(pricing.cursor.monthlyCost / pricing.cursor.estimatedTicketsPerMonth / 100).toFixed(2)}/ticket)
- Claude Code: $${pricing.claude.inputTokenCost}/1M input tokens, $${pricing.claude.outputTokenCost}/1M output tokens
  (Avg ${pricing.claude.avgTokensPerTicket} tokens/ticket → $${((pricing.claude.avgTokensPerTicket * pricing.claude.outputTokenCost) / 1000000 / 100).toFixed(2)}/ticket)

**Ticket Complexity:**
- Simple: ${metrics.ticketComplexityDistribution.simple} tickets
- Moderate: ${metrics.ticketComplexityDistribution.moderate} tickets
- Complex: ${metrics.ticketComplexityDistribution.complex} tickets

**Task:**
Generate 3-5 cost optimization recommendations prioritized by ROI. For each:

1. **Title:** Brief, actionable recommendation
2. **Category:** ROUTING / TICKET_QUALITY / PROCESS / INFRASTRUCTURE
3. **Priority:** Based on savings magnitude and ease
4. **Estimated Savings:**
   - monthly: dollars saved per month
   - annual: monthly × 12
   - percentage: % of current spend
5. **Description:** What should be done
6. **Reasoning:** Why this saves money with data/evidence
7. **Implementation:**
   - difficulty: EASY/MEDIUM/HARD
   - estimatedEffort: "X days"
   - steps: ["1. ...", "2. ..."]
8. **Risks:**
   - level: LOW/MEDIUM/HIGH
   - description: what could go wrong
9. **Metrics:**
   - currentState: current performance
   - targetState: expected after implementation
   - successCriteria: how to measure success
10. **aiConfidence:** 0-100 (how certain are you?)

**Focus Areas:**
- Should we route more/fewer tickets to Claude Code vs. Cursor?
- Are ticket quality improvements reducing retry costs?
- Can we batch similar tickets to reduce overhead?
- Are failed executions indicating routing issues?
- Infrastructure optimizations (caching, etc.)

Return JSON array of recommendations, ordered by priority.
    `.trim();
  }

  private parseRecommendations(aiOutput: string): CostOptimizationRecommendation[] {
    try {
      const parsed = JSON.parse(aiOutput);
      const recommendations = Array.isArray(parsed) ? parsed : parsed.recommendations || [];

      return recommendations.map((rec, idx) => ({
        id: `opt-${Date.now()}-${idx}`,
        title: rec.title || 'Untitled Recommendation',
        category: rec.category || 'PROCESS',
        priority: rec.priority || 'MEDIUM',
        estimatedSavings: {
          monthly: rec.estimatedSavings?.monthly || 0,
          annual: rec.estimatedSavings?.annual || (rec.estimatedSavings?.monthly || 0) * 12,
          percentage: rec.estimatedSavings?.percentage || 0,
        },
        description: rec.description || '',
        reasoning: rec.reasoning || '',
        implementation: {
          difficulty: rec.implementation?.difficulty || 'MEDIUM',
          estimatedEffort: rec.implementation?.estimatedEffort || 'Unknown',
          steps: Array.isArray(rec.implementation?.steps) ? rec.implementation.steps : [],
        },
        risks: {
          level: rec.risks?.level || 'MEDIUM',
          description: rec.risks?.description || 'Unknown risks',
        },
        metrics: rec.metrics || {
          currentState: 'Unknown',
          targetState: 'Unknown',
          successCriteria: 'To be defined',
        },
        status: 'PENDING',
        aiConfidence: rec.aiConfidence || 70,
      }));
    } catch (error) {
      throw new Error(`Failed to parse optimization recommendations: ${error.message}`);
    }
  }

  private async aggregateCostData(days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.costRepo.aggregateCosts(startDate, new Date());
  }

  private async getExecutionMetrics(days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.costRepo.getExecutionMetrics(startDate, new Date());
  }

  private getProviderPricing() {
    // This would come from config/database
    return {
      cursor: {
        type: 'fixed_monthly',
        monthlyCost: 250000, // $2500 in cents
        estimatedTicketsPerMonth: 100,
      },
      claude: {
        type: 'pay_per_use',
        inputTokenCost: 3,
        outputTokenCost: 15,
        avgTokensPerTicket: 50000,
      },
    };
  }
}
```

---

### Step 3: Store Recommendations

**File:** `prisma/schema.prisma`

```prisma
model CostOptimizationRecommendation {
  id        String   @id @default(cuid())

  // Recommendation Content
  title       String
  category    RecommendationCategory
  priority    RecommendationPriority
  description String   @db.Text
  reasoning   String   @db.Text

  // Savings Estimates (in cents)
  monthlySavings     Int
  annualSavings      Int
  savingsPercentage  Float

  // Implementation Details
  difficulty         ImplementationDifficulty
  estimatedEffort    String
  implementationSteps String[] // JSON array

  // Risks
  riskLevel          RiskLevel
  riskDescription    String   @db.Text

  // Metrics (stored as JSON)
  metrics            Json

  // Status Tracking
  status             RecommendationStatus @default(PENDING)
  aiConfidence       Int                  // 0-100

  // Manager Actions
  approvedBy         String?
  approvedAt         DateTime?
  dismissedBy        String?
  dismissedAt        DateTime?
  dismissReason      String?  @db.Text
  implementedAt      DateTime?
  implementationNotes String? @db.Text

  // Timestamps
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([status])
  @@index([priority])
  @@index([createdAt])
}

enum RecommendationCategory {
  ROUTING
  TICKET_QUALITY
  PROCESS
  INFRASTRUCTURE
}

enum RecommendationPriority {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum ImplementationDifficulty {
  EASY
  MEDIUM
  HARD
}

enum RiskLevel {
  LOW
  MEDIUM
  HIGH
}

enum RecommendationStatus {
  PENDING
  APPROVED
  IMPLEMENTED
  DISMISSED
}
```

---

### Step 4: Create API Endpoints

**File:** `src/modules/cost-tracking/controllers/optimization.controller.ts`

```typescript
import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { CostOptimizationService } from '../services/cost-optimization.service';
import { RecommendationRepository } from '../repositories/recommendation.repository';

@Controller('api/v1/cost/optimization')
export class OptimizationController {
  constructor(
    private readonly optimizationService: CostOptimizationService,
    private readonly recommendationRepo: RecommendationRepository,
  ) {}

  @Post('analyze')
  async generateRecommendations(@Body() dto: { periodDays?: number }) {
    const recommendations = await this.optimizationService.generateOptimizationRecommendations(
      dto.periodDays || 30,
    );

    // Store in database
    await this.recommendationRepo.createMany(recommendations);

    return {
      count: recommendations.length,
      totalPotentialSavings: recommendations.reduce(
        (sum, rec) => sum + rec.estimatedSavings.monthly,
        0,
      ),
      recommendations,
    };
  }

  @Get('recommendations')
  async getRecommendations(@Query('status') status?: string) {
    return this.recommendationRepo.findAll({ status });
  }

  @Patch('recommendations/:id/approve')
  async approveRecommendation(@Param('id') id: string, @Body() dto: { approvedBy: string }) {
    return this.recommendationRepo.approve(id, dto.approvedBy);
  }

  @Patch('recommendations/:id/dismiss')
  async dismissRecommendation(
    @Param('id') id: string,
    @Body() dto: { dismissedBy: string; reason: string },
  ) {
    return this.recommendationRepo.dismiss(id, dto.dismissedBy, dto.reason);
  }

  @Patch('recommendations/:id/implement')
  async markImplemented(@Param('id') id: string, @Body() dto: { notes: string }) {
    return this.recommendationRepo.markImplemented(id, dto.notes);
  }
}
```

---

## Frontend: Cost Optimization Dashboard

**Component:** `OptimizationDashboard.tsx`

```typescript
export function OptimizationDashboard() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  const generateRecommendations = async () => {
    setLoading(true);
    const response = await fetch('/api/v1/cost/optimization/analyze', {
      method: 'POST',
      body: JSON.stringify({ periodDays: 30 })
    });
    const data = await response.json();
    setRecommendations(data.recommendations);
    setLoading(false);
  };

  return (
    <div>
      <Header>
        <h1>Cost Optimization</h1>
        <Button onClick={generateRecommendations} loading={loading}>
          Generate Recommendations
        </Button>
      </Header>

      <MetricsSummary>
        <Metric
          label="Total Potential Savings"
          value={`$${totalMonthlySavings}/mo`}
        />
        <Metric
          label="Recommendations"
          value={recommendations.length}
        />
      </MetricsSummary>

      <RecommendationList>
        {recommendations.map(rec => (
          <RecommendationCard
            key={rec.id}
            recommendation={rec}
            onApprove={() => handleApprove(rec.id)}
            onDismiss={(reason) => handleDismiss(rec.id, reason)}
          />
        ))}
      </RecommendationList>
    </div>
  );
}

function RecommendationCard({ recommendation, onApprove, onDismiss }) {
  return (
    <Card priority={recommendation.priority}>
      <CardHeader>
        <h3>{recommendation.title}</h3>
        <Badge>{recommendation.category}</Badge>
        <SavingsBadge>
          ${recommendation.estimatedSavings.monthly}/mo
        </SavingsBadge>
      </CardHeader>

      <CardContent>
        <p>{recommendation.description}</p>

        <Section title="Why This Saves Money">
          {recommendation.reasoning}
        </Section>

        <Section title="Implementation">
          <Difficulty level={recommendation.implementation.difficulty} />
          <p>Estimated effort: {recommendation.implementation.estimatedEffort}</p>
          <ol>
            {recommendation.implementation.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </Section>

        <Section title="Risks">
          <RiskBadge level={recommendation.risks.level} />
          <p>{recommendation.risks.description}</p>
        </Section>

        <Section title="Success Metrics">
          <MetricRow
            label="Current"
            value={recommendation.metrics.currentState}
          />
          <MetricRow
            label="Target"
            value={recommendation.metrics.targetState}
          />
          <MetricRow
            label="Measure"
            value={recommendation.metrics.successCriteria}
          />
        </Section>
      </CardContent>

      <CardActions>
        <Button variant="primary" onClick={onApprove}>
          Approve & Schedule
        </Button>
        <Button variant="secondary" onClick={() => onDismiss('Not applicable')}>
          Dismiss
        </Button>
      </CardActions>
    </Card>
  );
}
```

---

## What We Didn't Build (Effort Saved)

### ❌ ML Model (~2-3 days)

```python
# DON'T NEED THIS
class CostOptimizationML:
    def train_model(self, historical_data):
        # Feature engineering
        # Model training (regression, clustering)
        # Hyperparameter tuning
        pass

    def predict_savings(self, scenario):
        # Model inference
        # Confidence intervals
        pass
```

### ❌ Rule-Based Engine (~2 days)

```typescript
// DON'T NEED THIS
class RuleBasedOptimizer {
  rules: OptimizationRule[] = [
    {
      condition: (data) => data.claudeUsage < 20,
      recommendation: 'Increase Claude usage for simple tasks',
    },
    // ... 50+ rules
  ];

  evaluate(costData: CostData): Recommendation[] {
    // Complex rule evaluation logic
    // Priority scoring
    // Conflict resolution
  }
}
```

**Total Saved:** ~3-4 days of ML/rules development

---

## Success Metrics

- **Recommendation Quality:** % of recommendations approved by managers (target: >60%)
- **Savings Realized:** Actual savings vs. estimated 3 months post-implementation
- **Implementation Rate:** % of approved recommendations implemented
- **ROI Accuracy:** How close estimates were to actual savings

---

## Phase 1 Checklist

- [ ] Optimization interfaces defined
- [ ] Cost analysis service with AI delegation
- [ ] Database schema for recommendations
- [ ] Repository with CRUD operations
- [ ] API endpoints (generate, approve, dismiss)
- [ ] Manager dashboard with recommendation cards
- [ ] One-click approve/dismiss actions
- [ ] Success metrics tracked
- [ ] Unit tests for parser
- [ ] Integration test with AI provider
- [ ] Documentation updated

---

**Status:** Ready for implementation when Epic 6 becomes active!  
**Estimated Effort:** 3-4 days (vs. original 1 week)  
**ROI:** 50% time savings + AI discovers patterns humans might miss
