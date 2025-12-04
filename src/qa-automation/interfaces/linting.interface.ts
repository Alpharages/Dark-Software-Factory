/**
 * Linting Interfaces for QA Automation
 * Story 3.1: Linting Integration for Multiple Languages
 *
 * Defines types for multi-language linting support:
 * - TypeScript/JavaScript: ESLint
 * - Python: Flake8
 * - Go: golangci-lint
 */

/**
 * Supported programming languages for linting
 */
export enum SupportedLanguage {
  TYPESCRIPT = 'typescript',
  JAVASCRIPT = 'javascript',
  PYTHON = 'python',
  GO = 'go',
  UNKNOWN = 'unknown',
}

/**
 * Map file extensions to their corresponding language
 */
export const FILE_EXTENSION_MAP: Record<string, SupportedLanguage> = {
  '.ts': SupportedLanguage.TYPESCRIPT,
  '.tsx': SupportedLanguage.TYPESCRIPT,
  '.js': SupportedLanguage.JAVASCRIPT,
  '.jsx': SupportedLanguage.JAVASCRIPT,
  '.mjs': SupportedLanguage.JAVASCRIPT,
  '.cjs': SupportedLanguage.JAVASCRIPT,
  '.py': SupportedLanguage.PYTHON,
  '.pyw': SupportedLanguage.PYTHON,
  '.go': SupportedLanguage.GO,
};

/**
 * Severity levels for linting issues
 */
export enum LintingSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

/**
 * Represents a single linting issue/violation
 */
export interface ILintingIssue {
  /** Relative path to the file containing the issue */
  filePath: string;

  /** 1-indexed line number where the issue starts */
  line: number;

  /** 1-indexed column number where the issue starts */
  column: number;

  /** 1-indexed line number where the issue ends (optional) */
  endLine?: number;

  /** 1-indexed column number where the issue ends (optional) */
  endColumn?: number;

  /** Severity level of the issue */
  severity: LintingSeverity;

  /** Human-readable description of the issue */
  message: string;

  /** Rule identifier that triggered this issue (e.g., 'no-unused-vars', 'E501') */
  ruleId: string | null;

  /** Optional fix information */
  fix?: {
    /** Description of the suggested fix */
    description: string;
    /** Replacement text if available */
    replacementText?: string;
  };
}

/**
 * Complete result of a linting operation
 */
export interface ILintingResult {
  /** Whether linting passed (no errors, warnings may exist) */
  passed: boolean;

  /** Total count of error-severity issues */
  errorCount: number;

  /** Total count of warning-severity issues */
  warningCount: number;

  /** Total count of info-severity issues */
  infoCount: number;

  /** List of all issues found */
  issues: ILintingIssue[];

  /** Primary language that was linted */
  language: SupportedLanguage;

  /** List of files that were successfully linted */
  filesLinted: string[];

  /** Duration of the linting operation in milliseconds */
  durationMs: number;

  /** Path to the configuration file used (if any) */
  configFile?: string;

  /** Linter version used */
  linterVersion?: string;
}

/**
 * Options for configuring a linting operation
 */
export interface ILintingOptions {
  /** Absolute path to the workspace/project root */
  workspacePath: string;

  /** List of files to lint (relative to workspacePath) */
  files: string[];

  /** Optional path to a specific linter configuration file */
  configPath?: string;

  /** Timeout for the linting operation in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Whether to attempt auto-fixing issues (default: false) */
  autoFix?: boolean;

  /** Whether to treat warnings as errors for pass/fail determination */
  warningsAsErrors?: boolean;
}

/**
 * Configuration for a specific linter
 */
export interface ILinterConfig {
  /** Name of the linter binary/command */
  binary: string;

  /** Default arguments to pass to the linter */
  defaultArgs: string[];

  /** File extensions this linter handles */
  extensions: string[];

  /** Default configuration file names to look for */
  configFiles: string[];
}

/**
 * Linter configurations per language
 */
export const LINTER_CONFIGS: Record<SupportedLanguage, ILinterConfig | null> = {
  [SupportedLanguage.TYPESCRIPT]: {
    binary: 'eslint',
    defaultArgs: ['--format', 'json'],
    extensions: ['.ts', '.tsx'],
    configFiles: [
      'eslint.config.mjs', // ESLint 9+ flat config (preferred)
      'eslint.config.js',
      'eslint.config.cjs',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ],
  },
  [SupportedLanguage.JAVASCRIPT]: {
    binary: 'eslint',
    defaultArgs: ['--format', 'json'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    configFiles: [
      'eslint.config.mjs', // ESLint 9+ flat config (preferred)
      'eslint.config.js',
      'eslint.config.cjs',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ],
  },
  [SupportedLanguage.PYTHON]: {
    binary: 'flake8',
    defaultArgs: ['--format=json', '--output-file=-'],
    extensions: ['.py', '.pyw'],
    configFiles: ['.flake8', 'setup.cfg', 'tox.ini'],
  },
  [SupportedLanguage.GO]: {
    binary: 'golangci-lint',
    defaultArgs: ['run', '--out-format=json'],
    extensions: ['.go'],
    configFiles: ['.golangci.yml', '.golangci.yaml', '.golangci.json'],
  },
  [SupportedLanguage.UNKNOWN]: null,
};

/**
 * Default timeout for linting operations (60 seconds)
 */
export const DEFAULT_LINTING_TIMEOUT_MS = 60000;

/**
 * Maximum number of issues to report per file
 */
export const MAX_ISSUES_PER_FILE = 100;

/**
 * Maximum total issues to report
 */
export const MAX_TOTAL_ISSUES = 1000;
