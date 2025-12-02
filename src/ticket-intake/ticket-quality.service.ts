import { Injectable, Logger } from '@nestjs/common';
import { IParsedTicket } from './interfaces';
import { QualityScoreDto, QualityScoreBreakdownDto } from './dto';

/**
 * Ticket Quality Scoring Service
 * FR58: Validate ticket quality - scoring system
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
   * Calculate grade from total score
   */
  private calculateGrade(totalScore: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (totalScore >= 90) return 'excellent';
    if (totalScore >= 70) return 'good';
    if (totalScore >= 50) return 'fair';
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
}
