# Story 7.1: ADR Generation - Implementation Playbook

**Epic:** 7 - TL Architecture Review Workflows  
**Priority:** Phase 1 (Highest ROI)  
**Effort Reduction:** ~80% (1 week → 1-2 days)  
**Status:** Ready for implementation when Epic 7 becomes active

---

## Overview

### Original Approach (Don't Do This)
❌ Build `ADRGenerationService` to parse AI's code output  
❌ Extract architecture decisions from comments/logs  
❌ Format decisions into ADR template  
❌ ~360 lines of parsing/extraction logic

### Delegation Approach (Do This Instead)
✅ Include ADR requirement in **every** code generation task  
✅ AI outputs structured ADRs directly during code generation  
✅ Orchestrator simply stores ADRs in database  
✅ ~20 lines of storage logic

**Key Insight:** Don't parse AI's decisions - ask AI to document them properly upfront!

---

## Implementation Steps

### Step 1: Update AI Task Interface

**File:** `src/modules/ai-routing/interfaces/ai-task.interface.ts`

```typescript
export interface CodeGenerationTask extends BaseAITask {
  type: AITaskType.CODE_GENERATION;
  instructions: string;
  context: {
    ticketId: string;
    ticketDescription: string;
    acceptanceCriteria: string[];
    // ... existing context
  };
  // NEW: ADR documentation requirement
  requireADRs: boolean; // default: true
}

export interface ADROutput {
  title: string;
  status: 'Proposed' | 'Accepted' | 'Superseded';
  context: string;
  decision: string;
  consequences: {
    positive: string[];
    negative: string[];
  };
  alternativesConsidered: string[];
  confidence: number; // 0-100
}

export interface CodeGenerationResult {
  code: string;
  filesChanged: string[];
  adrs?: ADROutput[]; // NEW: Optional ADRs array
}
```

---

### Step 2: Enhance Code Generation Prompts

**File:** `src/modules/ai-routing/services/prompt-generator.service.ts`

```typescript
export class PromptGeneratorService {
  generateCodeGenerationPrompt(task: CodeGenerationTask): string {
    const basePrompt = this.buildBasePrompt(task);
    
    // NEW: Add ADR documentation requirement
    if (task.requireADRs !== false) {
      return `
${basePrompt}

CRITICAL: Document Architecture Decisions
==========================================
For ANY significant architecture decision during implementation, create an ADR:

**Significant decisions include:**
- Adding new dependencies (npm packages, libraries)
- Choosing design patterns (Repository, Factory, Strategy, etc.)
- Infrastructure changes (new services, databases, queues)
- Security mechanisms (authentication, authorization, encryption)
- Performance optimizations (caching, indexing, query optimization)
- API contract changes (breaking changes, new endpoints)

**ADR Format (Michael Nygard Template):**
Return ADRs as JSON array in your response:

{
  "code": "... your generated code ...",
  "adrs": [
    {
      "title": "Use Redis for Session Storage",
      "status": "Proposed",
      "context": "Need fast session lookup for API requests. Current DB queries taking 50ms avg. Target <5ms response time.",
      "decision": "Implement Redis for session caching with 15-minute TTL. Fallback to database if Redis unavailable.",
      "consequences": {
        "positive": [
          "Sub-millisecond session lookups",
          "Reduced database load by ~80%",
          "Horizontal scaling support"
        ],
        "negative": [
          "Additional infrastructure dependency",
          "Cache invalidation complexity",
          "Memory constraints for large session data"
        ]
      },
      "alternativesConsidered": [
        "In-memory cache (doesn't scale horizontally)",
        "Database indexing only (still too slow)",
        "Memcached (Redis offers more data structures)"
      ],
      "confidence": 85
    }
  ]
}

**IMPORTANT:** 
- Only create ADRs for actual decisions YOU made during code generation
- Each ADR must explain WHY you chose this approach
- List realistic alternatives you considered
- Confidence score: 100 = certain, 50 = uncertain, <50 = needs TL review
- If no significant decisions were made, return empty adrs array: "adrs": []
      `.trim();
    }
    
    return basePrompt;
  }
}
```

---

### Step 3: Parse ADR Output

