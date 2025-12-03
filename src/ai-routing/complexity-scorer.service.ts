import { Injectable, Logger } from '@nestjs/common';
import { IComplexityBreakdown, IRoutingRequest } from './interfaces';

/**
 * Complexity Scoring Algorithm
 *
 * Per architecture.md Multi-Provider Strategy:
 * - Score 0-20 based on 5 factors (0-4 each)
 * - Score >= 10: High complexity → Cursor CLI Headless
 * - Score < 10: Low/Medium → Claude Code
 *
 * FR60: System routes to appropriate AI tool based on task complexity
 */
@Injectable()
export class ComplexityScorerService {
  private readonly logger = new Logger(ComplexityScorerService.name);

  // Keywords that indicate complexity levels
  private readonly COMPLEX_KEYWORDS = [
    'refactor',
    'architecture',
    'redesign',
    'migration',
    'complex',
    'multi-file',
    'cross-module',
    'integration',
    'database schema',
    'api design',
    'performance optimization',
    'security audit',
  ];

  private readonly SIMPLE_KEYWORDS = [
    'bugfix',
    'fix',
    'typo',
    'simple',
    'minor',
    'quick',
    'add comment',
    'update text',
    'rename',
    'format',
  ];

  private readonly ARCHITECTURE_KEYWORDS = [
    'architecture',
    'database',
    'schema',
    'migration',
    'api',
    'module',
    'service',
    'provider',
    'factory',
    'pattern',
    'restructure',
    'redesign',
    'new module',
    'new service',
  ];

  /**
   * Calculate complexity score for a ticket
   * Returns breakdown with 0-20 total score
   */
  calculateComplexity(request: IRoutingRequest, correlationId: string): IComplexityBreakdown {
    this.logger.debug(`[${correlationId}] Calculating complexity for ticket ${request.ticketId}`);

    const content =
      `${request.title} ${request.description} ${request.acceptanceCriteria}`.toLowerCase();
    const tags = request.tags.map((t) => t.toLowerCase());

    // 1. File count estimation (0-4 points)
    const fileCount = this.estimateFileCount(content);
    const fileCountScore = this.scoreFileCount(fileCount);

    // 2. Architecture changes (0-4 points)
    const architectureChanges = this.detectArchitectureChanges(content, tags);
    const architectureScore = architectureChanges ? 4 : 0;

    // 3. Cross-file dependencies (0-4 points)
    const dependencyLevel = this.assessDependencies(content, tags);
    const dependencyScore = this.scoreDependency(dependencyLevel);

    // 4. Estimated LOC (0-4 points)
    const estimatedLoc = this.estimateLinesOfCode(content, request.acceptanceCriteria);
    const locScore = this.scoreEstimatedLoc(estimatedLoc);

    // 5. Tag-based complexity (0-4 points)
    const tagComplexity = this.assessTagComplexity(content, tags);
    const tagScore = this.scoreTagComplexity(tagComplexity);

    const totalScore = fileCountScore + architectureScore + dependencyScore + locScore + tagScore;

    const breakdown: IComplexityBreakdown = {
      fileCount,
      fileCountScore,
      architectureChanges,
      architectureScore,
      dependencyLevel,
      dependencyScore,
      estimatedLoc,
      locScore,
      tagComplexity,
      tagScore,
      totalScore,
    };

    this.logger.log(
      `[${correlationId}] Complexity score: ${totalScore}/20 ` +
        `(files=${fileCountScore}, arch=${architectureScore}, deps=${dependencyScore}, ` +
        `loc=${locScore}, tags=${tagScore})`,
    );

    return breakdown;
  }

