/**
 * QA Sampling Strategy Service
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * Implements multiple sampling strategies:
 * - Percentage-based: Random sampling at configured percentage
 * - Risk-based: Applies multipliers based on risk factors
 * - Composite: Combines all enabled strategies
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskLevel } from '@/prisma/client';
import { LoggerService } from '../../common/logger/logger.service';
import {
  ISamplingStrategy,
  ISamplingConfig,
  ITicketData,
  ISamplingDecision,
  IRiskScore,
  IRiskRules,
  IFileCountRiskRule,
  IComplexityRiskRule,
  IAIProviderRiskRule,
  SamplingStrategy,
} from '../interfaces/qa-sampling.interface';

/**
 * Default risk rules
 * AC#2: Risk factors are cumulative (multiplicative)
 * - Files changed > 10: HIGH risk (always include in sample)
 * - Files changed 5-10: MEDIUM risk (2x sampling probability)
 * - Complexity score ≥ 10: HIGH risk (always include)
 * - Complexity score 5-9: MEDIUM risk (1.5x sampling probability)
 * - AI Provider = Gemini: MEDIUM risk (1.2x sampling probability)
 */
const DEFAULT_RISK_RULES: IRiskRules = {
  fileCount: {
    highThreshold: 10,
    mediumThreshold: 5,
    highMultiplier: 100, // Always sample
    mediumMultiplier: 2.0, // 2x probability
  },
  complexity: {
    highThreshold: 10,
    mediumThreshold: 5,
    highMultiplier: 100, // Always sample
    mediumMultiplier: 1.5, // 1.5x probability
  },
  aiProvider: {
    geminiMultiplier: 1.2, // 1.2x probability
    claudeMultiplier: 1.0,
  },
};

/**
 * Percentage-based sampling strategy
 * Simple random sampling at configured percentage
 */
@Injectable()
export class PercentageSamplingStrategy implements ISamplingStrategy {
  shouldSample(ticket: ITicketData, config: ISamplingConfig): ISamplingDecision {
    const probability = config.percentage / 100;
    const sampled = Math.random() < probability;

    return {
      sample: sampled,
      riskLevel: RiskLevel.LOW,
      riskFactors: [],
      samplingStrategy: SamplingStrategy.PERCENTAGE,
      probability,
    };
  }
}

/**
 * Risk scoring service
 * Calculates risk score and cumulative multiplier based on ticket attributes
 * AC#2: Risk factors are cumulative (multiplicative)
 */