**File:** `src/modules/architecture-review/parsers/adr-output.parser.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ADROutput } from '@/modules/ai-routing/interfaces/ai-task.interface';

@Injectable()
export class ADROutputParser {
  private readonly logger = new Logger(ADROutputParser.name);

  /**
   * Extract ADRs from AI provider response
   * Handles both structured JSON and fallback text parsing
   */
  parseADRs(aiOutput: string): ADROutput[] {
    try {
      // Try parsing as JSON first (preferred)
      const parsed = JSON.parse(aiOutput);
      
      if (parsed.adrs && Array.isArray(parsed.adrs)) {
        return this.validateADRs(parsed.adrs);
      }
      
      // Fallback: search for JSON block in text
      const jsonMatch = aiOutput.match(/\{[\s\S]*"adrs":\s*\[[\s\S]*\][\s\S]*\}/);
      if (jsonMatch) {
        const jsonParsed = JSON.parse(jsonMatch[0]);
        return this.validateADRs(jsonParsed.adrs || []);
      }
      
      // No ADRs found
      return [];
    } catch (error) {
      this.logger.warn(`Failed to parse ADRs from AI output: ${error.message}`);
      return [];
    }
  }

  /**
   * Validate ADR structure and set defaults
   */
  private validateADRs(adrs: any[]): ADROutput[] {
    return adrs
      .filter(adr => this.isValidADR(adr))
      .map(adr => ({
        title: adr.title,
        status: adr.status || 'Proposed',
        context: adr.context || '',
        decision: adr.decision || '',
        consequences: {
          positive: Array.isArray(adr.consequences?.positive) 
            ? adr.consequences.positive 
            : [],
          negative: Array.isArray(adr.consequences?.negative)
            ? adr.consequences.negative
            : []
        },
        alternativesConsidered: Array.isArray(adr.alternativesConsidered)
          ? adr.alternativesConsidered
          : [],
        confidence: typeof adr.confidence === 'number'
          ? Math.min(100, Math.max(0, adr.confidence))
          : 50 // default medium confidence
      }));
  }

  /**
   * Basic validation: must have title and decision
   */
  private isValidADR(adr: any): boolean {
    return (
      typeof adr === 'object' &&
      typeof adr.title === 'string' &&
      adr.title.length > 0 &&
      typeof adr.decision === 'string' &&
      adr.decision.length > 0
    );
  }
}
```

---

### Step 4: Store ADRs in Database

**File:** `prisma/schema.prisma` (add new table)

```prisma
model ArchitectureDecisionRecord {
  id        String   @id @default(cuid())
  
  // Relationships
  executionId String
  execution   Execution @relation(fields: [executionId], references: [id], onDelete: Cascade)
  ticketId    String
  ticket      Ticket    @relation(fields: [ticketId], references: [id])
  
  // ADR Content
  title       String
  status      ADRStatus @default(PROPOSED)
  context     String    @db.Text
  decision    String    @db.Text
  
  // Consequences (stored as JSON)
  consequences Json // {positive: string[], negative: string[]}
  
  // Alternatives
  alternativesConsidered String[] // Array of alternative approaches
  
  // AI Metadata
  confidence  Int      // 0-100
  aiProvider  String   // Which AI generated this
  
  // Review Status
  reviewedBy  String?  // User ID of TL who reviewed
  reviewedAt  DateTime?
  reviewNotes String?  @db.Text
  
  // Timestamps
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([executionId])
  @@index([ticketId])
  @@index([status])
  @@index([confidence]) // For querying low-confidence ADRs
}

enum ADRStatus {
  PROPOSED
  ACCEPTED
  REJECTED
  SUPERSEDED
}
```

---

### Step 5: Create ADR Repository

