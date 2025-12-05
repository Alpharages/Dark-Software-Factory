import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { DependencyScannerService } from './scanners/dependency-scanner.service';
import { SecretsScannerService } from './scanners/secrets-scanner.service';
import { ComplexityAnalyzerService } from './scanners/complexity-analyzer.service';
import { SecurityPatternService } from './scanners/security-pattern.service';
import {
  ISecurityScanResult,
  ISecurityScanOptions,
  ISecurityFinding,
  SecuritySeverity,
} from './interfaces';

@Injectable()
export class CodeReviewService {
  private readonly logger = new Logger(CodeReviewService.name);
  private readonly blockOnCritical: boolean;
  private readonly blockOnHigh: boolean;
  private readonly globalTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sentry: SentryService,
    private readonly dependencyScanner: DependencyScannerService,
    private readonly secretsScanner: SecretsScannerService,
    private readonly complexityAnalyzer: ComplexityAnalyzerService,
    private readonly securityPatternService: SecurityPatternService,
    @InjectMetric(QA_METRICS.SECURITY_SCANS_TOTAL) private readonly scansCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_SCAN_DURATION)
    private readonly scanDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.SECURITY_VULNERABILITIES)
    private readonly vulnCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_SECRETS_DETECTED)
    private readonly secretsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_COMPLEXITY_ISSUES)
    private readonly complexityCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_PATTERN_FINDINGS)
    private readonly patternCounter: Counter<string>,
  ) {
    this.blockOnCritical = this.configService.get<boolean>('security.blockOnCritical', true);
    this.blockOnHigh = this.configService.get<boolean>('security.blockOnHigh', true);
    this.globalTimeoutMs = this.configService.get<number>('security.scanTimeoutMs', 180000);
  }

  async scan(options: ISecurityScanOptions): Promise<ISecurityScanResult> {
    const { workspacePath, executionId, correlationId } = options;
    const startTime = Date.now();
    const endTimer = this.scanDuration.startTimer();

    this.logger.log(`[${correlationId}] Starting code review scan for execution ${executionId}`);

    const scannerResults: ISecurityScanResult['scannerResults'] = {
      dependency: { ran: false, passed: true, durationMs: 0, error: undefined },
      secrets: { ran: false, passed: true, durationMs: 0, error: undefined },
      complexity: { ran: false, passed: true, durationMs: 0, error: undefined },
      patterns: { ran: false, passed: true, durationMs: 0, error: undefined },
    };

    try {
      // Run all scanners in parallel with individual timing
      const [depResult, secretsResult, complexityResult, patternResult] = await Promise.allSettled([
        this.runWithTiming(
          'dependency',
          () =>
            options.skipDependencyScan
              ? Promise.resolve(null)
              : this.dependencyScanner.scan(workspacePath, correlationId),
          scannerResults,
        ),
        this.runWithTiming(
          'secrets',
          () =>
            options.skipSecretsScan
              ? Promise.resolve(null)
              : this.secretsScanner.scan(workspacePath, correlationId),
          scannerResults,
        ),
        this.runWithTiming(
          'complexity',
          () =>
            options.skipComplexityScan
              ? Promise.resolve(null)
              : this.complexityAnalyzer.analyze(workspacePath, correlationId),
          scannerResults,
        ),
        this.runWithTiming(
          'patterns',
          () =>
            options.skipPatternScan
              ? Promise.resolve(null)
              : this.securityPatternService.scan(workspacePath, correlationId),
          scannerResults,
        ),
      ]);

      // Extract results
      const vulnerabilities = this.extractSettledResult(depResult) || [];
      const secrets = this.extractSettledResult(secretsResult) || [];
      const complexityIssues = this.extractSettledResult(complexityResult) || [];
      const patternFindings = this.extractSettledResult(patternResult) || [];

      // Calculate summary
      const allFindings: ISecurityFinding[] = [
        ...vulnerabilities,
        ...secrets,
        ...complexityIssues,
        ...patternFindings,
      ];
      const summary = this.calculateSummary(allFindings);
      const passed = this.determinePassFail(summary);

      // Track metrics
      this.trackMetrics(passed, vulnerabilities, secrets, complexityIssues, patternFindings);

      const result: ISecurityScanResult = {
        passed,
        executionId,
        correlationId,
        scanDurationMs: Date.now() - startTime,
        summary,
        vulnerabilities,
        secrets,
        complexityIssues,
        patternFindings,
        scannerResults,
        scannedAt: new Date(),
      };

      this.logger.log(
        `[${correlationId}] Code review complete: ${summary.totalFindings} findings ` +
          `(${summary.criticalCount} critical, ${summary.highCount} high), passed: ${passed}`,
      );

      return result;
    } catch (error) {
      this.scansCounter.inc({ result: 'error' });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, correlationId, workspacePath },
      });
      throw error;
    } finally {
      endTimer();
    }
  }

  private async runWithTiming<T>(
    scannerKey: keyof ISecurityScanResult['scannerResults'],
    fn: () => Promise<T | null>,
    scannerResults: ISecurityScanResult['scannerResults'],
  ): Promise<T | null> {
    const start = Date.now();
    scannerResults[scannerKey].ran = true;
    try {
      const result = await fn();
      scannerResults[scannerKey].durationMs = Date.now() - start;
      return result;
    } catch (error) {
      scannerResults[scannerKey].durationMs = Date.now() - start;
      scannerResults[scannerKey].passed = false;
      scannerResults[scannerKey].error = (error as Error).message;
      throw error;
    }
  }

  private extractSettledResult<T>(result: PromiseSettledResult<T | null>): T | null {
    return result.status === 'fulfilled' ? result.value : null;
  }

  private calculateSummary(findings: ISecurityFinding[]) {
    return {
      totalFindings: findings.length,
      criticalCount: findings.filter((f) => f.severity === SecuritySeverity.CRITICAL).length,
      highCount: findings.filter((f) => f.severity === SecuritySeverity.HIGH).length,
      mediumCount: findings.filter((f) => f.severity === SecuritySeverity.MEDIUM).length,
      lowCount: findings.filter((f) => f.severity === SecuritySeverity.LOW).length,
      infoCount: findings.filter((f) => f.severity === SecuritySeverity.INFO).length,
    };
  }

  private determinePassFail(summary: ISecurityScanResult['summary']): boolean {
    if (this.blockOnCritical && summary.criticalCount > 0) return false;
    if (this.blockOnHigh && summary.highCount > 0) return false;
    return true;
  }

  private trackMetrics(
    passed: boolean,
    vulnerabilities: Array<{ severity: string }>,
    secrets: unknown[],
    complexityIssues: unknown[],
    patternFindings: Array<{ patternType: string }>,
  ): void {
    this.scansCounter.inc({ result: passed ? 'passed' : 'failed' });
    vulnerabilities.forEach((v) => this.vulnCounter.inc({ severity: v.severity }));
    this.secretsCounter.inc({}, secrets.length);
    this.complexityCounter.inc({}, complexityIssues.length);
    patternFindings.forEach((p) => this.patternCounter.inc({ type: p.patternType }));
  }

  async saveResult(executionId: string, result: ISecurityScanResult): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    const codeReviewIssues = {
      vulnerabilities: result.vulnerabilities,
      secrets: result.secrets, // Already masked
      complexityIssues: result.complexityIssues,
      patternFindings: result.patternFindings,
      summary: result.summary,
      scannerResults: result.scannerResults,
    } as never;

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: { code_review_passed: result.passed, code_review_issues: codeReviewIssues },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: true,
          tests_passed: true,
          code_review_passed: result.passed,
          code_review_issues: codeReviewIssues,
          overall_passed: false,
        },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'code_review_scanned',
        actor_type: 'system',
        actor_id: 'system',
        after_state: {
          passed: result.passed,
          summary: result.summary,
          correlationId: result.correlationId,
        } as never,
      },
    });

    if (!result.passed) {
      const execution = await this.prisma.execution.findUnique({ where: { id: executionId } });
      if (execution) {
        await this.prisma.ticket.update({
          where: { id: execution.ticket_id },
          data: { status: 'QA_FAILED' },
        });
      }
    }
  }
}
