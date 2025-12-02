# Story 2.11: Ticket Quality Scoring Algorithm

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P2 - MEDIUM  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjwan`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwan

---

## ⛔ BLOCKER: Story 2.2 Must Be Complete

**DO NOT START** this story until Story 2.2 is implemented and validated.

**Required from Story 2.2 (Ticket Parsing):**
- ✅ `TicketIntakeService` with parsing logic
- ✅ `TicketValidatorService` for validation rules
- ✅ `IParsedTicket` interface with all fields
- ✅ Database `Ticket` model with `ticket_quality_score` field

**⚠️ IMPORTANT - Story 2.2 Coordination:**
Story 2.2 creates `TicketQualityService` for **internal validation**. This story (2.11) adds:
1. **API endpoint** for PM access before submission (FR4)
2. **Enhanced scoring** with detailed breakdown and suggestions
3. **Prometheus metrics** for observability

**If Story 2.2 is NOT complete:** Implement full quality service here.  
**If Story 2.2 IS complete:** Extend existing service, add controller + metrics only.

---

## Story

As a PM,
I want to see a quality score for my tickets before submission,
So that I can improve ticket clarity and completeness.

---

## Acceptance Criteria

**Given** a ticket is created or updated  
**When** the quality scoring algorithm runs  
**Then** a score from 0-100 is calculated based on:
- Title clarity (15 pts)
- Description completeness (25 pts)
- Acceptance criteria quality (30 pts)
- Context documents attached (10 pts)
- Task complexity indicators (10 pts)
- Prerequisites defined (10 pts)

**And** score feedback is provided with grades:
- 90-100: Excellent ✅
- 70-89: Good 👍
- 50-69: Fair ⚠️
- 0-49: Poor ❌

**And** specific improvement suggestions are shown for each scoring category

**And** score is stored in `tickets.ticket_quality_score` field

**And** PMs can request score check before final submission via API endpoint

**And** only users with PM role can access the quality scoring endpoint

---

## Quick Implementation Summary (TL;DR)

**Architecture Coordination:**
- **Reuses:** `TicketQualityService` base from Story 2.2 (if complete)
- **Adds:** API controller, enhanced scoring, Prometheus metrics, caching
- **Guards:** `JwtAuthGuard` + `RolesGuard` (PM role required)

**8 Key Files in Implementation Order:**

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/ticket-intake/interfaces/ticket-quality.interface.ts` | CREATE | Quality interfaces (extend Story 2.2) |
| 2 | `src/ticket-intake/dto/ticket-quality.dto.ts` | CREATE | Request/Response DTOs |
| 3 | `src/ticket-intake/scoring/*.ts` | CREATE | 6 scorer classes |
| 4 | `src/ticket-intake/ticket-quality.service.ts` | CREATE/EXTEND | Main orchestrator |
| 5 | `src/ticket-intake/ticket-quality.controller.ts` | CREATE | API endpoint |
| 6 | `src/common/metrics/quality-metrics.provider.ts` | CREATE | Prometheus metrics |
| 7 | `src/ticket-intake/ticket-intake.module.ts` | MODIFY | Wire components |
| 8 | `test/ticket-quality.e2e-spec.ts` | CREATE | Integration tests |

**Environment Variables:**
```env
# Quality Scoring (optional - has defaults)
QUALITY_SCORE_THRESHOLD_EXCELLENT=90
QUALITY_SCORE_THRESHOLD_GOOD=70
QUALITY_SCORE_THRESHOLD_FAIR=50
QUALITY_SCORE_CACHE_TTL_SECONDS=300
```

---

## Technical Requirements

### Source References

| Source | Section | Requirement |
|--------|---------|-------------|
| PRD | FR4 | PMs can view ticket quality score before submitting |
| PRD | FR58 | System can validate ticket quality before routing |
| PRD | NFR-UX7 | Ticket quality indicators must be visible before submission |
| Architecture | ticket-intake | TicketQualityService in `src/ticket-intake/` |

### Architecture Alignment

