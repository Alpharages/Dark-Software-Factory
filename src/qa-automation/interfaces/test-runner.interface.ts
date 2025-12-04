export enum TestFramework {
  JEST = 'jest',
  MOCHA = 'mocha',
  VITEST = 'vitest',
  PYTEST = 'pytest',
  GO_TEST = 'go_test',
  UNKNOWN = 'unknown',
}

export enum TestStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  PENDING = 'pending',
}

// Framework detection configuration
export const TEST_FRAMEWORK_CONFIG: Record<
  TestFramework,
  {
    configFiles: string[];
    packageIndicators: string[];
    command: string;
    outputFormat: string;
    dockerImage: string;
  }
> = {
  [TestFramework.JEST]: {
    configFiles: ['jest.config.js', 'jest.config.ts', 'jest.config.json'],
    packageIndicators: ['jest'],
    command:
      'npx jest --json --outputFile=test-results.json --coverage --coverageReporters=json-summary',
    outputFormat: 'jest-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.MOCHA]: {
    configFiles: ['.mocharc.js', '.mocharc.json', '.mocharc.yaml'],
    packageIndicators: ['mocha'],
    command: 'npx mocha --reporter json > test-results.json',
    outputFormat: 'mocha-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.VITEST]: {
    configFiles: ['vitest.config.ts', 'vitest.config.js'],
    packageIndicators: ['vitest'],
    command: 'npx vitest run --reporter=json --outputFile=test-results.json',
    outputFormat: 'vitest-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.PYTEST]: {
    configFiles: ['pytest.ini', 'pyproject.toml', 'setup.cfg'],
    packageIndicators: ['pytest'],
    command: 'pytest --json-report --json-report-file=test-results.json --cov --cov-report=json',
    outputFormat: 'pytest-json',
    dockerImage: 'python:3.11-slim',
  },
  [TestFramework.GO_TEST]: {
    configFiles: ['go.mod'],
    packageIndicators: [],
    command: 'go test -json ./... > test-results.json 2>&1',
    outputFormat: 'go-test-json',
    dockerImage: 'golang:1.21-alpine',
  },
  [TestFramework.UNKNOWN]: {
    configFiles: [],
    packageIndicators: [],
    command: '',
    outputFormat: '',
    dockerImage: '',
  },
};

export interface ITestCase {
  name: string;
  suiteName: string;
  status: TestStatus;
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
  filePath?: string;
  lineNumber?: number;
}

export interface ITestSuite {
  name: string;
  tests: ITestCase[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface ITestResult {
  framework: TestFramework;
  passed: boolean;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  suites: ITestSuite[];
  failedTests: ITestCase[];
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  rawOutput?: string;
}

export interface ITestRunOptions {
  workspacePath: string;
  executionId: string;
  correlationId: string; // REQUIRED for audit trail
  framework?: TestFramework; // Auto-detect if not provided
  testPattern?: string; // e.g., '**/*.spec.ts'
  timeoutMs?: number; // From ConfigService, default: 300000
  collectCoverage?: boolean;
  dockerImage?: string; // Override default
}