**File:** `src/modules/architecture-review/repositories/adr.repository.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ADROutput } from '@/modules/ai-routing/interfaces/ai-task.interface';
import { ADRStatus } from '@prisma/client';

@Injectable()
export class ADRRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create ADR records from AI output
   */
  async createADRsFromExecution(
    executionId: string,
    ticketId: string,
    aiProvider: string,
    adrs: ADROutput[]
  ): Promise<void> {
    if (!adrs || adrs.length === 0) {
      return; // No ADRs to create
    }

    await this.prisma.architectureDecisionRecord.createMany({
      data: adrs.map(adr => ({
        executionId,
        ticketId,
        aiProvider,
        title: adr.title,
        status: adr.status as ADRStatus,
        context: adr.context,
        decision: adr.decision,
        consequences: {
          positive: adr.consequences.positive,
          negative: adr.consequences.negative
        },
        alternativesConsidered: adr.alternativesConsidered,
        confidence: adr.confidence
      }))
    });
  }

  /**
   * Get ADRs requiring TL review (low confidence or not yet reviewed)
   */
  async getADRsRequiringReview(): Promise<any[]> {
    return this.prisma.architectureDecisionRecord.findMany({
      where: {
        OR: [
          { confidence: { lt: 70 } }, // Low confidence
          { reviewedBy: null }        // Not yet reviewed
        ],
        status: ADRStatus.PROPOSED
      },
      include: {
        execution: true,
        ticket: true
      },
      orderBy: [
        { confidence: 'asc' },  // Lowest confidence first
        { createdAt: 'asc' }    // Oldest first
      ]
    });
  }
}
```

---

### Step 6: Integrate with Execution Flow

**File:** `src/modules/execution/services/execution.service.ts`

```typescript
import { ADROutputParser } from '@/modules/architecture-review/parsers/adr-output.parser';
import { ADRRepository } from '@/modules/architecture-review/repositories/adr.repository';

@Injectable()
export class ExecutionService {
  constructor(
    // ... existing dependencies
    private readonly adrParser: ADROutputParser,
    private readonly adrRepository: ADRRepository
  ) {}

  async handleExecutionComplete(executionId: string): Promise<void> {
    const execution = await this.executionRepository.findById(executionId);
    
    // Existing code quality checks...
    
    // NEW: Extract and store ADRs
    if (execution.codeOutput) {
      const adrs = this.adrParser.parseADRs(execution.codeOutput);
      
      if (adrs.length > 0) {
        await this.adrRepository.createADRsFromExecution(
          execution.id,
          execution.ticketId,
          execution.aiProvider,
          adrs
        );
        
        // Check for low-confidence ADRs that need TL review
        const lowConfidenceADRs = adrs.filter(adr => adr.confidence < 70);
        if (lowConfidenceADRs.length > 0) {
          await this.notificationService.alertTLForArchitectureReview(
            execution.id,
            lowConfidenceADRs
          );
        }
      }
    }
    
    // Continue with existing flow...
  }
}
```

---

## Testing Strategy

### Unit Tests

**File:** `src/modules/architecture-review/parsers/adr-output.parser.spec.ts`

```typescript
describe('ADROutputParser', () => {
  let parser: ADROutputParser;

  beforeEach(() => {
    parser = new ADROutputParser();
  });

  it('should parse valid ADR JSON', () => {
    const aiOutput = JSON.stringify({
      code: '...',
      adrs: [{
        title: 'Use Redis for Caching',
        status: 'Proposed',
        context: 'Need fast lookups',
        decision: 'Implement Redis',
        consequences: {
          positive: ['Fast', 'Scalable'],
          negative: ['New dependency']
        },
        alternativesConsidered: ['Memcached', 'In-memory'],
        confidence: 85
      }]
    });

    const adrs = parser.parseADRs(aiOutput);
    
    expect(adrs).toHaveLength(1);
    expect(adrs[0].title).toBe('Use Redis for Caching');
    expect(adrs[0].confidence).toBe(85);
  });

  it('should return empty array for invalid JSON', () => {
    const adrs = parser.parseADRs('invalid json');
    expect(adrs).toEqual([]);
  });

  it('should validate ADR structure and filter invalid', () => {
    const aiOutput = JSON.stringify({
      adrs: [
        { title: 'Valid', decision: 'Do thing' }, // Valid
        { title: 'Missing decision' },            // Invalid
        { decision: 'Missing title' }             // Invalid
      ]
    });

    const adrs = parser.parseADRs(aiOutput);
    expect(adrs).toHaveLength(1);
  });
});
```

---

## Success Metrics

Track ADR generation effectiveness:

### Quantitative
- **ADR Count:** ADRs generated per execution
- **Confidence Distribution:** % of ADRs with confidence >70%
- **Review Rate:** % of ADRs reviewed by TL
- **Time to Review:** Average time from creation to TL approval