```
src/ticket-intake/
├── interfaces/
│   └── ticket-quality.interface.ts  # CREATE
├── dto/
│   └── ticket-quality.dto.ts        # CREATE
├── scoring/                         # CREATE directory
│   ├── index.ts
│   ├── base-scorer.ts
│   ├── title-scorer.ts              # 15 pts
│   ├── description-scorer.ts        # 25 pts
│   ├── acceptance-criteria-scorer.ts # 30 pts
│   ├── context-scorer.ts            # 10 pts
│   ├── complexity-scorer.ts         # 10 pts
│   └── prerequisites-scorer.ts      # 10 pts
├── ticket-quality.service.ts        # CREATE/EXTEND
├── ticket-quality.controller.ts     # CREATE
├── ticket-quality.service.spec.ts   # CREATE
└── ticket-intake.module.ts          # MODIFY

src/common/metrics/
└── quality-metrics.provider.ts      # CREATE
```

---

## Phase 1: Interfaces & DTOs

### 1.1 Quality Interfaces

**File:** `src/ticket-intake/interfaces/ticket-quality.interface.ts`

```typescript
/**
 * Quality Scoring Interfaces - FR4: PM ticket quality visibility
 */

export interface ICategoryScore {
  category: string;
  score: number;
  maxPoints: number;
  percentage: number;
  suggestions: string[];
  details: string;
}

export interface IQualityScoreBreakdown {
  titleClarity: ICategoryScore;           // 15 pts
  descriptionCompleteness: ICategoryScore; // 25 pts
  acceptanceCriteria: ICategoryScore;      // 30 pts
  contextDocuments: ICategoryScore;        // 10 pts
  taskComplexity: ICategoryScore;          // 10 pts
  prerequisites: ICategoryScore;           // 10 pts
}

export type QualityGrade = 'excellent' | 'good' | 'fair' | 'poor';

export interface IQualityScore {
  totalScore: number;
  grade: QualityGrade;
  gradeEmoji: string;
  gradeMessage: string;
  breakdown: IQualityScoreBreakdown;
  topSuggestions: string[];
  meetsMinimumThreshold: boolean;
  scoredAt: string;
}

export interface IQualityScoreInput {
  title: string;
  description: string;
  acceptanceCriteria: string;
  contextDocuments?: string[];
  tags?: string[];
  prerequisites?: string[];
  projectContext?: string;
}

export interface IScorer {
  readonly category: string;
  readonly maxPoints: number;
  score(input: IQualityScoreInput): ICategoryScore;
}
```

### 1.2 DTOs with Validation

**File:** `src/ticket-intake/dto/ticket-quality.dto.ts`

```typescript
import { IsString, IsOptional, IsArray, IsNumber, Min, Max, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QualityGrade } from '../interfaces/ticket-quality.interface';

export class QualityScoreRequestDto {
  @ApiProperty({ example: 'Implement user authentication' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Add JWT-based auth to enable secure login...' })
  @IsString()
  description: string;

  @ApiProperty({ example: '- User can login\n- Token expires in 24h' })
  @IsString()
  acceptanceCriteria: string;

  @ApiPropertyOptional({ example: ['auth-spec.md'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contextDocuments?: string[];

  @ApiPropertyOptional({ example: ['auth', 'security'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: ['Story 1.5'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prerequisites?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectContext?: string;
}

export class CategoryScoreDto {
  @ApiProperty() category: string;
  @ApiProperty() @IsNumber() @Min(0) score: number;
  @ApiProperty() @IsNumber() maxPoints: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) percentage: number;
  @ApiProperty({ type: [String] }) suggestions: string[];
  @ApiProperty() details: string;
}

export class QualityScoreBreakdownDto {
  @ApiProperty() titleClarity: CategoryScoreDto;
  @ApiProperty() descriptionCompleteness: CategoryScoreDto;
  @ApiProperty() acceptanceCriteria: CategoryScoreDto;
  @ApiProperty() contextDocuments: CategoryScoreDto;
  @ApiProperty() taskComplexity: CategoryScoreDto;
  @ApiProperty() prerequisites: CategoryScoreDto;
}

export class QualityScoreResponseDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber() @Min(0) @Max(100)
  totalScore: number;

  @ApiProperty({ enum: ['excellent', 'good', 'fair', 'poor'] })
  @IsIn(['excellent', 'good', 'fair', 'poor'])
  grade: QualityGrade;

  @ApiProperty() gradeEmoji: string;
  @ApiProperty() gradeMessage: string;
  @ApiProperty() breakdown: QualityScoreBreakdownDto;
  @ApiProperty({ type: [String] }) topSuggestions: string[];
  @ApiProperty() meetsMinimumThreshold: boolean;
  @ApiProperty() scoredAt: string;
}

// Batch scoring support
export class BatchQualityScoreRequestDto {
  @ApiProperty({ type: [QualityScoreRequestDto] })
  @IsArray()
  tickets: QualityScoreRequestDto[];
}

export class BatchQualityScoreResponseDto {
  @ApiProperty({ type: [QualityScoreResponseDto] })
  results: QualityScoreResponseDto[];
  
  @ApiProperty() processedCount: number;
  @ApiProperty() averageScore: number;
}
```

