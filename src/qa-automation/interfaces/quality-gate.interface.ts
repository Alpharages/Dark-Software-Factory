import { TicketStatus } from '@/prisma/client';
import { ILintingResult } from './linting.interface';
import { ITestResult } from './test-runner.interface';
import { ICoverageAnalysis } from './coverage.interface';
import { ISecurityScanResult } from './security-scanner.interface';

/**
 * Quality Gate Decision Engine Interfaces
 * Architecture: docs/architecture.md line 158 (quality-gates.service.ts)
 * FR70: System blocks deployment if quality gates fail
 */

export enum QualityGateStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  WARNING = 'warning',
}

export enum QualityCategory {
  LINTING = 'linting',
  TESTING = 'testing',
  COVERAGE = 'coverage',
  SECURITY = 'security',
}

export enum BlockerType {
  CRITICAL_SECURITY = 'critical_security',
  TEST_FAILURE = 'test_failure',
  LINTING_ERROR = 'linting_error',
  COVERAGE_BELOW_MINIMUM = 'coverage_below_minimum',
}

export enum WarningType {
  HIGH_COMPLEXITY = 'high_complexity',
  COVERAGE_BELOW_TARGET = 'coverage_below_target',
  LOW_SEVERITY_VULN = 'low_severity_vuln',
  LINTING_WARNING = 'linting_warning',
}

/**
 * Quality score weights per category (must sum to 100)
 * Adjust weights based on project priorities
 */
export const QUALITY_SCORE_WEIGHTS: Record<QualityCategory, number> = {
  [QualityCategory.LINTING]: 15,
  [QualityCategory.TESTING]: 35,
  [QualityCategory.COVERAGE]: 25,
  [QualityCategory.SECURITY]: 25,
} as const;

/**
 * Default thresholds - can be overridden per project
 */
export const DEFAULT_THRESHOLDS: IQualityThresholds = {
  minTestPassRate: 100, // 100% tests must pass
  minCoverage: 80, // 80% coverage minimum
  maxLintingErrors: 0, // Zero linting errors allowed
  maxLintingWarnings: 10, // Up to 10 warnings
  blockOnCriticalSecurity: true,
  blockOnHighSecurity: true,
  maxComplexity: 20,
  targetCoverage: 90, // Target for full score
} as const;

export interface IQualityThresholds {
  minTestPassRate: number; // 0-100, percentage
  minCoverage: number; // 0-100, percentage
  maxLintingErrors: number;
  maxLintingWarnings: number;
  blockOnCriticalSecurity: boolean;
  blockOnHighSecurity: boolean;
  maxComplexity: number;
  targetCoverage: number; // For quality score calculation
}

export interface IQualityGateConfig {
  projectId: string | null; // null = global default
  thresholds: IQualityThresholds;
  enabledCategories: QualityCategory[];
  allowOverride: boolean; // Emergency override with audit trail
  overrideRequiresApproval: boolean;
}

export interface IBlockingIssue {
  type: BlockerType;
  category: QualityCategory;
  message: string;
  details?: Record<string, unknown>;
}

export interface IWarningIssue {
  type: WarningType;
  category: QualityCategory;
  message: string;
  details?: Record<string, unknown>;
}

export interface ICategoryScore {
  category: QualityCategory;
  score: number; // 0-100 for this category
  weight: number; // Weight in overall score
  passed: boolean;
  details: {
    metric: string;
    value: number;
    threshold: number;
  }[];
}

export interface IQualityGateResult {
  executionId: string;
  correlationId: string;
  status: QualityGateStatus;
  overallScore: number; // 0-100
  passed: boolean;
  categoryScores: ICategoryScore[];
  blockingIssues: IBlockingIssue[];
  warningIssues: IWarningIssue[];
  appliedConfig: IQualityGateConfig;
  evaluatedAt: Date;
  durationMs: number;
  nextAction: 'proceed_to_github' | 'notify_pm_failure' | 'manual_review';
  ticketStatusUpdate: TicketStatus;
}

export interface IQaCheckMessage {
  executionId: string;
  ticketId: string;
  projectId: string;
  correlationId: string;
  workspacePath: string;
  skipCategories?: QualityCategory[];
}

export interface IQaOrchestrationResult {
  executionId: string;
  correlationId: string;
  status: 'passed' | 'failed';
  lintingResult: ILintingResult; // From Story 3.1
  testResult: ITestResult; // From Story 3.2
  coverageResult: ICoverageAnalysis; // From Story 3.3
  securityResult: ISecurityScanResult; // From Story 3.4
  qualityGateResult: IQualityGateResult;
}
