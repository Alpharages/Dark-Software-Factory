import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface EscalationInput {
  aiConfidence?: number;
  aiResponse: string;
  context?: string;
  aiProvider?: string;
}

export interface EscalationResult {
  shouldEscalate: boolean;
  reason?: string;
  metadata?: EscalationMetadata;
}

export interface EscalationMetadata {
  questions: string[];
  alternatives: string[];
  tradeOffs: Record<string, { pros: string[]; cons: string[] }>;
  confidence: number;
  aiRecommendation?: string;
}

export enum EscalationReason {
  LOW_CONFIDENCE = 'LOW_CONFIDENCE',
  MISSING_CONTEXT = 'MISSING_CONTEXT',
  CONFLICTING_REQUIREMENTS = 'CONFLICTING_REQUIREMENTS',
  NO_BEST_PRACTICE = 'NO_BEST_PRACTICE',
  SECURITY_CONCERN = 'SECURITY_CONCERN',
  PERFORMANCE_TRADEOFF = 'PERFORMANCE_TRADEOFF',
  MULTIPLE_VALID_APPROACHES = 'MULTIPLE_VALID_APPROACHES',
}

@Injectable()
export class EscalationDetectorService {
  private readonly logger = new Logger(EscalationDetectorService.name);
  private readonly DEFAULT_THRESHOLD = 0.7; // 70% confidence threshold

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determine if an AI architecture decision should be escalated to TL
   * @param input - AI decision input containing confidence, response, and context
   * @returns Escalation result with reason and metadata
   */
  shouldEscalate(input: EscalationInput): EscalationResult {
    const threshold = this.DEFAULT_THRESHOLD; // Will be made dynamic in implementation

    // Primary: Check explicit confidence score
    if (input.aiConfidence !== undefined && input.aiConfidence < threshold) {
      return {
        shouldEscalate: true,
        reason: EscalationReason.LOW_CONFIDENCE,
        metadata: this.extractMetadata(input.aiResponse, input.context || ''),
      };
    }

    // Heuristic: Detect multiple valid approaches
    if (this.detectMultipleApproaches(input.aiResponse)) {
      return {
        shouldEscalate: true,
        reason: EscalationReason.MULTIPLE_VALID_APPROACHES,
        metadata: this.extractMetadata(input.aiResponse, input.context || ''),
      };
    }

    // Heuristic: Detect uncertainty phrases
    if (this.detectUncertaintyPhrases(input.aiResponse)) {
      return {
        shouldEscalate: true,
        reason: this.categorizeReason(input),
        metadata: this.extractMetadata(input.aiResponse, input.context || ''),
      };
    }

    // Heuristic: Detect security concerns
    if (this.detectSecurityConcern(input.aiResponse, input.context)) {
      return {
        shouldEscalate: true,
        reason: EscalationReason.SECURITY_CONCERN,
        metadata: this.extractMetadata(input.aiResponse, input.context || ''),
      };
    }

    // Heuristic: Detect conflicting requirements
    if (this.detectConflictingRequirements(input.aiResponse, input.context)) {
      return {
        shouldEscalate: true,
        reason: EscalationReason.CONFLICTING_REQUIREMENTS,
        metadata: this.extractMetadata(input.aiResponse, input.context || ''),
      };
    }

    return { shouldEscalate: false };
  }