---

## Phase 2: Scorers

### 2.1 Base Scorer

**File:** `src/ticket-intake/scoring/base-scorer.ts`

```typescript
import { ICategoryScore, IQualityScoreInput, IScorer } from '../interfaces/ticket-quality.interface';

export abstract class BaseScorer implements IScorer {
  abstract readonly category: string;
  abstract readonly maxPoints: number;
  abstract score(input: IQualityScoreInput): ICategoryScore;

  protected createResult(score: number, suggestions: string[], details: string): ICategoryScore {
    const clampedScore = Math.max(0, Math.min(score, this.maxPoints));
    return {
      category: this.category,
      score: clampedScore,
      maxPoints: this.maxPoints,
      percentage: Math.round((clampedScore / this.maxPoints) * 100),
      suggestions,
      details,
    };
  }

  protected countWords(text: string): number {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  protected countListItems(text: string): number {
    const bullets = (text.match(/^[\s]*[-*•]\s+.+$/gm) || []).length;
    const numbered = (text.match(/^[\s]*\d+[\.\)]\s+.+$/gm) || []).length;
    return bullets + numbered;
  }

  protected containsAny(text: string, patterns: string[]): boolean {
    const lower = text.toLowerCase();
    return patterns.some(p => lower.includes(p.toLowerCase()));
  }
}
```

### 2.2 Category Scorers (Summarized Pattern)

**File:** `src/ticket-intake/scoring/title-scorer.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { BaseScorer } from './base-scorer';
import { ICategoryScore, IQualityScoreInput } from '../interfaces/ticket-quality.interface';

@Injectable()
export class TitleScorer extends BaseScorer {
  readonly category = 'titleClarity';
  readonly maxPoints = 15;

  private readonly actionVerbs = [
    'implement', 'create', 'add', 'update', 'fix', 'remove', 'refactor',
    'integrate', 'configure', 'setup', 'build', 'design', 'test', 'migrate',
    'optimize', 'enhance', 'enable', 'disable', 'validate', 'process'
  ];

  private readonly vagueTerms = [
    'stuff', 'things', 'misc', 'various', 'some', 'update things',
    'fix stuff', 'changes', 'improvements', 'updates', 'tbd', 'todo'
  ];

  score(input: IQualityScoreInput): ICategoryScore {
    const title = input.title.trim();
    const suggestions: string[] = [];
    let score = 0;
    const details: string[] = [];

    // Word count: 5 pts for 3-15 words
    const wordCount = this.countWords(title);
    if (wordCount >= 3 && wordCount <= 15) {
      score += 5;
      details.push(`Word count (${wordCount}) optimal`);
    } else if (wordCount < 3) {
      suggestions.push('Title too short - add more context');
    } else {
      score += 2;
      suggestions.push('Title long - consider being more concise');
    }

    // Action verb: 3 pts
    if (this.actionVerbs.some(v => title.toLowerCase().includes(v))) {
      score += 3;
      details.push('Has action verb');
    } else {
      suggestions.push('Start with action verb (Implement, Create, Add, Fix)');
    }

    // No vague terms: 3 pts
    if (!this.vagueTerms.some(v => title.toLowerCase().includes(v))) {
      score += 3;
      details.push('No vague terms');
    } else {
      suggestions.push('Remove vague terms, be specific');
    }

    // Specificity: 4 pts
    const specificPatterns = [
      /\b(api|endpoint|service|controller|module|component)\b/i,
      /\b(auth|user|admin|payment|dashboard|report)\b/i,
      /\b(database|queue|cache|webhook|integration)\b/i
    ];
    const matches = specificPatterns.filter(p => p.test(title)).length;
    if (matches >= 2) { score += 4; details.push('Highly specific'); }
    else if (matches === 1) { score += 2; suggestions.push('Add more specific context'); }
    else { suggestions.push('Specify feature/component affected'); }

    return this.createResult(score, suggestions, details.join('; '));
  }
}
```