@Injectable()
export class RiskScoringService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Calculate risk score and multiplier for a ticket
   * @param ticket - Ticket data
   * @param rules - Risk rules configuration
   * @returns Risk score result with cumulative multiplier
   */
  calculateRiskScore(ticket: ITicketData, rules: IRiskRules = DEFAULT_RISK_RULES): IRiskScore {
    let score = 0;
    let cumulativeMultiplier = 1.0;
    const factors: string[] = [];

    // File count risk evaluation
    const fileCountResult = this.evaluateFileCountRisk(
      ticket.filesChanged,
      rules.fileCount,
      factors,
    );
    score += fileCountResult.score;
    cumulativeMultiplier *= fileCountResult.multiplier;

    // Complexity risk evaluation
    const complexityResult = this.evaluateComplexityRisk(
      ticket.complexityScore,
      rules.complexity,
      factors,
    );
    score += complexityResult.score;
    cumulativeMultiplier *= complexityResult.multiplier;

    // AI Provider risk evaluation
    const providerMultiplier = this.evaluateProviderRisk(
      ticket.aiProvider,
      rules.aiProvider,
      factors,
    );
    cumulativeMultiplier *= providerMultiplier;

    // Determine risk level based on score (HIGH = always sample)
    let level: RiskLevel;
    if (score >= 100) {
      level = RiskLevel.HIGH;
    } else if (score >= 20 || cumulativeMultiplier >= 1.5) {
      level = RiskLevel.MEDIUM;
    } else {
      level = RiskLevel.LOW;
    }

    this.logger.debug(
      `Risk score for ticket ${ticket.ticketId}: ${score} (${level}, multiplier: ${cumulativeMultiplier.toFixed(2)}) - factors: [${factors.join(', ')}]`,
    );

    return { score, level, factors, cumulativeMultiplier };
  }

  /**
   * Evaluate file count risk
   * @returns Score and multiplier for this risk factor
   */
  private evaluateFileCountRisk(
    filesChanged: number,
    rules: IFileCountRiskRule,
    factors: string[],
  ): { score: number; multiplier: number } {
    if (filesChanged > rules.highThreshold) {
      factors.push('high_file_count');
      return { score: rules.highMultiplier, multiplier: rules.highMultiplier }; // HIGH - always sample
    } else if (filesChanged >= rules.mediumThreshold) {
      factors.push('medium_file_count');
      return { score: 20, multiplier: rules.mediumMultiplier }; // MEDIUM - 2x multiplier
    }
    return { score: 0, multiplier: 1.0 };
  }

  /**
   * Evaluate complexity risk
   * @returns Score and multiplier for this risk factor
   */
  private evaluateComplexityRisk(
    complexityScore: number,
    rules: IComplexityRiskRule,
    factors: string[],
  ): { score: number; multiplier: number } {
    if (complexityScore >= rules.highThreshold) {
      factors.push('high_complexity');
      return { score: rules.highMultiplier, multiplier: rules.highMultiplier }; // HIGH - always sample
    } else if (complexityScore >= rules.mediumThreshold) {
      factors.push('medium_complexity');
      return { score: 15, multiplier: rules.mediumMultiplier }; // MEDIUM - 1.5x multiplier
    }
    return { score: 0, multiplier: 1.0 };
  }

  /**
   * Evaluate AI provider risk
   * @returns Multiplier for this risk factor
   */
  private evaluateProviderRisk(
    provider: string,
    rules: IAIProviderRiskRule,
    factors: string[],
  ): number {
    const providerLower = provider.toLowerCase();
    if (providerLower.includes('gemini')) {
      factors.push('gemini_provider');
      return rules.geminiMultiplier; // 1.2x multiplier for Gemini
    }
    return rules.claudeMultiplier; // 1.0x for Claude
  }
}

/**
 * Risk-based sampling strategy
 * Applies cumulative probability multipliers based on risk factors (AC#2)
 */
@Injectable()
export class RiskBasedSamplingStrategy implements ISamplingStrategy {
  constructor(private readonly riskScoringService: RiskScoringService) {}

  shouldSample(ticket: ITicketData, config: ISamplingConfig): ISamplingDecision {
    const riskRules = config.riskRules || DEFAULT_RISK_RULES;

    // Calculate risk score and cumulative multiplier
    const riskScore = this.riskScoringService.calculateRiskScore(ticket, riskRules);

    // Always sample HIGH risk (score >= 100)
    if (riskScore.level === RiskLevel.HIGH) {
      return {
        sample: true,
        riskLevel: RiskLevel.HIGH,
        riskFactors: riskScore.factors,
        samplingStrategy: SamplingStrategy.RISK_BASED,
        probability: 1.0,
      };
    }

    // AC#2: Apply cumulative probability multipliers for MEDIUM/LOW risk
    // Risk factors are multiplicative:
    // - File count 5-10: 2x
    // - Complexity 5-9: 1.5x
    // - Gemini provider: 1.2x
    // Combined: 2.0 * 1.5 * 1.2 = 3.6x maximum
    const baseProbability = config.percentage / 100;
    const finalProbability = Math.min(baseProbability * riskScore.cumulativeMultiplier, 1.0);

    const sampled = Math.random() < finalProbability;

    return {
      sample: sampled,
      riskLevel: riskScore.level,
      riskFactors: riskScore.factors,
      samplingStrategy: SamplingStrategy.RISK_BASED,
      probability: finalProbability,
    };
  }
}

