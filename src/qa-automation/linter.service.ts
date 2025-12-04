/**
 * LinterService - Multi-language linting service
 * Story 3.1: Linting Integration for Multiple Languages
 *
 * Supports:
 * - TypeScript/JavaScript: ESLint (Node.js API)
 * - Python: Flake8 (CLI)
 * - Go: golangci-lint (CLI)
 *
 * Per FR: Appropriate linters execute based on file types
 * Per NFR-O5: System must expose Prometheus-compatible metrics
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ESLint } from 'eslint';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import {
  ILintingResult,
  ILintingOptions,
  ILintingIssue,
  SupportedLanguage,
  LintingSeverity,
  FILE_EXTENSION_MAP,
  LINTER_CONFIGS,
  DEFAULT_LINTING_TIMEOUT_MS,
  MAX_ISSUES_PER_FILE,
  MAX_TOTAL_ISSUES,
} from './interfaces';

const execFileAsync = promisify(execFile);

/**
 * Flake8 JSON output format
 */
interface Flake8Issue {
  filename: string;
  line_number: number;
  column_number: number;
  code: string;
  text: string;
}

/**
 * golangci-lint JSON output format
 */
interface GolangCILintOutput {
  Issues?: Array<{
    FromLinter: string;
    Text: string;
    Severity: string;
    SourceLines?: string[];
    Pos: {
      Filename: string;
      Line: number;
      Column: number;
    };
  }>;
}

@Injectable()
export class LinterService implements OnModuleDestroy {
  private readonly logger = new Logger(LinterService.name);
  private readonly DEFAULT_TIMEOUT_MS = DEFAULT_LINTING_TIMEOUT_MS;

  // Prevent concurrent linting of same workspace
  private readonly lintingInProgress = new Map<string, boolean>();

