import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ISecurityVulnerability,
  SecuritySeverity,
  SecurityCheckType,
  LANGUAGE_DETECTION_FILES,
} from '../interfaces';

const execAsync = promisify(exec);

// Sample output for testing
export const NPM_AUDIT_SAMPLE_OUTPUT = JSON.stringify({
  vulnerabilities: {
    lodash: {
      severity: 'high',
      via: [{ title: 'Prototype Pollution', url: 'https://npmjs.com/advisories/1523' }],
      effects: [],
      range: '<4.17.21',
      fixAvailable: { name: 'lodash', version: '4.17.21' },
    },
  },
  metadata: { vulnerabilities: { high: 1, moderate: 0, low: 0 } },
});

@Injectable()
export class DependencyScannerService {
  private readonly logger = new Logger(DependencyScannerService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.dependencyScanTimeoutMs', 60000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecurityVulnerability[]> {
    const language = await this.detectLanguage(workspacePath);
    this.logger.debug(`[${correlationId}] Detected language: ${language}`);

    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.scanNpm(workspacePath, correlationId);
      case 'python':
        return this.scanPip(workspacePath, correlationId);
      case 'go':
        return this.scanGo(workspacePath, correlationId);
      default:
        this.logger.warn(`[${correlationId}] No dependency scanner for language: ${language}`);
        return [];
    }
  }

  private async detectLanguage(workspacePath: string): Promise<string> {
    for (const [file, lang] of Object.entries(LANGUAGE_DETECTION_FILES)) {
      try {
        await fs.access(path.join(workspacePath, file));
        return lang!;
      } catch {
        /* file not found */
      }
    }
    return 'unknown';
  }

  private async scanNpm(
    workspacePath: string,
    correlationId: string,
  ): Promise<ISecurityVulnerability[]> {
    try {
      // npm audit returns non-zero exit code if vulnerabilities found
      const { stdout } = await execAsync('npm audit --json', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch((e) => ({ stdout: e.stdout || '{}' }));

      const audit = JSON.parse(stdout);
      return this.parseNpmAudit(audit, correlationId);
    } catch (error) {
      this.logger.error(`[${correlationId}] npm audit failed: ${(error as Error).message}`);
      return [];
    }
  }

  private parseNpmAudit(audit: unknown, correlationId: string): ISecurityVulnerability[] {
    const vulnerabilities: ISecurityVulnerability[] = [];

    for (const [pkgName, vuln] of Object.entries(
      (audit as Record<string, unknown>).vulnerabilities || {},
    )) {
      const v = vuln as unknown as {
        severity: string;
        range?: string;
        via?: Array<{ title?: string; url?: string; cve?: string }>;
        fixAvailable?: { version?: string };
      };
      vulnerabilities.push({
        checkType: SecurityCheckType.DEPENDENCY,
        severity: this.mapNpmSeverity(v.severity),
        package: pkgName,
        version: v.range || 'unknown',
        vulnerableVersions: v.range || '*',
        patchedVersions: v.fixAvailable?.version,
        title: v.via?.[0]?.title || `Vulnerability in ${pkgName}`,
        description: v.via?.[0]?.url || '',
        cveId: v.via?.[0]?.cve,
        recommendation: v.fixAvailable
          ? `Upgrade to ${v.fixAvailable.version}`
          : 'Review and replace package',
      });
    }

    this.logger.debug(`[${correlationId}] Found ${vulnerabilities.length} npm vulnerabilities`);
    return vulnerabilities;
  }

  private async scanPip(
    workspacePath: string,
    correlationId: string,
  ): Promise<ISecurityVulnerability[]> {
    try {
      const { stdout } = await execAsync('pip-audit --format json', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch((e) => ({ stdout: e.stdout || '[]' }));

      const findings = JSON.parse(stdout);
      return findings.map(
        (f: {
          name: string;
          version: string;
          vulnerability?: {
            severity?: string;
            affected_versions?: string;
            fixed_versions?: string[];
            id?: string;
            description?: string;
            aliases?: string[];
          };
        }) => ({
          checkType: SecurityCheckType.DEPENDENCY,
          severity: this.mapPipSeverity(f.vulnerability?.severity),
          package: f.name,
          version: f.version,
          vulnerableVersions: f.vulnerability?.affected_versions || '*',
          patchedVersions: f.vulnerability?.fixed_versions?.[0],
          title: f.vulnerability?.id || `Vulnerability in ${f.name}`,
          description: f.vulnerability?.description || '',
          cveId: f.vulnerability?.aliases?.[0],
          recommendation: f.vulnerability?.fixed_versions?.[0]
            ? `Upgrade to ${f.vulnerability.fixed_versions[0]}`
            : 'Review and replace package',
        }),
      );
    } catch (_error) {
      this.logger.warn(`[${correlationId}] pip-audit not available or failed`);
      return [];
    }
  }

  private async scanGo(
    workspacePath: string,
    correlationId: string,
  ): Promise<ISecurityVulnerability[]> {
    try {
      // First verify go.sum integrity
      await execAsync('go mod verify', { cwd: workspacePath, timeout: this.timeoutMs });

      // Use govulncheck if available
      await execAsync('govulncheck -json ./...', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch(() => ({ stdout: '{}' }));

      // Parse govulncheck output
      const findings: ISecurityVulnerability[] = [];
      // Note: govulncheck JSON format parsing would go here
      // For now, returning empty since it requires more complex parsing
      return findings;
    } catch (_error) {
      this.logger.warn(`[${correlationId}] Go vulnerability scan failed`);
      return [];
    }
  }

  private mapNpmSeverity(severity: string): SecuritySeverity {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return SecuritySeverity.CRITICAL;
      case 'high':
        return SecuritySeverity.HIGH;
      case 'moderate':
        return SecuritySeverity.MEDIUM;
      case 'low':
        return SecuritySeverity.LOW;
      default:
        return SecuritySeverity.INFO;
    }
  }

  private mapPipSeverity(severity?: string): SecuritySeverity {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL':
        return SecuritySeverity.CRITICAL;
      case 'HIGH':
        return SecuritySeverity.HIGH;
      case 'MEDIUM':
        return SecuritySeverity.MEDIUM;
      case 'LOW':
        return SecuritySeverity.LOW;
      default:
        return SecuritySeverity.INFO;
    }
  }
}