**Remaining Scorers** - Follow same pattern:

| File | Max Pts | Key Criteria |
|------|---------|--------------|
| `description-scorer.ts` | 25 | Word count (5), context (5), "why" (5), technical (5), structure (5) |
| `acceptance-criteria-scorer.ts` | 30 | Count (8), BDD format (8), measurable (7), edge cases (7) |
| `context-scorer.ts` | 10 | Has docs (4), relevant types (3), multiple (3) |
| `complexity-scorer.ts` | 10 | Complexity tag (4), scope (3), technical area (3) |
| `prerequisites-scorer.ts` | 10 | Defined (4), specific (3), explicit (3) |

**File:** `src/ticket-intake/scoring/index.ts`

```typescript
export * from './base-scorer';
export * from './title-scorer';
export * from './description-scorer';
export * from './acceptance-criteria-scorer';
export * from './context-scorer';
export * from './complexity-scorer';
export * from './prerequisites-scorer';
```

---

## Phase 3: Service & Controller

### 3.1 Prometheus Metrics

**File:** `src/common/metrics/quality-metrics.provider.ts`

```typescript
import { Provider } from '@nestjs/common';
import { makeHistogramProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';

export const QUALITY_METRICS = {
  SCORE_HISTOGRAM: 'ticket_quality_score',
  REQUESTS_TOTAL: 'ticket_quality_requests_total',
  DURATION_HISTOGRAM: 'ticket_quality_duration_seconds',
};

export const qualityMetricsProviders: Provider[] = [
  makeHistogramProvider({
    name: QUALITY_METRICS.SCORE_HISTOGRAM,
    help: 'Ticket quality scores distribution',
    labelNames: ['grade'],
    buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  }),
  makeCounterProvider({
    name: QUALITY_METRICS.REQUESTS_TOTAL,
    help: 'Total ticket quality check requests',
    labelNames: ['endpoint', 'grade'],
  }),
  makeHistogramProvider({
    name: QUALITY_METRICS.DURATION_HISTOGRAM,
    help: 'Quality scoring duration in seconds',
    labelNames: ['endpoint'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  }),
];
```

### 3.2 Main Service

**File:** `src/ticket-intake/ticket-quality.service.ts`

