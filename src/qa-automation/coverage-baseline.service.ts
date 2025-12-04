import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ICoverageData, ICoverageBaseline } from './interfaces';

@Injectable()
export class CoverageBaselineService {
  private readonly logger = new Logger(CoverageBaselineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get baseline for project and branch
   * Falls back to main branch if specified branch not found
   */
  async getBaseline(projectId: string, branch: string = 'main'): Promise<ICoverageBaseline | null> {
    try {
      const baseline = await this.prisma.coverageBaseline.findUnique({
        where: {
          project_id_branch: {
            project_id: projectId,
            branch: branch,
          },
        },
      });

      if (!baseline && branch !== 'main') {
        this.logger.debug(`Baseline not found for ${branch}, falling back to main`);
        return this.getBaseline(projectId, 'main');
      }

      if (!baseline) {
        return null;
      }

      return {
        id: baseline.id,
        projectId: baseline.project_id,
        branch: baseline.branch,
        coverage: {
          lines: baseline.lines,
          branches: baseline.branches,
          functions: baseline.functions,
          statements: baseline.statements,
        },
        createdAt: baseline.created_at,
        updatedAt: baseline.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to get baseline: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Save or update baseline
   */
  async saveBaseline(
    projectId: string,
    branch: string,
    coverage: ICoverageData,
  ): Promise<ICoverageBaseline> {
    try {
      const baseline = await this.prisma.coverageBaseline.upsert({
        where: {
          project_id_branch: {
            project_id: projectId,
            branch: branch,
          },
        },
        update: {
          lines: coverage.lines,
          branches: coverage.branches,
          functions: coverage.functions,
          statements: coverage.statements,
        },
        create: {
          project_id: projectId,
          branch: branch,
          lines: coverage.lines,
          branches: coverage.branches,
          functions: coverage.functions,
          statements: coverage.statements,
        },
      });

      this.logger.log(`Saved baseline for ${projectId}/${branch}`);

      return {
        id: baseline.id,
        projectId: baseline.project_id,
        branch: baseline.branch,
        coverage: {
          lines: baseline.lines,
          branches: baseline.branches,
          functions: baseline.functions,
          statements: baseline.statements,
        },
        createdAt: baseline.created_at,
        updatedAt: baseline.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to save baseline: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Ensure a baseline exists (create initial if missing)
   */
  async ensureBaseline(
    projectId: string,
    branch: string,
    initialCoverage: ICoverageData,
  ): Promise<void> {
    const existing = await this.getBaseline(projectId, branch);
    if (!existing) {
      await this.saveBaseline(projectId, branch, initialCoverage);
    }
  }

  /**
   * Get per-project threshold override
   * Returns null if no override (use global)
   */
  async getProjectThreshold(projectId: string): Promise<number | null> {
    try {
      const config = await this.prisma.projectCoverageConfig.findUnique({
        where: { project_id: projectId },
      });
      return config?.threshold ?? null;
    } catch (error) {
      this.logger.error(`Failed to get project threshold: ${(error as Error).message}`);
      return null;
    }
  }
}
