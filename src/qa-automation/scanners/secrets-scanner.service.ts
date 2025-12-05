import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ISecretFinding,
  SecurityCheckType,
  SECRET_PATTERNS,
  EXCLUDED_PATHS,
  EXCLUDED_EXTENSIONS,
  EXCLUDED_FILES,
} from '../interfaces';

@Injectable()
export class SecretsScannerService {
  private readonly logger = new Logger(SecretsScannerService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.secretsScanTimeoutMs', 30000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecretFinding[]> {
    const findings: ISecretFinding[] = [];
    const files = await this.getSourceFiles(workspacePath);

    this.logger.debug(`[${correlationId}] Scanning ${files.length} files for secrets`);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          for (const pattern of SECRET_PATTERNS) {
            const matches = line.matchAll(pattern.pattern);

            for (const match of matches) {
              // Apply context validator if defined
              if (pattern.contextValidator && !pattern.contextValidator(match[0], line)) {
                continue;
              }

              findings.push({
                checkType: SecurityCheckType.SECRET,
                severity: pattern.severity,
                filePath: path.relative(workspacePath, filePath),
                lineNumber: lineNum + 1,
                secretType: pattern.type,
                maskedValue: this.maskSecret(match[0]),
                recommendation: `Remove ${pattern.type} from source code. Use environment variables instead.`,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `[${correlationId}] Could not scan ${filePath}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.debug(`[${correlationId}] Found ${findings.length} potential secrets`);
    return findings;
  }

  private async getSourceFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip excluded directories
        if (entry.isDirectory()) {
          if (!EXCLUDED_PATHS.includes(entry.name as (typeof EXCLUDED_PATHS)[number])) {
            await walk(fullPath);
          }
          continue;
        }

        // Skip excluded files and extensions
        if (EXCLUDED_FILES.includes(entry.name as (typeof EXCLUDED_FILES)[number])) continue;
        if (EXCLUDED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

        files.push(fullPath);
      }
    };

    await walk(dirPath);
    return files;
  }

  private maskSecret(value: string): string {
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }
}