```typescript
import { Injectable, Logger, Inject, CACHE_MANAGER } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram, Counter } from 'prom-client';
import { createHash } from 'crypto';
import {
  IQualityScore, IQualityScoreInput, IQualityScoreBreakdown, QualityGrade,
} from './interfaces/ticket-quality.interface';
import {
  TitleScorer, DescriptionScorer, AcceptanceCriteriaScorer,
  ContextScorer, ComplexityScorer, PrerequisitesScorer,
} from './scoring';
import { QUALITY_METRICS } from '../common/metrics/quality-metrics.provider';

@Injectable()
export class TicketQualityService {
  private readonly logger = new Logger(TicketQualityService.name);
  private readonly thresholds: { excellent: number; good: number; fair: number; minimum: number };
  private readonly cacheTtl: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly titleScorer: TitleScorer,
    private readonly descriptionScorer: DescriptionScorer,
    private readonly acScorer: AcceptanceCriteriaScorer,
    private readonly contextScorer: ContextScorer,
    private readonly complexityScorer: ComplexityScorer,
    private readonly prereqScorer: PrerequisitesScorer,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectMetric(QUALITY_METRICS.SCORE_HISTOGRAM) private readonly scoreHistogram: Histogram,
    @InjectMetric(QUALITY_METRICS.REQUESTS_TOTAL) private readonly requestsCounter: Counter,
    @InjectMetric(QUALITY_METRICS.DURATION_HISTOGRAM) private readonly durationHistogram: Histogram,
  ) {
    this.thresholds = {
      excellent: this.configService.get('quality.thresholdExcellent', 90),
      good: this.configService.get('quality.thresholdGood', 70),
      fair: this.configService.get('quality.thresholdFair', 50),
      minimum: this.configService.get('quality.minimumThreshold', 50),
    };
    this.cacheTtl = this.configService.get('quality.cacheTtlSeconds', 300);
  }

  async calculateScore(input: IQualityScoreInput, correlationId?: string): Promise<IQualityScore> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';
    const timer = this.durationHistogram.startTimer({ endpoint: 'score' });

    // Check cache first
    const cacheKey = this.getCacheKey(input);
    const cached = await this.cacheManager.get<IQualityScore>(cacheKey);
    if (cached) {
      this.logger.debug(`${logPrefix} Cache hit for quality score`);
      timer();
      return cached;
    }

    // Run all scorers
    const breakdown: IQualityScoreBreakdown = {
      titleClarity: this.titleScorer.score(input),
      descriptionCompleteness: this.descriptionScorer.score(input),
      acceptanceCriteria: this.acScorer.score(input),
      contextDocuments: this.contextScorer.score(input),
      taskComplexity: this.complexityScorer.score(input),
      prerequisites: this.prereqScorer.score(input),
    };

    const totalScore = Object.values(breakdown).reduce((sum, cat) => sum + cat.score, 0);
    const grade = this.calculateGrade(totalScore);
    const { gradeEmoji, gradeMessage } = this.getGradeDetails(grade);

    const result: IQualityScore = {
      totalScore,
      grade,
      gradeEmoji,
      gradeMessage,
      breakdown,
      topSuggestions: this.aggregateSuggestions(breakdown),
      meetsMinimumThreshold: totalScore >= this.thresholds.minimum,
      scoredAt: new Date().toISOString(),
    };

    // Update metrics
    this.scoreHistogram.observe({ grade }, totalScore);
    this.requestsCounter.inc({ endpoint: 'score', grade });
    timer();

    // Cache result
    await this.cacheManager.set(cacheKey, result, this.cacheTtl * 1000);

    this.logger.log(`${logPrefix} Quality score: ${totalScore}/100 (${grade})`);
    return result;
  }

  async quickScore(input: IQualityScoreInput): Promise<{ score: number; grade: QualityGrade }> {
    const result = await this.calculateScore(input);
    return { score: result.totalScore, grade: result.grade };
  }

  async batchScore(inputs: IQualityScoreInput[]): Promise<IQualityScore[]> {
    return Promise.all(inputs.map(input => this.calculateScore(input)));
  }

  private getCacheKey(input: IQualityScoreInput): string {
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
      .substring(0, 16);
    return `quality:${hash}`;
  }

  private calculateGrade(score: number): QualityGrade {
    if (score >= this.thresholds.excellent) return 'excellent';
    if (score >= this.thresholds.good) return 'good';
    if (score >= this.thresholds.fair) return 'fair';
    return 'poor';
  }

  private getGradeDetails(grade: QualityGrade): { gradeEmoji: string; gradeMessage: string } {
    const map: Record<QualityGrade, { gradeEmoji: string; gradeMessage: string }> = {
      excellent: { gradeEmoji: '✅', gradeMessage: 'Excellent! Well-defined and ready for processing.' },
      good: { gradeEmoji: '👍', gradeMessage: 'Good quality. Minor improvements could enhance clarity.' },
      fair: { gradeEmoji: '⚠️', gradeMessage: 'Fair quality. Address suggestions before submitting.' },
      poor: { gradeEmoji: '❌', gradeMessage: 'Poor quality. Improve based on suggestions.' },
    };
    return map[grade];
  }

  private aggregateSuggestions(breakdown: IQualityScoreBreakdown): string[] {
    const priority: (keyof IQualityScoreBreakdown)[] = [
      'acceptanceCriteria', 'descriptionCompleteness', 'titleClarity',
      'prerequisites', 'taskComplexity', 'contextDocuments',
    ];
    const suggestions: string[] = [];
    for (const cat of priority) {
      if (breakdown[cat].percentage < 100) {
        suggestions.push(...breakdown[cat].suggestions);
      }
      if (suggestions.length >= 5) break;
    }
    return suggestions.slice(0, 5);
  }
}
```

### 3.3 Controller with Auth & Rate Limiting

**File:** `src/ticket-intake/ticket-quality.controller.ts`