  /**
   * Get escalation threshold for a project (with fallback to default)
   * @param projectId - Project ID
   * @returns Escalation confidence threshold (0-1)
   */
  async getEscalationThreshold(projectId: string): Promise<number> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { escalation_threshold: true } as { escalation_threshold: boolean },
      });

      return (
        (project as { escalation_threshold?: number })?.escalation_threshold ||
        this.DEFAULT_THRESHOLD
      );
    } catch (_error) {
      this.logger.warn(
        `Failed to fetch escalation threshold for project ${projectId}, using default`,
      );
      return this.DEFAULT_THRESHOLD;
    }
  }

  /**
   * Extract escalation metadata from AI response
   * @param aiResponse - AI's response text
   * @param context - Decision context
   * @returns Extracted metadata (questions, alternatives, trade-offs)
   */
  extractMetadata(aiResponse: string, _context: string): EscalationMetadata {
    const metadata: EscalationMetadata = {
      questions: this.extractQuestions(aiResponse),
      alternatives: this.extractAlternatives(aiResponse),
      tradeOffs: this.extractTradeOffs(aiResponse),
      confidence: 0,
    };

    // Extract AI recommendation if present
    const recommendationMatch = aiResponse.match(
      /(?:recommend|suggestion|propose)[:\s]+(.*?)(?:\.|$)/is,
    );
    if (recommendationMatch) {
      metadata.aiRecommendation = recommendationMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Categorize the escalation reason based on input patterns
   * @param input - Escalation input
   * @returns Categorized reason enum value
   */
  categorizeReason(input: EscalationInput): string {
    const response = input.aiResponse.toLowerCase();

    // Check confidence first
    if (input.aiConfidence !== undefined && input.aiConfidence < this.DEFAULT_THRESHOLD) {
      return EscalationReason.LOW_CONFIDENCE;
    }

    // Pattern matching for categorization
    if (
      response.includes('without more') ||
      response.includes('need more information') ||
      response.includes('unclear') ||
      response.includes('ambiguous')
    ) {
      return EscalationReason.MISSING_CONTEXT;
    }

    if (
      response.includes('performance') &&
      (response.includes('trade') || response.includes('impact'))
    ) {
      return EscalationReason.PERFORMANCE_TRADEOFF;
    }

    if (response.includes('conflict') || response.includes('contradict')) {
      return EscalationReason.CONFLICTING_REQUIREMENTS;
    }

    if (
      response.includes('security') ||
      response.includes('authentication') ||
      response.includes('authorization')
    ) {
      return EscalationReason.SECURITY_CONCERN;
    }

    if (response.includes('no standard') || response.includes('no best practice')) {
      return EscalationReason.NO_BEST_PRACTICE;
    }

    return EscalationReason.LOW_CONFIDENCE;
  }

  /**
   * Detect if AI response mentions multiple valid approaches
   */
  private detectMultipleApproaches(response: string): boolean {
    const approachPatterns = [
      /approach \d+/gi,
      /alternative \d+/gi,
      /option \d+/gi,
      /could (?:go with|use|choose)/gi,
    ];

    const matches = approachPatterns.reduce((count, pattern) => {
      const found = response.match(pattern);
      return count + (found ? found.length : 0);
    }, 0);

    return matches >= 2; // At least 2 approaches mentioned
  }

  /**
   * Detect uncertainty phrases in AI response
   */
  private detectUncertaintyPhrases(response: string): boolean {
    const uncertaintyPhrases = [
      'unsure',
      'uncertain',
      'not sure',
      'unclear',
      'depends on',
      'could go either way',
      'might be better',
      'difficult to determine',
    ];

    const lowerResponse = response.toLowerCase();
    return uncertaintyPhrases.some((phrase) => lowerResponse.includes(phrase));
  }

  /**
   * Detect security concerns in decision context
   */
  private detectSecurityConcern(response: string, context?: string): boolean {
    const securityKeywords = [
      'security',
      'authentication',
      'authorization',
      'encryption',
      'credential',
      'token',
      'secret',
    ];

    const text = `${response} ${context || ''}`.toLowerCase();
    return securityKeywords.some((keyword) => text.includes(keyword));
  }

  /**
   * Detect conflicting requirements in response
   */
  private detectConflictingRequirements(response: string, context?: string): boolean {
    const conflictKeywords = ['conflict', 'contradict', 'at odds', 'mutually exclusive'];
    const text = `${response} ${context || ''}`.toLowerCase();
    return conflictKeywords.some((keyword) => text.includes(keyword));
  }

  /**
   * Extract questions from AI response
   */
  private extractQuestions(response: string): string[] {
    const questions: string[] = [];
    const lines = response.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.endsWith('?') ||
        trimmed.toLowerCase().startsWith('what ') ||
        trimmed.toLowerCase().startsWith('how ') ||
        trimmed.toLowerCase().startsWith('are we')
      ) {
        questions.push(trimmed);
      }
    }

    return questions;
  }

  /**
   * Extract alternatives from AI response
   */
  private extractAlternatives(response: string): string[] {
    const alternatives: string[] = [];
    const patterns = [
      /alternative \d+[:\s]+(.*?)(?:\n|$)/gi,
      /approach \d+[:\s]+(.*?)(?:\n|$)/gi,
      /option \d+[:\s]+(.*?)(?:\n|$)/gi,
    ];

    for (const pattern of patterns) {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          alternatives.push(match[1].trim());
        }
      }
    }

    return alternatives;
  }

  /**
   * Extract trade-offs (pros/cons) from AI response
   */
  private extractTradeOffs(response: string): Record<string, { pros: string[]; cons: string[] }> {
    const tradeOffs: Record<string, { pros: string[]; cons: string[] }> = {};

    // Simple pattern matching for pros/cons
    const prosMatches = response.matchAll(/pros(?:\s+of\s+(\w+))?[:\s]+(.*?)(?=cons|$)/gis);
    const consMatches = response.matchAll(/cons(?:\s+of\s+(\w+))?[:\s]+(.*?)(?=pros|$)/gis);

    for (const match of prosMatches) {
      const option = match[1] || 'general';
      const prosText = match[2].trim();

      // eslint-disable-next-line security/detect-object-injection
      if (!tradeOffs[option]) {
        // eslint-disable-next-line security/detect-object-injection
        tradeOffs[option] = { pros: [], cons: [] };
      }

      // Split by common separators
      // eslint-disable-next-line security/detect-object-injection
      tradeOffs[option].pros = prosText
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }

    for (const match of consMatches) {
      const option = match[1] || 'general';
      const consText = match[2].trim();

      // eslint-disable-next-line security/detect-object-injection
      if (!tradeOffs[option]) {
        // eslint-disable-next-line security/detect-object-injection
        tradeOffs[option] = { pros: [], cons: [] };
      }

      // eslint-disable-next-line security/detect-object-injection
      tradeOffs[option].cons = consText
        .split(/[,\n]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    }

    return tradeOffs;
  }
}
