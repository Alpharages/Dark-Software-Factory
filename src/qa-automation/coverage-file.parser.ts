import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IFileCoverage, IIstanbulCoverageSummary, ICoverageData } from './interfaces';

/**
 * Parses Istanbul/nyc coverage-summary.json for file-level coverage data
 */
@Injectable()
export class CoverageFileParser {
  private readonly logger = new Logger(CoverageFileParser.name);

  /**
   * Parse coverage-summary.json from workspace
   * Returns null if file doesn't exist (graceful fallback)
   */
  async parseCoverageSummary(
    workspacePath: string,
    threshold: number,
  ): Promise<{ files: IFileCoverage[]; aggregate: ICoverageData } | null> {
    const summaryPath = path.join(workspacePath, 'coverage', 'coverage-summary.json');

    try {
      const content = await fs.readFile(summaryPath, 'utf-8');
      const summary: IIstanbulCoverageSummary = JSON.parse(content);

      const files: IFileCoverage[] = [];

      for (const [filePath, data] of Object.entries(summary)) {
        // Skip 'total' entry
        if (filePath === 'total') continue;

        // Type guard for data
        if (!('lines' in data)) continue;

        const fileCoverage: IFileCoverage = {
          filePath,
          lines: data.lines.pct,
          branches: data.branches.pct,
          functions: data.functions.pct,
          statements: data.statements.pct,
          uncoveredLines: await this.getUncoveredLines(workspacePath, filePath),
          isBelowThreshold: data.lines.pct < threshold,
        };

        files.push(fileCoverage);
      }

      const aggregate: ICoverageData = {
        lines: summary.total.lines.pct,
        branches: summary.total.branches.pct,
        functions: summary.total.functions.pct,
        statements: summary.total.statements.pct,
      };

      this.logger.debug(`Parsed coverage for ${files.length} files`);
      return { files, aggregate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(`Coverage summary not found at ${summaryPath}`);
        return null;
      }
      this.logger.error(`Failed to parse coverage summary: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get uncovered line numbers from lcov.info
   * Falls back to empty array if not available
   */
  private async getUncoveredLines(workspacePath: string, filePath: string): Promise<number[]> {
    const lcovPath = path.join(workspacePath, 'coverage', 'lcov.info');

    try {
      const content = await fs.readFile(lcovPath, 'utf-8');
      const uncoveredLines: number[] = [];

      // Parse lcov format
      const lines = content.split('\n');
      let inFile = false;

      for (const line of lines) {
        if (line.startsWith('SF:') && line.includes(filePath)) {
          inFile = true;
        } else if (line === 'end_of_record') {
          inFile = false;
        } else if (inFile && line.startsWith('DA:')) {
          // DA:lineNumber,hitCount
          const [, data] = line.split(':');
          if (data) {
            const [lineNum, hits] = data.split(',').map(Number);
            if (hits === 0) {
              uncoveredLines.push(lineNum);
            }
          }
        }
      }

      return uncoveredLines;
    } catch {
      return [];
    }
  }
}