```typescript
import {
  Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Logger,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { TicketQualityService } from './ticket-quality.service';
import {
  QualityScoreRequestDto, QualityScoreResponseDto,
  BatchQualityScoreRequestDto, BatchQualityScoreResponseDto,
} from './dto/ticket-quality.dto';

@ApiTags('Ticket Quality')
@Controller('ticket-quality')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class TicketQualityController {
  private readonly logger = new Logger(TicketQualityController.name);

  constructor(private readonly qualityService: TicketQualityService) {}

  @Post('score')
  @HttpCode(HttpStatus.OK)
  @Roles('pm', 'admin')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 req/min
  @ApiOperation({ summary: 'Check ticket quality score (PM only)' })
  @ApiBody({ type: QualityScoreRequestDto })
  @ApiResponse({ status: 200, type: QualityScoreResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM role required' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async checkQuality(
    @Body() request: QualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<QualityScoreResponseDto> {
    this.logger.log(`[${correlationId}] Quality score request`);
    return this.qualityService.calculateScore(request, correlationId);
  }

  @Post('quick-check')
  @HttpCode(HttpStatus.OK)
  @Roles('pm', 'admin')
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 req/min (lighter)
  @ApiOperation({ summary: 'Quick quality check - score and grade only' })
  @ApiResponse({ status: 200, schema: { properties: { score: { type: 'number' }, grade: { type: 'string' } } } })
  async quickCheck(
    @Body() request: QualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<{ score: number; grade: string }> {
    this.logger.debug(`[${correlationId}] Quick check`);
    return this.qualityService.quickScore(request);
  }

  @Post('batch-score')
  @HttpCode(HttpStatus.OK)
  @Roles('pm', 'admin')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 req/min (heavy)
  @ApiOperation({ summary: 'Batch quality scoring for multiple tickets' })
  @ApiBody({ type: BatchQualityScoreRequestDto })
  @ApiResponse({ status: 200, type: BatchQualityScoreResponseDto })
  async batchScore(
    @Body() request: BatchQualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<BatchQualityScoreResponseDto> {
    this.logger.log(`[${correlationId}] Batch score for ${request.tickets.length} tickets`);
    
    const results = await this.qualityService.batchScore(request.tickets);
    const averageScore = results.reduce((sum, r) => sum + r.totalScore, 0) / results.length;
    
    return {
      results,
      processedCount: results.length,
      averageScore: Math.round(averageScore),
    };
  }
}
```

---

## Phase 4: Module & Configuration

### 4.1 Module Configuration

**File:** `src/ticket-intake/ticket-intake.module.ts` (MODIFY)

```typescript
import { Module, CacheModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { qualityMetricsProviders } from '../common/metrics/quality-metrics.provider';

// Quality scoring
import { TicketQualityService } from './ticket-quality.service';
import { TicketQualityController } from './ticket-quality.controller';
import {
  TitleScorer, DescriptionScorer, AcceptanceCriteriaScorer,
  ContextScorer, ComplexityScorer, PrerequisitesScorer,
} from './scoring';

// Note: Story 2.2 services added when that story completes:
// - TicketIntakeService, TicketValidatorService, TicketIntakeConsumer

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: config.get('quality.cacheTtlSeconds', 300) * 1000,
        max: 1000,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
  ],
  controllers: [TicketQualityController],
  providers: [
    TicketQualityService,
    TitleScorer,
    DescriptionScorer,
    AcceptanceCriteriaScorer,
    ContextScorer,
    ComplexityScorer,
    PrerequisitesScorer,
    ...qualityMetricsProviders,
  ],
  exports: [TicketQualityService],
})
export class TicketIntakeModule {}
```

### 4.2 Configuration Updates

**File:** `src/config/configuration.ts` (ADD)

```typescript
// Add to existing configuration:
quality: {
  thresholdExcellent: parseInt(process.env.QUALITY_SCORE_THRESHOLD_EXCELLENT, 10) || 90,
  thresholdGood: parseInt(process.env.QUALITY_SCORE_THRESHOLD_GOOD, 10) || 70,
  thresholdFair: parseInt(process.env.QUALITY_SCORE_THRESHOLD_FAIR, 10) || 50,
  minimumThreshold: parseInt(process.env.QUALITY_MINIMUM_THRESHOLD, 10) || 50,
  cacheTtlSeconds: parseInt(process.env.QUALITY_SCORE_CACHE_TTL_SECONDS, 10) || 300,
},
```

**File:** `src/config/env.validation.ts` (ADD)

```typescript
// Add to Joi schema:
QUALITY_SCORE_THRESHOLD_EXCELLENT: Joi.number().integer().min(0).max(100).default(90),
QUALITY_SCORE_THRESHOLD_GOOD: Joi.number().integer().min(0).max(100).default(70),
QUALITY_SCORE_THRESHOLD_FAIR: Joi.number().integer().min(0).max(100).default(50),
QUALITY_MINIMUM_THRESHOLD: Joi.number().integer().min(0).max(100).default(50),
QUALITY_SCORE_CACHE_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(300),
```

