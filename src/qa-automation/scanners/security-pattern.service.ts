import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ISecurityPatternFinding,
  SecurityCheckType,
  OWASP_PATTERNS,
  EXCLUDED_PATHS,
} from '../interfaces';

@Injectable()
export class SecurityPatternService {
  private readonly logger = new Logger(SecurityPatternService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.patternScanTimeoutMs', 30000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecurityPatternFinding[]> {
    const findings: ISecurityPatternFinding[] = [];
    const files = await this.getSourceFiles(workspacePath);

    this.logger.debug(`[${correlationId}] Scanning ${files.length} files for security patterns`);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          for (const pattern of OWASP_PATTERNS) {
            // Reset regex lastIndex for each line
            pattern.pattern.lastIndex = 0;
            const match = pattern.pattern.exec(line);

            if (match) {
              findings.push({
                checkType: SecurityCheckType.PATTERN,
                severity: pattern.severity,
                filePath: path.relative(workspacePath, filePath),
                lineNumber: lineNum + 1,
                patternType: pattern.type,
                matchedCode: this.truncateCode(match[0]),
                owaspCategory: pattern.category,
                recommendation: pattern.recommendation,
              });
            }
          }
        }
      } catch (_error) {
        this.logger.warn(`[${correlationId}] Could not scan ${filePath}`);
      }
    }

    this.logger.debug(`[${correlationId}] Found ${findings.length} security pattern violations`);
    return findings;
  }

  private async getSourceFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const sourceExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go'];

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (EXCLUDED_PATHS.includes(entry.name as (typeof EXCLUDED_PATHS)[number])) {
            continue;
          }
          await walk(fullPath);
          continue;
        }

        if (sourceExtensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    await walk(dirPath);
    return files;
  }

  private truncateCode(code: string): string {
    return code.length > 100 ? `${code.slice(0, 100)}...` : code;
  }
}