/**
 * Composite sampling strategy
 * Combines percentage and risk-based strategies
 * Uses OR logic - if any strategy says sample, we sample
 */
@Injectable()
export class CompositeSamplingStrategy implements ISamplingStrategy {
  constructor(
    private readonly percentageStrategy: PercentageSamplingStrategy,
    private readonly riskBasedStrategy: RiskBasedSamplingStrategy,
  ) {}

  shouldSample(ticket: ITicketData, config: ISamplingConfig): ISamplingDecision {
    // If risk-based is disabled, use percentage only
    if (!config.riskBasedEnabled) {
      return this.percentageStrategy.shouldSample(ticket, config);
    }

    // Run risk-based strategy first
    const riskDecision = this.riskBasedStrategy.shouldSample(ticket, config);

    // If risk-based says sample (HIGH risk), always sample
    if (riskDecision.sample && riskDecision.riskLevel === RiskLevel.HIGH) {
      return riskDecision;
    }

    // If risk-based says sample (not HIGH risk), we sample
    if (riskDecision.sample) {
      return riskDecision;
    }

    // Risk-based said no, try percentage-based as fallback
    const percentageDecision = this.percentageStrategy.shouldSample(ticket, config);

    if (percentageDecision.sample) {
      // Combine risk factors from risk evaluation with percentage strategy
      return {
        sample: true,
        riskLevel: riskDecision.riskLevel,
        riskFactors: riskDecision.riskFactors,
        samplingStrategy: SamplingStrategy.PERCENTAGE,
        probability: percentageDecision.probability,
      };
    }

    // Neither strategy says sample
    return {
      sample: false,
      riskLevel: riskDecision.riskLevel,
      riskFactors: riskDecision.riskFactors,
      samplingStrategy: SamplingStrategy.RISK_BASED,
      probability: riskDecision.probability,
    };
  }
}

/**
 * Main sampling service
 * Provides configuration management and sampling evaluation
 */
@Injectable()
export class QaSamplingService {
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly compositeStrategy: CompositeSamplingStrategy,
    private readonly logger: LoggerService,
  ) {
    this.defaultPageSize = this.configService.get<number>('qaReview.queue.defaultPageSize', 20);
    this.maxPageSize = this.configService.get<number>('qaReview.queue.maxPageSize', 100);
  }

  /**
   * Evaluate if a ticket should be sampled
   * @param ticket - Ticket data
   * @param config - Sampling configuration
   * @returns Sampling decision
   */
  evaluateSampling(ticket: ITicketData, config: ISamplingConfig): ISamplingDecision {
    this.logger.debug(
      `Evaluating sampling for ticket ${ticket.ticketId} with ${config.percentage}% base rate`,
    );

    const decision = this.compositeStrategy.shouldSample(ticket, config);

    this.logger.debug(
      `Sampling decision for ticket ${ticket.ticketId}: ${decision.sample ? 'SAMPLE' : 'SKIP'} ` +
        `(risk: ${decision.riskLevel}, strategy: ${decision.samplingStrategy}, prob: ${(decision.probability * 100).toFixed(1)}%)`,
    );

    return decision;
  }

  /**
   * Get default sampling configuration
   * Used when no config exists in database
   */
  getDefaultConfig(): ISamplingConfig {
    return {
      id: 'default',
      percentage: this.configService.get<number>('qaReview.sampling.defaultPercentage', 20),
      riskBasedEnabled: this.configService.get<boolean>('qaReview.sampling.riskBasedEnabled', true),
      riskRules: DEFAULT_RISK_RULES,
    };
  }

  /**
   * Validate sampling percentage
   * @param percentage - Percentage to validate
   * @returns Validated percentage (0-100)
   */
  validatePercentage(percentage: number): number {
    if (percentage < 0) return 0;
    if (percentage > 100) return 100;
    return percentage;
  }
}