---

## Phase 5: Tests

### 5.1 Unit Tests

**File:** `src/ticket-intake/ticket-quality.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/common';
import { getMetricToken } from '@willsoto/nestjs-prometheus';
import { TicketQualityService } from './ticket-quality.service';
import { TitleScorer, DescriptionScorer, AcceptanceCriteriaScorer,
  ContextScorer, ComplexityScorer, PrerequisitesScorer } from './scoring';
import { QUALITY_METRICS } from '../common/metrics/quality-metrics.provider';

describe('TicketQualityService', () => {
  let service: TicketQualityService;

  const mockCache = { get: jest.fn(), set: jest.fn() };
  const mockHistogram = { observe: jest.fn(), startTimer: jest.fn(() => jest.fn()) };
  const mockCounter = { inc: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketQualityService,
        TitleScorer, DescriptionScorer, AcceptanceCriteriaScorer,
        ContextScorer, ComplexityScorer, PrerequisitesScorer,
        { provide: ConfigService, useValue: { get: jest.fn((k, d) => d) } },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: getMetricToken(QUALITY_METRICS.SCORE_HISTOGRAM), useValue: mockHistogram },
        { provide: getMetricToken(QUALITY_METRICS.REQUESTS_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(QUALITY_METRICS.DURATION_HISTOGRAM), useValue: mockHistogram },
      ],
    }).compile();

    service = module.get<TicketQualityService>(TicketQualityService);
    mockCache.get.mockResolvedValue(null);
  });

  it('returns excellent grade for comprehensive ticket', async () => {
    const result = await service.calculateScore({
      title: 'Implement JWT authentication for user login endpoint',
      description: `Currently no auth. Need JWT for secure login.
        Will create auth service, add endpoint, implement middleware.
        Technical: @nestjs/jwt, refresh tokens in database.`,
      acceptanceCriteria: `Given valid credentials When login Then JWT returned within 200ms
        Given invalid token When access protected Then 401 Unauthorized`,
      contextDocuments: ['auth-spec.md', 'security.pdf'],
      tags: ['auth', 'security', 'backend'],
      prerequisites: ['Story 1.5'],
    });

    expect(result.totalScore).toBeGreaterThanOrEqual(70);
    expect(['excellent', 'good']).toContain(result.grade);
    expect(result.meetsMinimumThreshold).toBe(true);
  });

  it('returns poor grade for minimal ticket', async () => {
    const result = await service.calculateScore({
      title: 'Fix bug',
      description: 'Broken',
      acceptanceCriteria: 'Works',
    });

    expect(result.totalScore).toBeLessThan(50);
    expect(result.grade).toBe('poor');
    expect(result.topSuggestions.length).toBeGreaterThan(0);
  });

  it('uses cache for identical requests', async () => {
    const cached = { totalScore: 85, grade: 'good' } as any;
    mockCache.get.mockResolvedValueOnce(cached);

    const result = await service.calculateScore({ title: 't', description: 'd', acceptanceCriteria: 'a' });
    expect(result).toBe(cached);
  });
});
```

### 5.2 E2E Tests