  /**
   * Estimate number of files to modify
   */
  private estimateFileCount(content: string): number {
    // Look for file path patterns
    const filePatterns = content.match(/\b[\w-]+\.(ts|js|tsx|jsx|py|java|go|rs)\b/gi) || [];
    const uniqueFiles = [...new Set(filePatterns)];

    // Look for "files" mentions
    const multiFileMatch = content.match(/(\d+)\s*(files?|components?|modules?|services?)/i);
    if (multiFileMatch) {
      return Math.max(parseInt(multiFileMatch[1], 10), uniqueFiles.length);
    }

    // Keywords suggesting multiple files
    if (/multiple files|several files|across files|various files/i.test(content)) {
      return Math.max(3, uniqueFiles.length);
    }

    if (/single file|one file|only file/i.test(content)) {
      return 1;
    }

    // Default based on content length and complexity indicators
    if (uniqueFiles.length > 0) return uniqueFiles.length;
    if (content.length > 1000) return 2;
    return 1;
  }

  private scoreFileCount(count: number): number {
    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count >= 3) return 4;
    return 2;
  }

  /**
   * Detect if architecture changes are required
   */
  private detectArchitectureChanges(content: string, tags: string[]): boolean {
    // Check tags first (most reliable)
    if (tags.some((t) => ['architecture', 'design', 'schema', 'migration'].includes(t))) {
      return true;
    }

    // Check content for architecture keywords
    return this.ARCHITECTURE_KEYWORDS.some((keyword) => content.includes(keyword));
  }

  /**
   * Assess cross-file dependency level
   */
  private assessDependencies(content: string, tags: string[]): 'low' | 'medium' | 'high' {
    // High dependency indicators
    if (
      tags.includes('integration') ||
      /cross-module|multiple services|api changes|database changes|shared state/i.test(content)
    ) {
      return 'high';
    }

    // Medium dependency indicators
    if (
      /import from|depends on|requires|updates? interface|changes? contract/i.test(content) ||
      /affects? other|impacts? other/i.test(content)
    ) {
      return 'medium';
    }

    return 'low';
  }

  private scoreDependency(level: 'low' | 'medium' | 'high'): number {
    switch (level) {
      case 'low':
        return 1;
      case 'medium':
        return 2;
      case 'high':
        return 4;
    }
  }

  /**
   * Estimate lines of code to change
   */
  private estimateLinesOfCode(content: string, acceptanceCriteria: string): number {
    // Count acceptance criteria points (rough estimate: 20 LOC per AC point)
    const acPoints = (acceptanceCriteria.match(/^[-*•]\s/gm) || []).length;
    const acEstimate = acPoints * 20;

    // Look for explicit LOC mentions
    const locMatch = content.match(/(\d+)\s*(lines?|loc)\b/i);
    if (locMatch) {
      return parseInt(locMatch[1], 10);
    }

    // Keywords suggesting large changes
    if (/large|extensive|major|significant/i.test(content)) {
      return Math.max(200, acEstimate);
    }

    if (/small|minor|quick|simple/i.test(content)) {
      return Math.min(50, acEstimate || 30);
    }

    // Default based on AC points
    if (acEstimate > 0) return acEstimate;

    // Fallback based on description length
    return content.length > 500 ? 100 : 50;
  }

  private scoreEstimatedLoc(loc: number): number {
    if (loc < 50) return 1;
    if (loc < 100) return 2;
    if (loc < 200) return 3;
    return 4;
  }

  /**
   * Assess complexity from content and tags
   */
  private assessTagComplexity(content: string, tags: string[]): 'simple' | 'medium' | 'complex' {
    // Check tags first
    if (tags.some((t) => ['complex', 'architecture', 'refactor', 'migration'].includes(t))) {
      return 'complex';
    }
    if (tags.some((t) => ['simple', 'bugfix', 'minor', 'quick'].includes(t))) {
      return 'simple';
    }

    // Check content keywords
    const hasComplexKeywords = this.COMPLEX_KEYWORDS.some((kw) => content.includes(kw));
    const hasSimpleKeywords = this.SIMPLE_KEYWORDS.some((kw) => content.includes(kw));

    if (hasComplexKeywords && !hasSimpleKeywords) return 'complex';
    if (hasSimpleKeywords && !hasComplexKeywords) return 'simple';

    return 'medium';
  }

  private scoreTagComplexity(complexity: 'simple' | 'medium' | 'complex'): number {
    switch (complexity) {
      case 'simple':
        return 1;
      case 'medium':
        return 2;
      case 'complex':
        return 4;
    }
  }
}