### Qualitative
- **ADR Quality:** TL feedback on ADR usefulness (1-5 scale)
- **Coverage:** % of actual decisions captured in ADRs
- **Actionability:** Can developers understand decisions from ADR alone?

**Target:** >80% of significant decisions documented, >70% avg confidence

---

## Migration from Original Plan

If you've already started building ADR extraction logic:

### Remove These Files (Not Needed)
- ❌ `adr-extraction.service.ts` - AI outputs ADRs directly
- ❌ `adr-template-renderer.ts` - AI uses template
- ❌ `decision-parser.ts` - No parsing needed

### Keep These (Still Useful)
- ✅ `adr.repository.ts` - Database operations
- ✅ ADR database schema - Storage model
- ✅ TL review UI - Human review workflow

**Effort Saved:** ~5 days of parsing/extraction logic development

---

## Common Issues & Solutions

### Issue 1: AI Doesn't Return ADRs in JSON Format
**Solution:** Add example in prompt:
```typescript
const promptWithExample = `
${basePrompt}

**Example Response:**
{
  "code": "class UserService { ... }",
  "adrs": [{
    "title": "Use bcrypt for Password Hashing",
    "decision": "Hash passwords with bcrypt (10 rounds)",
    "confidence": 90,
    ...
  }]
}
`;
```

### Issue 2: AI Creates ADRs for Trivial Decisions
**Solution:** Clarify "significant" in prompt:
```
DO create ADRs for: new npm packages, design patterns, security choices
DON'T create ADRs for: variable names, code formatting, minor refactoring
```

### Issue 3: Low Confidence Scores (<50%)
**Action:** These ADRs should:
1. Block execution until TL reviews
2. Get priority in TL review queue
3. Trigger immediate TL notification

---

## Example AI Output (Success Case)

```json
{
  "code": "// ... implementation code ...",
  "filesChanged": [
    "src/services/user-auth.service.ts",
    "src/utils/password-hash.util.ts"
  ],
  "adrs": [
    {
      "title": "Use bcrypt for Password Hashing",
      "status": "Proposed",
      "context": "Need secure password storage for user authentication. Must protect against rainbow table and brute force attacks. OWASP recommends adaptive hashing functions.",
      "decision": "Implement bcrypt with cost factor 10 for password hashing. Store hash in users.password_hash column. Verify passwords by comparing hashes.",
      "consequences": {
        "positive": [
          "Industry-standard secure hashing",
          "Adaptive cost factor slows brute force",
          "Well-tested library (@types/bcrypt)",
          "OWASP approved"
        ],
        "negative": [
          "Slower than SHA-256 (intentionally)",
          "Cost factor impacts login performance (~100ms)",
          "Future cost increases require password rehashing"
        ]
      },
      "alternativesConsidered": [
        "argon2 (newer but less ecosystem support)",
        "PBKDF2 (OWASP approved but slower)",
        "scrypt (good but fewer NestJS examples)"
      ],
      "confidence": 90
    }
  ]
}
```

---

## Phase 1 Checklist

Before marking Story 7.1 as "Done":

- [ ] AI task interface updated with `requireADRs` flag
- [ ] Prompt generator includes ADR documentation requirement
- [ ] ADR output parser implemented with validation
- [ ] Database schema includes ADR table with migrations
- [ ] ADR repository created with CRUD operations
- [ ] Execution service integrates ADR extraction
- [ ] Low-confidence ADR notifications sent to TL
- [ ] Unit tests for parser (>80% coverage)
- [ ] Integration test with actual AI provider
- [ ] TL review UI displays ADRs (Epic 7.2 dependency)
- [ ] Documentation updated in sprint-status.yaml
- [ ] Success metrics tracked in Prometheus

---

## Next Stories (Epic 7 Dependencies)

After Story 7.1 is complete, these stories become easier:

- **Story 7.2:** TL Review Queue - Display ADRs from database
- **Story 7.3:** Risk Assessment - Use ADR confidence scores
- **Story 7.4:** Approval/Rejection - Update ADR status field

**Total Time Saved:** ~5 days (from original 1 week estimate)

---

**Status:** Ready for implementation when Epic 7 becomes active!  
**Estimated Effort:** 1-2 days (vs. original 1 week)  
**ROI:** 80% time savings + better ADR quality (AI documents consistently)