**File:** `test/ticket-quality.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';

describe('TicketQualityController (e2e)', () => {
  let app: INestApplication;
  let pmToken: string;
  let devToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    const jwtService = moduleFixture.get<JwtService>(JwtService);
    pmToken = jwtService.sign({ sub: 'pm-user', role: 'pm' });
    devToken = jwtService.sign({ sub: 'dev-user', role: 'developer' });
  });

  afterAll(async () => { await app.close(); });

  describe('POST /ticket-quality/score', () => {
    const validRequest = {
      title: 'Implement user authentication',
      description: 'Need JWT auth for secure login. Create auth service.',
      acceptanceCriteria: 'Given valid credentials When login Then token returned',
      tags: ['auth'],
    };

    it('returns score for PM role', async () => {
      const res = await request(app.getHttpServer())
        .post('/ticket-quality/score')
        .set('Authorization', `Bearer ${pmToken}`)
        .send(validRequest)
        .expect(200);

      expect(res.body).toHaveProperty('totalScore');
      expect(res.body).toHaveProperty('grade');
      expect(res.body).toHaveProperty('breakdown');
      expect(res.body.totalScore).toBeGreaterThanOrEqual(0);
      expect(res.body.totalScore).toBeLessThanOrEqual(100);
    });

    it('returns 401 without token', async () => {
      await request(app.getHttpServer())
        .post('/ticket-quality/score')
        .send(validRequest)
        .expect(401);
    });

    it('returns 403 for non-PM role', async () => {
      await request(app.getHttpServer())
        .post('/ticket-quality/score')
        .set('Authorization', `Bearer ${devToken}`)
        .send(validRequest)
        .expect(403);
    });

    it('returns 400 for missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/ticket-quality/score')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ title: 'Test' })
        .expect(400);
    });
  });

  describe('POST /ticket-quality/batch-score', () => {
    it('scores multiple tickets', async () => {
      const res = await request(app.getHttpServer())
        .post('/ticket-quality/batch-score')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          tickets: [
            { title: 'Task 1', description: 'Desc 1', acceptanceCriteria: 'AC 1' },
            { title: 'Task 2', description: 'Desc 2', acceptanceCriteria: 'AC 2' },
          ],
        })
        .expect(200);

      expect(res.body.results).toHaveLength(2);
      expect(res.body.processedCount).toBe(2);
      expect(res.body.averageScore).toBeDefined();
    });
  });
});
```

---

## Tasks Checklist

### Phase 1: Foundation
- [ ] Create `interfaces/ticket-quality.interface.ts`
- [ ] Create `dto/ticket-quality.dto.ts`

### Phase 2: Scorers
- [ ] Create `scoring/` directory with all 7 files
- [ ] Implement all 6 scorer classes

### Phase 3: Service & Controller
- [ ] Create `quality-metrics.provider.ts`
- [ ] Create `ticket-quality.service.ts` with caching
- [ ] Create `ticket-quality.controller.ts` with guards

### Phase 4: Integration
- [ ] Update `ticket-intake.module.ts`
- [ ] Add config to `configuration.ts`
- [ ] Add validation to `env.validation.ts`

### Phase 5: Testing
- [ ] Unit tests with >80% coverage
- [ ] E2E tests for all endpoints
- [ ] Verify rate limiting works

---

## Dev Notes

### Critical Import Paths
```typescript
// ✅ CORRECT - Use these paths:
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// ❌ WRONG - These don't exist:
// import { JwtAuthGuard } from '../auth/strategies/jwt-auth.guard';
```

### Story 2.2 Coordination
- If Story 2.2 completed: Check for existing `IQualityScoreBreakdown` - merge interfaces
- `TicketQualityService` may already exist - extend it instead of replacing
- Quality scoring in 2.2 is for internal validation; 2.11 adds PM-facing API

### Dependencies
| Story | Required | Status |
|-------|----------|--------|
| 1.4 | ConfigService | ✅ |
| 1.6 | JwtAuthGuard, RolesGuard | ✅ |
| 1.7 | LoggerService | ✅ |
| 1.8 | Prometheus metrics | ✅ |
| 2.2 | TicketIntakeService | ⚠️ Prerequisite |

### References
- [Source: docs/prd.md#FR4] - PM ticket quality visibility
- [Source: docs/architecture.md#ticket-intake] - Module structure
- [Source: src/common/guards/index.ts] - Guard exports

---

## File List

| File | Action |
|------|--------|
| `src/ticket-intake/interfaces/ticket-quality.interface.ts` | CREATE |
| `src/ticket-intake/dto/ticket-quality.dto.ts` | CREATE |
| `src/ticket-intake/scoring/base-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/title-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/description-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/acceptance-criteria-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/context-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/complexity-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/prerequisites-scorer.ts` | CREATE |
| `src/ticket-intake/scoring/index.ts` | CREATE |
| `src/common/metrics/quality-metrics.provider.ts` | CREATE |
| `src/ticket-intake/ticket-quality.service.ts` | CREATE |
| `src/ticket-intake/ticket-quality.controller.ts` | CREATE |
| `src/ticket-intake/ticket-intake.module.ts` | MODIFY |
| `src/config/configuration.ts` | MODIFY |
| `src/config/env.validation.ts` | MODIFY |
| `src/ticket-intake/ticket-quality.service.spec.ts` | CREATE |
| `test/ticket-quality.e2e-spec.ts` | CREATE |
