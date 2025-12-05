import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ESLint } from 'eslint';
import * as path from 'path';
import {
  IComplexityIssue,
  SecuritySeverity,
  SecurityCheckType,
  COMPLEXITY_THRESHOLDS,
} from '../interfaces';

@Injectable()
export class ComplexityAnalyzerService {
  private readonly logger = new Logger(ComplexityAnalyzerService.name);
  private readonly maxComplexity: number;
  private readonly maxFunctionLength: number;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.maxComplexity = this.configService.get<number>('security.maxComplexity', 20);
    this.maxFunctionLength = this.configService.get<number>('security.maxFunctionLength', 100);
    this.timeoutMs = this.configService.get<number>('security.complexityScanTimeoutMs', 60000);
  }

  async analyze(workspacePath: string, correlationId: string): Promise<IComplexityIssue[]> {
    const issues: IComplexityIssue[] = [];

    try {
      const eslint = new ESLint({
        cwd: workspacePath,
        overrideConfig: {
          parser: '@typescript-eslint/parser',
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
          rules: {
            complexity: ['error', { max: this.maxComplexity }],
            'max-lines-per-function': ['error', { max: this.maxFunctionLength }],
            'max-depth': ['error', { max: 5 }],
          },
        } as never,
      });

      const results = await eslint.lintFiles(['**/*.ts', '**/*.js']);

      for (const result of results) {
        for (const message of result.messages) {
          if (!this.isComplexityRule(message.ruleId)) continue;

          const metric = this.getMetricFromRule(message.ruleId!);
          const value = this.extractValueFromMessage(message.message);

          issues.push({
            checkType: SecurityCheckType.COMPLEXITY,
            severity: this.getSeverityForValue(metric, value),
            filePath: path.relative(workspacePath, result.filePath),
            functionName: this.extractFunctionName(message.message),
            lineNumber: message.line,
            metric,
            value,
            threshold: COMPLEXITY_THRESHOLDS[metric].medium,
            recommendation: this.getRecommendation(metric, value),
          });
        }
      }

      this.logger.debug(`[${correlationId}] Found ${issues.length} complexity issues`);
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Complexity analysis failed: ${(error as Error).message}`,
      );
    }

    return issues;
  }

  private isComplexityRule(ruleId: string | null): boolean {
    return ['complexity', 'max-lines-per-function', 'max-depth'].includes(ruleId || '');
  }

  private getMetricFromRule(ruleId: string): IComplexityIssue['metric'] {
    switch (ruleId) {
      case 'complexity':
        return 'cyclomatic';
      case 'max-lines-per-function':
        return 'function_length';
      case 'max-depth':
        return 'nesting_depth';
      default:
        return 'cyclomatic';
    }
  }

  private getSeverityForValue(metric: IComplexityIssue['metric'], value: number): SecuritySeverity {
    const thresholds = COMPLEXITY_THRESHOLDS[metric];
    if (value >= thresholds.critical) return SecuritySeverity.CRITICAL;
    if (value >= thresholds.high) return SecuritySeverity.HIGH;
    if (value >= thresholds.medium) return SecuritySeverity.MEDIUM;
    return SecuritySeverity.LOW;
  }

  private extractValueFromMessage(message: string): number {
    const match = message.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractFunctionName(message: string): string {
    const match = message.match(/(?:function|method)\s+['"]?(\w+)['"]?/i);
    return match ? match[1] : 'anonymous';
  }

  private getRecommendation(metric: IComplexityIssue['metric'], value: number): string {
    switch (metric) {
      case 'cyclomatic':
        return `Cyclomatic complexity is ${value}. Extract helper functions or use early returns.`;
      case 'function_length':
        return `Function has ${value} lines. Split into smaller, focused functions.`;
      case 'nesting_depth':
        return `Nesting depth is ${value}. Use guard clauses or extract nested logic.`;
      default:
        return 'Reduce code complexity';
    }
  }
}
