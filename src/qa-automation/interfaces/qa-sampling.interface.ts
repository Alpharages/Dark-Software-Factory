/**
 * QA Sampling Strategy Interfaces
 * Story 8.1: QA Review Queue & Sampling Configuration
 */

import { RiskLevel } from '@/prisma/client';

/**
 * AI Provider type
 */
export type AIProvider = 'CLAUDE_CODE' | 'GEMINI' | 'CODEX' | 'KIMI' | 'OPENHARNESS';

/**
 * Sampling configuration from database
 */
export interface ISamplingConfig {
  id: string;
  percentage: number;
  riskBasedEnabled: boolean;
  riskRules: IRiskRules;
  randomSeed?: string;
}

/**
 * Risk rules configuration
 */
export interface IRiskRules {
  fileCount: IFileCountRiskRule;
  complexity: IComplexityRiskRule;
  aiProvider: IAIProviderRiskRule;
}

/**
 * File count risk rule configuration
 */
export interface IFileCountRiskRule {
  highThreshold: number; // Files > this = HIGH risk (default: 10)
  mediumThreshold: number; // Files 5-10 = MEDIUM risk (default: 5)
  highMultiplier: number; // Always sample (default: 100)
  mediumMultiplier: number; // 2x sampling (default: 2.0)
}

/**
 * Complexity score risk rule configuration
 */
export interface IComplexityRiskRule {
  highThreshold: number; // Score ≥ this = HIGH risk (default: 10)
  mediumThreshold: number; // Score 5-9 = MEDIUM risk (default: 5)
  highMultiplier: number; // Always sample (default: 100)
  mediumMultiplier: number; // 1.5x sampling (default: 1.5)
}

/**
 * AI Provider risk rule configuration
 */
export interface IAIProviderRiskRule {
  claudeMultiplier: number; // Claude Code = 1.0x (default: 1.0)
  geminiMultiplier: number; // Gemini = 1.0x (default: 1.0)
}

/**
 * Ticket data for sampling evaluation
 */
export interface ITicketData {
  ticketId: string;
  executionId: string;
  projectId?: string;
  prId?: string;
  prUrl?: string;
  title?: string;
  filesChanged: number;
  complexityScore: number;
  aiProvider: AIProvider;
  testCoverage?: number;
}

/**
 * Sampling decision result
 */
export interface ISamplingDecision {
  sample: boolean;
  riskLevel: RiskLevel;
  riskFactors: string[];
  samplingStrategy: SamplingStrategy;
  probability: number; // Final probability used (0-1)
}

/**
 * Sampling strategy types
 */
export enum SamplingStrategy {
  PERCENTAGE = 'PERCENTAGE',
  RISK_BASED = 'RISK_BASED',
  RANDOM = 'RANDOM',
}

/**
 * Sampling strategy interface
 */
export interface ISamplingStrategy {
  /**
   * Determine if a ticket should be sampled
   * @param ticket - Ticket data to evaluate
   * @param config - Sampling configuration
   * @returns Sampling decision
   */
  shouldSample(ticket: ITicketData, config: ISamplingConfig): ISamplingDecision;
}

/**
 * Risk scoring result
 */
export interface IRiskScore {
  score: number;
  level: RiskLevel;
  factors: string[];
  cumulativeMultiplier: number; // AC#2: Cumulative multiplicative factor
}

/**
 * Queue item data for API responses
 */
export interface IQueueItem {
  id: string;
  ticketId: string;
  ticketTitle?: string;
  executionId: string;
  prUrl?: string;
  prId?: string;
  status: string;
  riskLevel: RiskLevel;
  riskFactors: string[];
  aiProvider: string;
  complexityScore: number;
  filesChanged: number;
  samplingStrategy: SamplingStrategy;
  testCoverage?: number;
  createdAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
}

/**
 * Queue filter options
 */
export interface IQueueFilter {
  status?: string;
  riskLevel?: string;
  projectId?: string;
  aiProvider?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Queue query options
 */
export interface IQueueQuery extends IQueueFilter {
  sortBy?: 'risk_level' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Paginated queue response
 */
export interface IQueuePageResponse {
  items: IQueueItem[];
  total: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Sampling metrics data
 */
export interface ISamplingMetrics {
  totalTicketsProcessed: number;
  totalTicketsSampled: number;
  actualSampleRate: number;
  configuredSampleRate: number;
  riskDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  strategyDistribution: {
    percentage: number;
    riskBased: number;
    random: number;
  };
  averageTimeInQueue: number; // seconds
}