  // Cleanup interval for stale linting locks
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    @InjectMetric(QA_METRICS.LINTING_TOTAL)
    private readonly lintingCounter: Counter<string>,
    @InjectMetric(QA_METRICS.LINTING_DURATION)
    private readonly lintingDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.LINTING_ISSUES)
    private readonly lintingIssues: Gauge<string>,
  ) {
    // Clean up stale locks every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStaleLocks(), 5 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Main entry point - lint files in workspace
   *
   * @param options - Linting options including workspace path and files
   * @returns Linting result with issues and statistics
   */
  async lintFiles(options: ILintingOptions): Promise<ILintingResult> {
    const { workspacePath, files, timeoutMs = this.DEFAULT_TIMEOUT_MS } = options;

    // Validate inputs
    if (!files || files.length === 0) {
      return this.createEmptyResult(SupportedLanguage.UNKNOWN, [], 0);
    }

    // Prevent concurrent linting of same workspace
    if (this.lintingInProgress.get(workspacePath)) {
      throw new Error(`Linting already in progress for ${workspacePath}`);
    }
    this.lintingInProgress.set(workspacePath, true);

    const language = this.detectPrimaryLanguage(files);
    const endTimer = this.lintingDuration.startTimer({ language });
    const startTime = Date.now();

    this.logger.log(`Starting linting for ${files.length} files (${language}) in ${workspacePath}`);

    try {
      let result: ILintingResult;

      switch (language) {
        case SupportedLanguage.TYPESCRIPT:
        case SupportedLanguage.JAVASCRIPT:
          result = await this.lintTypeScript(files, workspacePath, timeoutMs, options.configPath);
          break;
        case SupportedLanguage.PYTHON:
          await this.checkBinaryExists('flake8');
          result = await this.lintPython(files, workspacePath, timeoutMs, options.configPath);
          break;
        case SupportedLanguage.GO:
          await this.checkBinaryExists('golangci-lint');
          result = await this.lintGo(files, workspacePath, timeoutMs, options.configPath);
          break;
        default:
          result = this.createEmptyResult(language, files, Date.now() - startTime);
      }

      // Apply warningsAsErrors if configured
      if (options.warningsAsErrors && result.warningCount > 0) {
        result.passed = false;
      }

      // Track metrics
      this.lintingCounter.inc({
        language,
        result: result.passed ? 'passed' : 'failed',
      });
      this.lintingIssues.set({ language, severity: 'error' }, result.errorCount);
      this.lintingIssues.set({ language, severity: 'warning' }, result.warningCount);

      this.logger.log(
        `Linting completed: ${result.passed ? 'PASSED' : 'FAILED'} ` +
          `(${result.errorCount} errors, ${result.warningCount} warnings)`,
      );

      return result;
    } catch (error) {
      this.lintingCounter.inc({ language, result: 'error' });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { workspacePath, language, fileCount: files.length },
      });
      throw error;
    } finally {
      this.lintingInProgress.delete(workspacePath);
      endTimer();
    }
  }

  /**
   * Save linting result to database and update ticket status on failure
   *
   * @param executionId - Execution ID to associate result with
   * @param result - Linting result to save
   */
  async saveLintingResult(executionId: string, result: ILintingResult): Promise<void> {
    this.logger.debug(`Saving linting result for execution ${executionId}`);

    // 1. Find or create QAResult record
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    const lintingData = {
      linting_passed: result.passed,
      linting_errors: result.issues as unknown as object,
    };

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: lintingData,
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          ...lintingData,
          tests_passed: false,
          code_review_passed: false,
          overall_passed: false,
        },
      });
    }

    // 2. Update ticket status if linting failed
    if (!result.passed) {
      await this.updateTicketStatusOnFailure(executionId);
    }

    this.logger.log(
      `Saved linting result for execution ${executionId}: ${result.passed ? 'passed' : 'failed'}`,
    );
  }

  /**
   * Detect primary language from file list
   */
  detectPrimaryLanguage(files: string[]): SupportedLanguage {
    const languageCounts = new Map<SupportedLanguage, number>();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const language = FILE_EXTENSION_MAP[ext] || SupportedLanguage.UNKNOWN;
      languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
    }

    // Find language with most files
    let primaryLanguage = SupportedLanguage.UNKNOWN;
    let maxCount = 0;

    for (const [language, count] of languageCounts) {
      if (language !== SupportedLanguage.UNKNOWN && count > maxCount) {
        primaryLanguage = language;
        maxCount = count;
      }
    }

    return primaryLanguage;
  }

  // ============= Private Methods =============

  /**
   * Lint TypeScript/JavaScript files using ESLint Node.js API
   */
  private async lintTypeScript(
    files: string[],
    workspacePath: string,
    timeoutMs: number,
    configPath?: string,
  ): Promise<ILintingResult> {
    const startTime = Date.now();
    const absoluteFiles = files.map((f) => path.resolve(workspacePath, f));

    // Find ESLint config
    const eslintConfig = configPath
      ? path.resolve(workspacePath, configPath)
      : await this.findConfigFile(workspacePath, SupportedLanguage.TYPESCRIPT);

    try {
      const eslint = new ESLint({
        cwd: workspacePath,
        overrideConfigFile: eslintConfig || undefined,
        errorOnUnmatchedPattern: false,
      });

      // Apply timeout
      const lintPromise = eslint.lintFiles(absoluteFiles);
      const results = await this.withTimeout(lintPromise, timeoutMs);

      // Get ESLint version
      const version = ESLint.version;

      // Parse results into our format
      const issues: ILintingIssue[] = [];
      let errorCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      const filesLinted: string[] = [];

      for (const result of results) {
        const relativePath = path.relative(workspacePath, result.filePath);
        filesLinted.push(relativePath);

        let fileIssueCount = 0;

        for (const message of result.messages) {
          if (fileIssueCount >= MAX_ISSUES_PER_FILE) break;
          if (issues.length >= MAX_TOTAL_ISSUES) break;

          const severity = this.mapEslintSeverity(message.severity);

          if (severity === LintingSeverity.ERROR) errorCount++;
          else if (severity === LintingSeverity.WARNING) warningCount++;
          else infoCount++;

          issues.push({
            filePath: relativePath,
            line: message.line,
            column: message.column,
            endLine: message.endLine,
            endColumn: message.endColumn,
            severity,
            message: message.message,
            ruleId: message.ruleId,
            fix: message.fix
              ? {
                  description: `Apply fix: ${message.ruleId}`,
                  replacementText: message.fix.text,
                }
              : undefined,
          });

          fileIssueCount++;
        }
      }

      return {
        passed: errorCount === 0,
        errorCount,
        warningCount,
        infoCount,
        issues,
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted,
        durationMs: Date.now() - startTime,
        configFile: eslintConfig || undefined,
        linterVersion: version,
      };
    } catch (error) {
      this.logger.error(`ESLint execution failed: ${(error as Error).message}`);
      throw new Error(`ESLint failed: ${(error as Error).message}`);
    }
  }

  /**
   * Lint Python files using Flake8 CLI
   */
  private async lintPython(
    files: string[],
    workspacePath: string,
    timeoutMs: number,
    configPath?: string,
  ): Promise<ILintingResult> {
    const startTime = Date.now();
    const absoluteFiles = files.map((f) => path.resolve(workspacePath, f));

    // Build command args
    const args = ['--format=json', ...absoluteFiles];

    if (configPath) {
      args.unshift(`--config=${path.resolve(workspacePath, configPath)}`);
    }

    try {
      const { stdout, stderr } = await this.execWithTimeout(
        'flake8',
        args,
        workspacePath,
        timeoutMs,
      );

      // Get flake8 version
      let version: string | undefined;
      try {
        const versionResult = await execFileAsync('flake8', ['--version']);
        version = versionResult.stdout.split(' ')[0];
      } catch {
        // Ignore version fetch errors
      }

      // Parse JSON output (flake8 outputs one JSON object per line)
      const issues: ILintingIssue[] = [];
      let errorCount = 0;
      let warningCount = 0;
      const filesLinted = new Set<string>();

      // Flake8 with --format=json outputs newline-delimited JSON
      const lines = (stdout || stderr).trim().split('\n').filter(Boolean);

      for (const line of lines) {
        if (issues.length >= MAX_TOTAL_ISSUES) break;

        try {
          const issue = JSON.parse(line) as Flake8Issue;
          const relativePath = path.relative(workspacePath, issue.filename);
          filesLinted.add(relativePath);

          // Flake8 codes: E=error, W=warning, F=fatal
          const severity =
            issue.code.startsWith('E') || issue.code.startsWith('F')
              ? LintingSeverity.ERROR
              : LintingSeverity.WARNING;

          if (severity === LintingSeverity.ERROR) errorCount++;
          else warningCount++;

          issues.push({
            filePath: relativePath,
            line: issue.line_number,
            column: issue.column_number,
            severity,
            message: issue.text,
            ruleId: issue.code,
          });
        } catch {
          // Skip malformed lines
        }
      }

      return {
        passed: errorCount === 0,
        errorCount,
        warningCount,
        infoCount: 0,
        issues,
        language: SupportedLanguage.PYTHON,
        filesLinted: Array.from(filesLinted),
        durationMs: Date.now() - startTime,
        configFile: configPath,
        linterVersion: version,
      };
    } catch (error) {
      // Flake8 returns non-zero exit code when issues found - parse the output directly
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      if (execError.stdout || execError.stderr) {
        // Parse output from error (flake8 outputs issues and exits non-zero)
        return this.parseFlake8Output(
          execError.stdout || execError.stderr || '',
          workspacePath,
          files,
          startTime,
          configPath,
        );
      }
      this.logger.error(`Flake8 execution failed: ${(error as Error).message}`);
      throw new Error(`Flake8 failed: ${(error as Error).message}`);
    }
  }

  /**
   * Lint Go files using golangci-lint CLI
   */
  private async lintGo(
    files: string[],
    workspacePath: string,
    timeoutMs: number,
    configPath?: string,
  ): Promise<ILintingResult> {
    const startTime = Date.now();

    // Build command args
    const args = ['run', '--out-format=json', '--timeout', `${Math.floor(timeoutMs / 1000)}s`];

    if (configPath) {
      args.push(`--config=${path.resolve(workspacePath, configPath)}`);
    }

    // Add file paths
    args.push(...files);

    try {
      const { stdout } = await this.execWithTimeout(
        'golangci-lint',
        args,
        workspacePath,
        timeoutMs,
      );

      // Get version
      let version: string | undefined;
      try {
        const versionResult = await execFileAsync('golangci-lint', ['--version']);
        const match = versionResult.stdout.match(/version\s+(\S+)/);
        version = match ? match[1] : undefined;
      } catch {
        // Ignore version fetch errors
      }

      // Parse JSON output
      const issues: ILintingIssue[] = [];
      let errorCount = 0;
      let warningCount = 0;
      const filesLinted = new Set<string>();

      try {
        const output = JSON.parse(stdout || '{}') as GolangCILintOutput;

        for (const issue of output.Issues || []) {
          if (issues.length >= MAX_TOTAL_ISSUES) break;

          const relativePath = path.relative(workspacePath, issue.Pos.Filename);
          filesLinted.add(relativePath);

          const severity =
            issue.Severity === 'error' ? LintingSeverity.ERROR : LintingSeverity.WARNING;

          if (severity === LintingSeverity.ERROR) errorCount++;
          else warningCount++;

          issues.push({
            filePath: relativePath,
            line: issue.Pos.Line,
            column: issue.Pos.Column,
            severity,
            message: issue.Text,
            ruleId: issue.FromLinter,
          });
        }
      } catch {
        // Empty or invalid JSON - no issues
      }

      return {
        passed: errorCount === 0,
        errorCount,
        warningCount,
        infoCount: 0,
        issues,
        language: SupportedLanguage.GO,
        filesLinted: Array.from(filesLinted),
        durationMs: Date.now() - startTime,
        configFile: configPath,
        linterVersion: version,
      };
    } catch (error) {
      // golangci-lint returns non-zero on issues
      const execError = error as { stdout?: string };
      if (execError.stdout) {
        try {
          const output = JSON.parse(execError.stdout) as GolangCILintOutput;
          if (output.Issues) {
            // Re-parse with the error output
            return this.parseGolangCIOutput(
              execError.stdout,
              workspacePath,
              files,
              startTime,
              configPath,
            );
          }
        } catch {
          // Not valid JSON
        }
      }
      this.logger.error(`golangci-lint execution failed: ${(error as Error).message}`);
      throw new Error(`golangci-lint failed: ${(error as Error).message}`);
    }
  }

  /**
   * Parse Flake8 output (helper for error case when exit code is non-zero)
   */
  private parseFlake8Output(
    output: string,
    workspacePath: string,
    files: string[],
    startTime: number,
    configPath?: string,
  ): ILintingResult {
    const issues: ILintingIssue[] = [];
    let errorCount = 0;
    let warningCount = 0;
    const filesLinted = new Set<string>(files);

    // Flake8 with --format=json outputs newline-delimited JSON
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      if (issues.length >= MAX_TOTAL_ISSUES) break;

      try {
        const issue = JSON.parse(line) as Flake8Issue;
        const relativePath = path.relative(workspacePath, issue.filename);
        filesLinted.add(relativePath);

        // Flake8 codes: E=error, W=warning, F=fatal
        const severity =
          issue.code.startsWith('E') || issue.code.startsWith('F')
            ? LintingSeverity.ERROR
            : LintingSeverity.WARNING;

        if (severity === LintingSeverity.ERROR) errorCount++;
        else warningCount++;

        issues.push({
          filePath: relativePath,
          line: issue.line_number,
          column: issue.column_number,
          severity,
          message: issue.text,
          ruleId: issue.code,
        });
      } catch {
        // Skip malformed lines
      }
    }

    return {
      passed: errorCount === 0,
      errorCount,
      warningCount,
      infoCount: 0,
      issues,
      language: SupportedLanguage.PYTHON,
      filesLinted: Array.from(filesLinted),
      durationMs: Date.now() - startTime,
      configFile: configPath,
    };
  }

  /**
   * Parse golangci-lint output (helper for error case)
   */
  private parseGolangCIOutput(
    stdout: string,
    workspacePath: string,
    files: string[],
    startTime: number,
    configPath?: string,
  ): ILintingResult {
    const issues: ILintingIssue[] = [];
    let errorCount = 0;
    let warningCount = 0;
    const filesLinted = new Set<string>(files);

    try {
      const output = JSON.parse(stdout) as GolangCILintOutput;

      for (const issue of output.Issues || []) {
        if (issues.length >= MAX_TOTAL_ISSUES) break;

        const relativePath = path.relative(workspacePath, issue.Pos.Filename);

        const severity =
          issue.Severity === 'error' ? LintingSeverity.ERROR : LintingSeverity.WARNING;

        if (severity === LintingSeverity.ERROR) errorCount++;
        else warningCount++;

        issues.push({
          filePath: relativePath,
          line: issue.Pos.Line,
          column: issue.Pos.Column,
          severity,
          message: issue.Text,
          ruleId: issue.FromLinter,
        });
      }
    } catch {
      // Ignore parse errors
    }

    return {
      passed: errorCount === 0,
      errorCount,
      warningCount,
      infoCount: 0,
      issues,
      language: SupportedLanguage.GO,
      filesLinted: Array.from(filesLinted),
      durationMs: Date.now() - startTime,
      configFile: configPath,
    };
  }

  /**
   * Check if external linter binary is available
   */
  private async checkBinaryExists(binary: string): Promise<void> {
    try {
      await execFileAsync('which', [binary]);
    } catch {
      const installHint =
        binary === 'flake8'
          ? 'pip install flake8'
          : 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest';

      throw new Error(`Linter binary '${binary}' not found. Install with: ${installHint}`);
    }
  }

  /**
   * Find configuration file for a language
   */
  private async findConfigFile(
    workspacePath: string,
    language: SupportedLanguage,
  ): Promise<string | null> {
    const config = LINTER_CONFIGS[language];
    if (!config) return null;

    for (const configFile of config.configFiles) {
      const configPath = path.join(workspacePath, configFile);
      try {
        await fs.access(configPath);
        return configPath;
      } catch {
        // Config file doesn't exist, try next
      }
    }

    return null;
  }

  /**
   * Execute command with timeout
   */
  private async execWithTimeout(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
  }

  /**
   * Apply timeout to a promise
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Linting timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Map ESLint severity to our severity enum
   */
  private mapEslintSeverity(severity: number): LintingSeverity {
    switch (severity) {
      case 2:
        return LintingSeverity.ERROR;
      case 1:
        return LintingSeverity.WARNING;
      default:
        return LintingSeverity.INFO;
    }
  }

  /**
   * Create empty result for unsupported languages
   */
  private createEmptyResult(
    language: SupportedLanguage,
    files: string[],
    durationMs: number,
  ): ILintingResult {
    return {
      passed: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      issues: [],
      language,
      filesLinted: files,
      durationMs,
    };
  }

  /**
   * Update ticket status to QA_FAILED when linting fails
   */
  private async updateTicketStatusOnFailure(executionId: string): Promise<void> {
    try {
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
      });

      if (execution) {
        await this.prisma.ticket.update({
          where: { id: execution.ticket_id },
          data: { status: 'QA_FAILED' },
        });

        this.logger.warn(
          `Ticket ${execution.ticket_id} marked as QA_FAILED due to linting failure`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to update ticket status: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up stale linting locks (safety mechanism)
   */
  private cleanupStaleLocks(): void {
    // Clear all locks (simple approach - in production would track timestamps)
    if (this.lintingInProgress.size > 0) {
      this.logger.debug(`Cleaning up ${this.lintingInProgress.size} stale linting locks`);
      this.lintingInProgress.clear();
    }
  }
}
