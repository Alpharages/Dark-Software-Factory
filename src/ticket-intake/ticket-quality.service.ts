import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { createHash } from 'crypto';
import { IParsedTicket, IQualityScoreInput, ICategoryScore, QualityGrade } from './interfaces';
import {
  QualityScoreDto,
  QualityScoreBreakdownDto,
  QualityScoreResponseDto,
  QuickScoreResponseDto,
} from './dto';

/** Cache entry with expiration */
interface CacheEntry {
  data: QualityScoreResponseDto;
  expiresAt: number;
}

/**
 * Ticket Quality Scoring Service
 * FR58: Validate ticket quality - scoring system
 * Story 2.11: PM-facing quality scoring API
 *
 * Calculates quality score (0-100) based on:
 * - Title clarity (15 pts)
 * - Description completeness (25 pts)
 * - Acceptance criteria (30 pts)
 * - Context documents (10 pts)
 * - Task complexity (10 pts)
 * - Prerequisites (10 pts)
 */
@Injectable()
export class TicketQualityService {
  private readonly logger = new Logger(TicketQualityService.name);

  // In-memory cache for PM API (avoids external dependency)
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheSize = 1000;

  // Configurable thresholds
  private readonly thresholds: {
    excellent: number;
    good: number;
    fair: number;
    minimum: number;
  };
  private readonly cacheTtlMs: number;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @InjectMetric('dsf_ticket_quality_score')
    private readonly qualityScoreHistogram?: Histogram,
  ) {
    // Load thresholds from config with defaults
    this.thresholds = {
      excellent: this.configService?.get('quality.thresholdExcellent', 90) ?? 90,
      good: this.configService?.get('quality.thresholdGood', 70) ?? 70,
      fair: this.configService?.get('quality.thresholdFair', 50) ?? 50,
      minimum: this.configService?.get('quality.minimumThreshold', 50) ?? 50,
    };
    this.cacheTtlMs = (this.configService?.get('quality.cacheTtlSeconds', 300) ?? 300) * 1000;
  }

  /**
   * Calculate quality score for a parsed ticket
   */
  calculateScore(ticket: IParsedTicket, correlationId: string): QualityScoreDto {
    const breakdown = new QualityScoreBreakdownDto();
    const suggestions: string[] = [];

    breakdown.titleClarity = this.scoreTitleClarity(ticket.title, suggestions);
    breakdown.descriptionCompleteness = this.scoreDescription(ticket.description, suggestions);
    breakdown.acceptanceCriteria = this.scoreAcceptanceCriteria(
      ticket.acceptanceCriteria,
      suggestions,
    );
    breakdown.contextDocuments = this.scoreContextDocuments(ticket.description, suggestions);
    breakdown.taskComplexity = this.scoreComplexity(ticket, suggestions);
    breakdown.prerequisites = this.scorePrerequisites(ticket.description, suggestions);

    const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
    const grade = this.calculateGrade(totalScore);

    this.logger.log(`[${correlationId}] Quality score: ${totalScore}/100 (${grade})`);

    const result = new QualityScoreDto();
    result.totalScore = totalScore;
    result.breakdown = breakdown;
    result.grade = grade;
    result.suggestions = suggestions;

    return result;
  }

  /**
   * Calculate grade from total score using configurable thresholds
   */
  private calculateGrade(totalScore: number): QualityGrade {
    if (totalScore >= this.thresholds.excellent) return 'excellent';
    if (totalScore >= this.thresholds.good) return 'good';
    if (totalScore >= this.thresholds.fair) return 'fair';
    return 'poor';
  }

  /**
   * Score title clarity (0-15 pts)
   */
  private scoreTitleClarity(title: string, suggestions: string[]): number {
    let score = 0;

    if (!title) return 0;

    // Base points for having a title
    score += 5;

    // Optimal length (10-50 chars)
    if (title.length >= 10 && title.length <= 50) {
      score += 5;
    } else if (title.length > 50) {
      suggestions.push('Consider shortening the title (under 50 characters)');
    }

    // Action verb at start
    if (/\b(add|create|implement|fix|update|remove|refactor|enhance|integrate)\b/i.test(title)) {
      score += 5;
    } else {
      suggestions.push('Start title with an action verb (Add, Create, Fix, etc.)');
    }

    return Math.min(score, 15);
  }

  /**
   * Score description completeness (0-25 pts)
   */
  private scoreDescription(desc: string, suggestions: string[]): number {
    if (!desc) return 0;

    let score = 5; // Base points for having description

    // Length scoring
    if (desc.length >= 200) {
      score += 8;
    } else if (desc.length >= 100) {
      score += 5;
    } else {
      suggestions.push('Add more detail to description (aim for 200+ characters)');
    }

    // Structure (lists, paragraphs)
    if (desc.includes('\n') || desc.includes('- ') || desc.includes('* ')) {
      score += 6;
    }

    // Contains reasoning (why)
    if (/\b(because|so that|in order to|to enable|allows)\b/i.test(desc)) {
      score += 6;
    } else {
      suggestions.push('Explain WHY this feature/fix is needed');
    }

    return Math.min(score, 25);
  }

  /**
   * Score acceptance criteria (0-30 pts)
   */
  private scoreAcceptanceCriteria(ac: string, suggestions: string[]): number {
    if (!ac) return 0;

    let score = 5; // Base points

    // Count criteria lines
    const lines = ac.split('\n').filter((l) => l.trim());
    if (lines.length >= 5) {
      score += 8;
    } else if (lines.length >= 3) {
      score += 5;
    } else {
      suggestions.push('Add more acceptance criteria (aim for 3-5 points)');
    }

    // BDD format (Given/When/Then)
    const hasGiven = /given/i.test(ac);
    const hasWhen = /when/i.test(ac);
    const hasThen = /then/i.test(ac);

    if (hasGiven && hasWhen && hasThen) {
      score += 12;
    } else if (hasGiven || hasThen) {
      score += 6;
      suggestions.push('Use complete Given/When/Then format');
    } else {
      suggestions.push('Use Given/When/Then format for acceptance criteria');
    }

    // Contains verification keywords
    if (/\b(should|must|verify|ensure|expect)\b/i.test(ac)) {
      score += 5;
    }

    return Math.min(score, 30);
  }

  /**
   * Score context documents (0-10 pts)
   */
  private scoreContextDocuments(desc: string, suggestions: string[]): number {
    let score = 0;

    // Links present
    if (/https?:\/\//.test(desc)) {
      score += 5;
    }

    // Document references
    if (
      /\.(pdf|md|doc|docx)/i.test(desc) ||
      /architecture|design doc|spec|requirement/i.test(desc)
    ) {
      score += 5;
    }

    if (score < 5) {
      suggestions.push('Attach relevant context documents or links');
    }

    return Math.min(score, 10);
  }

  /**
   * Score task complexity indicators (0-10 pts)
   */
  private scoreComplexity(ticket: IParsedTicket, suggestions: string[]): number {
    let score = 0;

    // Has tags
    if (ticket.tags?.length > 0) {
      score += 5;
    } else {
      suggestions.push('Add tags (feature, bugfix, refactor, etc.)');
    }

    // Has priority
    if (ticket.priority) {
      score += 3;
    }

    // File path references
    if (/src\/|\.ts\b|\.js\b|\.py\b/i.test(ticket.description)) {
      score += 2;
    }

    return Math.min(score, 10);
  }

  /**
   * Score prerequisites/dependencies (0-10 pts)
   */
  private scorePrerequisites(desc: string, suggestions: string[]): number {
    let score = 0;

    // Mentions dependencies
    if (/prerequisite|depends on|blocked by|requires|after story/i.test(desc)) {
      score += 5;
    }

    // Story/issue references
    if (/story\s+\d|#\d+|issue\s+\d/i.test(desc)) {
      score += 5;
    }

    if (score < 5) {
      suggestions.push('List any prerequisites or dependencies');
    }

    return Math.min(score, 10);
  }

  // ============================================================
  // Story 2.11: PM-Facing Quality Scoring API Methods
  // ============================================================

  /**
   * Calculate enhanced quality score for PM API with caching
   * FR4: PMs can view ticket quality score before submitting
   */
  async calculateScoreEnhanced(
    input: IQualityScoreInput,
    correlationId: string,
  ): Promise<QualityScoreResponseDto> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';

    // Check cache
    const cacheKey = this.getCacheKey(input);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug(`${logPrefix} Cache hit for quality score`);
      return cached;
    }

    // Calculate enhanced breakdown with details
    const breakdown = this.calculateEnhancedBreakdown(input);

    // Calculate total score
    const totalScore =
      breakdown.titleClarity.score +
      breakdown.descriptionCompleteness.score +
      breakdown.acceptanceCriteria.score +
      breakdown.contextDocuments.score +
      breakdown.taskComplexity.score +
      breakdown.prerequisites.score;

    const grade = this.calculateGrade(totalScore);
    const { gradeEmoji, gradeMessage } = this.getGradeDetails(grade);

    const result: QualityScoreResponseDto = {
      totalScore,
      grade,
      gradeEmoji,
      gradeMessage,
      breakdown,
      topSuggestions: this.aggregateSuggestions(breakdown),
      meetsMinimumThreshold: totalScore >= this.thresholds.minimum,
      scoredAt: new Date().toISOString(),
    };

    // Record metrics
    if (this.qualityScoreHistogram) {
      this.qualityScoreHistogram.observe({ grade }, totalScore);
    }

    // Cache result
    this.setCache(cacheKey, result);

    this.logger.log(`${logPrefix} Quality score: ${totalScore}/100 (${grade})`);
    return result;
  }

  /**
   * Quick score - returns score and grade only
   */
  async quickScore(
    input: IQualityScoreInput,
    correlationId: string,
  ): Promise<QuickScoreResponseDto> {
    const result = await this.calculateScoreEnhanced(input, correlationId);
    return {
      score: result.totalScore,
      grade: result.grade,
    };
  }

  /**
   * Batch score multiple tickets
   */
  async batchScoreEnhanced(
    inputs: IQualityScoreInput[],
    correlationId: string,
  ): Promise<QualityScoreResponseDto[]> {
    return Promise.all(
      inputs.map((input, idx) => this.calculateScoreEnhanced(input, `${correlationId}-${idx}`)),
    );
  }

  // ============================================================
  // Private Helper Methods for Enhanced Scoring
  // ============================================================

  /**
   * Calculate enhanced breakdown with category details
   */
  private calculateEnhancedBreakdown(input: IQualityScoreInput): {
    titleClarity: ICategoryScore;
    descriptionCompleteness: ICategoryScore;
    acceptanceCriteria: ICategoryScore;
    contextDocuments: ICategoryScore;
    taskComplexity: ICategoryScore;
    prerequisites: ICategoryScore;
  } {
    return {
      titleClarity: this.scoreTitleClarityEnhanced(input.title),
      descriptionCompleteness: this.scoreDescriptionEnhanced(input.description),
      acceptanceCriteria: this.scoreAcceptanceCriteriaEnhanced(input.acceptanceCriteria),
      contextDocuments: this.scoreContextDocumentsEnhanced(
        input.description,
        input.contextDocuments,
      ),
      taskComplexity: this.scoreComplexityEnhanced(input),
      prerequisites: this.scorePrerequisitesEnhanced(input.description, input.prerequisites),
    };
  }

  /**
   * Enhanced title clarity scoring with detailed feedback
   */
  private scoreTitleClarityEnhanced(title: string): ICategoryScore {
    const maxPoints = 15;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    if (!title || title.trim().length === 0) {
      return this.createCategoryScore('titleClarity', 0, maxPoints, ['Title is required'], '');
    }

    // Word count: 5 pts for 3-15 words
    const words = title
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length >= 3 && words.length <= 15) {
      score += 5;
      details.push(`Word count (${words.length}) optimal`);
    } else if (words.length < 3) {
      suggestions.push('Title too short - add more context (3-15 words recommended)');
    } else {
      score += 2;
      suggestions.push('Title is long - consider being more concise');
    }

    // Action verb: 5 pts
    const actionVerbs = [
      'implement',
      'create',
      'add',
      'update',
      'fix',
      'remove',
      'refactor',
      'integrate',
      'configure',
      'setup',
      'build',
      'design',
      'test',
      'migrate',
      'optimize',
      'enhance',
      'enable',
      'disable',
      'validate',
      'process',
    ];
    if (actionVerbs.some((v) => title.toLowerCase().includes(v))) {
      score += 5;
      details.push('Has action verb');
    } else {
      suggestions.push('Start with action verb (Implement, Create, Add, Fix, Update)');
    }

    // Specificity: 5 pts
    const specificPatterns = [
      /\b(api|endpoint|service|controller|module|component)\b/i,
      /\b(auth|user|admin|payment|dashboard|report)\b/i,
      /\b(database|queue|cache|webhook|integration)\b/i,
    ];
    const matches = specificPatterns.filter((p) => p.test(title)).length;
    if (matches >= 2) {
      score += 5;
      details.push('Highly specific');
    } else if (matches === 1) {
      score += 3;
      suggestions.push('Add more specific context (component/feature affected)');
    } else {
      suggestions.push('Specify feature or component affected');
    }

    return this.createCategoryScore(
      'titleClarity',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; '),
    );
  }

  /**
   * Enhanced description scoring
   */
  private scoreDescriptionEnhanced(desc: string): ICategoryScore {
    const maxPoints = 25;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    if (!desc || desc.trim().length === 0) {
      return this.createCategoryScore(
        'descriptionCompleteness',
        0,
        maxPoints,
        ['Description is required'],
        '',
      );
    }

    // Length: 8 pts
    if (desc.length >= 200) {
      score += 8;
      details.push('Good length');
    } else if (desc.length >= 100) {
      score += 5;
      suggestions.push('Add more detail (200+ characters recommended)');
    } else {
      score += 2;
      suggestions.push('Description too brief - explain context and requirements');
    }

    // Structure: 6 pts
    if (desc.includes('\n') || /[-*]\s+/.test(desc)) {
      score += 6;
      details.push('Well structured');
    } else {
      suggestions.push('Use lists or paragraphs for better structure');
    }

    // Reasoning (why): 6 pts
    if (/\b(because|so that|in order to|to enable|allows|this is needed)\b/i.test(desc)) {
      score += 6;
      details.push('Explains reasoning');
    } else {
      suggestions.push('Explain WHY this feature/fix is needed');
    }

    // Technical context: 5 pts
    if (/\b(src\/|\.ts|\.js|module|service|controller|endpoint|api)\b/i.test(desc)) {
      score += 5;
      details.push('Has technical context');
    } else {
      suggestions.push('Reference relevant code paths or technical components');
    }

    return this.createCategoryScore(
      'descriptionCompleteness',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; '),
    );
  }

  /**
   * Enhanced acceptance criteria scoring
   */
  private scoreAcceptanceCriteriaEnhanced(ac: string): ICategoryScore {
    const maxPoints = 30;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    if (!ac || ac.trim().length === 0) {
      return this.createCategoryScore(
        'acceptanceCriteria',
        0,
        maxPoints,
        ['Acceptance criteria are required'],
        '',
      );
    }

    // Count criteria: 8 pts
    const lines = ac.split('\n').filter((l) => l.trim().length > 0);
    const criteriaCount = lines.length;
    if (criteriaCount >= 5) {
      score += 8;
      details.push(`${criteriaCount} criteria defined`);
    } else if (criteriaCount >= 3) {
      score += 5;
      details.push(`${criteriaCount} criteria`);
      suggestions.push('Add more criteria (5+ recommended)');
    } else {
      score += 2;
      suggestions.push('Too few criteria - aim for 3-5 acceptance criteria');
    }

    // BDD format: 12 pts
    const hasGiven = /given/i.test(ac);
    const hasWhen = /when/i.test(ac);
    const hasThen = /then/i.test(ac);
    if (hasGiven && hasWhen && hasThen) {
      score += 12;
      details.push('BDD format');
    } else if (hasGiven || hasThen) {
      score += 6;
      suggestions.push('Use complete Given/When/Then format');
    } else {
      suggestions.push('Use Given/When/Then format for testability');
    }

    // Measurability: 5 pts
    if (/\b(\d+\s*(ms|seconds|minutes|%|requests|items))\b/i.test(ac)) {
      score += 5;
      details.push('Has measurable criteria');
    } else {
      suggestions.push('Include measurable criteria (timeouts, limits, quantities)');
    }

    // Edge cases: 5 pts
    if (/\b(error|invalid|fail|edge|boundary|empty|null|missing)\b/i.test(ac)) {
      score += 5;
      details.push('Covers edge cases');
    } else {
      suggestions.push('Define behavior for error cases and edge conditions');
    }

    return this.createCategoryScore(
      'acceptanceCriteria',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; '),
    );
  }

  /**
   * Enhanced context documents scoring
   */
  private scoreContextDocumentsEnhanced(desc: string, contextDocs?: string[]): ICategoryScore {
    const maxPoints = 10;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    // Has attached documents: 4 pts
    if (contextDocs && contextDocs.length > 0) {
      score += 4;
      details.push(`${contextDocs.length} doc(s) attached`);
      if (contextDocs.length >= 2) {
        score += 2;
      }
    }

    // Links in description: 2 pts
    if (/https?:\/\//.test(desc)) {
      score += 2;
      details.push('Has links');
    }

    // Document references: 2 pts
    if (/\.(pdf|md|doc|docx|spec)/i.test(desc) || /architecture|design|spec/i.test(desc)) {
      score += 2;
      details.push('References docs');
    }

    if (score < 4) {
      suggestions.push('Attach relevant context documents (specs, designs, references)');
    }

    return this.createCategoryScore(
      'contextDocuments',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; ') || 'No context documents',
    );
  }

  /**
   * Enhanced complexity scoring
   */
  private scoreComplexityEnhanced(input: IQualityScoreInput): ICategoryScore {
    const maxPoints = 10;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    // Has tags: 5 pts
    if (input.tags && input.tags.length > 0) {
      score += 5;
      details.push(`Tags: ${input.tags.join(', ')}`);
    } else {
      suggestions.push('Add tags (feature, bugfix, refactor, security, etc.)');
    }

    // Technical area identified: 3 pts
    const techPatterns = /\b(api|database|auth|ui|backend|frontend|queue|cache)\b/i;
    if (techPatterns.test(input.description) || techPatterns.test(input.title)) {
      score += 3;
      details.push('Tech area identified');
    }

    // Scope indicators: 2 pts
    const scopePatterns = /\b(module|service|controller|component|endpoint)\b/i;
    if (scopePatterns.test(input.description) || scopePatterns.test(input.title)) {
      score += 2;
      details.push('Scope defined');
    }

    return this.createCategoryScore(
      'taskComplexity',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; ') || 'No complexity indicators',
    );
  }

  /**
   * Enhanced prerequisites scoring
   */
  private scorePrerequisitesEnhanced(desc: string, prerequisites?: string[]): ICategoryScore {
    const maxPoints = 10;
    const suggestions: string[] = [];
    const details: string[] = [];
    let score = 0;

    // Explicit prerequisites: 5 pts
    if (prerequisites && prerequisites.length > 0) {
      score += 5;
      details.push(`${prerequisites.length} prerequisite(s)`);
    }

    // Dependency mentions: 3 pts
    if (/prerequisite|depends on|blocked by|requires|after story/i.test(desc)) {
      score += 3;
      details.push('Dependencies noted');
    }

    // Story/issue references: 2 pts
    if (/story\s*\d|#\d+|issue\s*\d|ticket\s*\d/i.test(desc)) {
      score += 2;
      details.push('Has references');
    }

    if (score < 3) {
      suggestions.push('List any prerequisites, dependencies, or blocking issues');
    }

    return this.createCategoryScore(
      'prerequisites',
      Math.min(score, maxPoints),
      maxPoints,
      suggestions,
      details.join('; ') || 'None specified (may be standalone)',
    );
  }

  /**
   * Create category score object
   */
  private createCategoryScore(
    category: string,
    score: number,
    maxPoints: number,
    suggestions: string[],
    details: string,
  ): ICategoryScore {
    return {
      category,
      score,
      maxPoints,
      percentage: Math.round((score / maxPoints) * 100),
      suggestions,
      details,
    };
  }

  /**
   * Get grade details (emoji and message)
   */
  private getGradeDetails(grade: QualityGrade): { gradeEmoji: string; gradeMessage: string } {
    const gradeMap = new Map<QualityGrade, { gradeEmoji: string; gradeMessage: string }>([
      [
        'excellent',
        {
          gradeEmoji: '✅',
          gradeMessage: 'Excellent! Well-defined and ready for AI processing.',
        },
      ],
      [
        'good',
        {
          gradeEmoji: '👍',
          gradeMessage: 'Good quality. Minor improvements could enhance clarity.',
        },
      ],
      [
        'fair',
        {
          gradeEmoji: '⚠️',
          gradeMessage: 'Fair quality. Address suggestions before submitting.',
        },
      ],
      [
        'poor',
        {
          gradeEmoji: '❌',
          gradeMessage: 'Poor quality. Significant improvements needed.',
        },
      ],
    ]);
    return gradeMap.get(grade) ?? { gradeEmoji: '❓', gradeMessage: 'Unknown quality grade.' };
  }

  /**
   * Aggregate top suggestions from all categories
   */
  private aggregateSuggestions(breakdown: {
    titleClarity: ICategoryScore;
    descriptionCompleteness: ICategoryScore;
    acceptanceCriteria: ICategoryScore;
    contextDocuments: ICategoryScore;
    taskComplexity: ICategoryScore;
    prerequisites: ICategoryScore;
  }): string[] {
    // Priority order: AC > Description > Title > Prerequisites > Complexity > Context
    const priority: (keyof typeof breakdown)[] = [
      'acceptanceCriteria',
      'descriptionCompleteness',
      'titleClarity',
      'prerequisites',
      'taskComplexity',
      'contextDocuments',
    ];

    const suggestions: string[] = [];
    const breakdownMap = new Map(Object.entries(breakdown));
    for (const cat of priority) {
      const category = breakdownMap.get(cat) as ICategoryScore | undefined;
      if (category && category.percentage < 100) {
        suggestions.push(...category.suggestions);
      }
      if (suggestions.length >= 5) break;
    }
    return suggestions.slice(0, 5);
  }

  // ============================================================
  // Cache Helper Methods
  // ============================================================

  /**
   * Generate cache key from input
   */
  private getCacheKey(input: IQualityScoreInput): string {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').substring(0, 16);
    return `quality:${hash}`;
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache(key: string): QualityScoreResponseDto | null {
    // Periodically cleanup expired entries (every 100 cache operations)
    if (this.cache.size > 0 && Math.random() < 0.01) {
      this.cleanupExpiredEntries();
    }

    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data;
    }
    if (entry) {
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Set cache entry with TTL
   */
  private setCache(key: string, data: QualityScoreResponseDto): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Cleanup expired cache entries to prevent memory leaks
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cache cleanup: removed ${cleanedCount} expired entries`);
    }
  }
}
