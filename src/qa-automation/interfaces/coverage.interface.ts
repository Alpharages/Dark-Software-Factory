/**
 * Coverage data from test execution (matches Story 3.2 ITestResult.coverage)
 */
export interface ICoverageData {
  lines: number; // Percentage (0-100)
  branches: number; // Percentage (0-100)
  functions: number; // Percentage (0-100)
  statements: number; // Percentage (0-100)
}

/**
 * Coverage change compared to baseline
 */
export interface ICoverageDelta {
  lines: number; // Positive = improvement, Negative = regression
  branches: number;
  functions: number;
  statements: number;
  overall: number; // Weighted average delta
}

/**
 * Per-file coverage for detailed reporting
 * Parsed from coverage-summary.json
 */
export interface IFileCoverage {
  filePath: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  uncoveredLines: number[];
  isBelowThreshold: boolean;
}

/**
 * Complete coverage analysis result
 */
export interface ICoverageAnalysis {
  executionId: string;
  correlationId: string;
  current: ICoverageData;
  baseline?: ICoverageData;
  delta: ICoverageDelta;
  passed: boolean;
  threshold: number;
  failedFiles: IFileCoverage[];
  summary: {
    totalFiles: number;
    filesBelowThreshold: number;
    avgLineCoverage: number;
  };
  reportPath?: string; // Path to HTML coverage report
  analyzedAt: Date;
}

/**
 * Options for coverage analysis
 */
export interface ICoverageOptions {
  executionId: string;
  correlationId: string; // REQUIRED for audit trail
  projectId: string;
  workspacePath: string; // Path to read coverage-summary.json
  baseBranch?: string; // Default: 'main'
  thresholdOverride?: number; // Override global threshold
  enforceThreshold?: boolean; // Default: true
  generateHtmlReport?: boolean; // Default: true
}

/**
 * Baseline record structure
 */
export interface ICoverageBaseline {
  id: string;
  projectId: string;
  branch: string;
  coverage: ICoverageData;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Coverage threshold configuration
 */
export const DEFAULT_COVERAGE_THRESHOLD = 80; // NFR-M1: >80%

export const COVERAGE_WEIGHTS = {
  lines: 0.4,
  branches: 0.2,
  functions: 0.2,
  statements: 0.2,
} as const;

/**
 * Istanbul/nyc coverage-summary.json format
 */
export interface IIstanbulCoverageSummary {
  total: {
    lines: { total: number; covered: number; pct: number };
    branches: { total: number; covered: number; pct: number };
    functions: { total: number; covered: number; pct: number };
    statements: { total: number; covered: number; pct: number };
  };
  [filePath: string]:
    | {
        lines: { total: number; covered: number; pct: number };
        branches: { total: number; covered: number; pct: number };
        functions: { total: number; covered: number; pct: number };
        statements: { total: number; covered: number; pct: number };
      }
    | {
        lines: { total: number; covered: number; pct: number };
        branches: { total: number; covered: number; pct: number };
        functions: { total: number; covered: number; pct: number };
        statements: { total: number; covered: number; pct: number };
      };
}
