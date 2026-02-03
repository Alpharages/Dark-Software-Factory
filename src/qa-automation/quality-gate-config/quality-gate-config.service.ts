import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { CreateQualityGateConfigDto } from './dto/create-quality-gate-config.dto';
import { UpdateQualityGateConfigDto } from './dto/update-quality-gate-config.dto';
import { ConfigPreviewResponseDto } from './dto/config-preview.dto';
import {
  DEFAULT_THRESHOLDS,
  IQualityGateConfig,
  QualityCategory,
  IQualityThresholds,
} from '../interfaces';
import { QualityGateConfig, QualityGateConfigHistory, Prisma } from '@/prisma/client';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';

@Injectable()
export class QualityGateConfigService {
  private readonly logger = new Logger(QualityGateConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogger: AIDecisionLoggerService,
  ) {}

  /**
   * Get effective configuration for a project
   * Hierarchy: Project Config -> Global Config -> Hardcoded Defaults
   * AC#3: Partial configurations are merged with global defaults
   */
  async getEffectiveConfig(projectId?: string): Promise<IQualityGateConfig> {
    // 1. Get global config first as base
    const globalConfig = await this.prisma.qualityGateConfig.findUnique({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { projectId: null as any },
    });

    const baseConfig = globalConfig
      ? this.mapEntityToInterface(globalConfig)
      : this.getDefaultConfig();

    // 2. If no projectId, return base (global)
    if (!projectId) {
      return baseConfig;
    }

    // 3. Try to find project-specific config
    const projectConfig = await this.prisma.qualityGateConfig.findUnique({
      where: { projectId },
    });

    if (!projectConfig) {
      return { ...baseConfig, projectId };
    }

    // 4. Merge project-specific settings with global defaults (AC#3)
    const projectInterface = this.mapEntityToInterface(projectConfig);

    return {
      ...baseConfig,
      projectId,
      thresholds: {
        ...baseConfig.thresholds,
        ...projectInterface.thresholds,
      },
      enabledCategories: projectInterface.enabledCategories, // Enabled categories are usually set as a whole array
      allowOverride: projectInterface.allowOverride,
      overrideRequiresApproval: projectInterface.overrideRequiresApproval,
    };
  }

  /**
   * Get specific project config (no fallback)
   */
  async getProjectConfig(projectId: string): Promise<QualityGateConfig | null> {
    return this.prisma.qualityGateConfig.findUnique({
      where: { projectId },
    });
  }

  /**
   * Create or Update project configuration
   */
  async updateProjectConfig(
    projectId: string,
    dto: UpdateQualityGateConfigDto,
    userId: string,
  ): Promise<QualityGateConfig> {
    return this.upsertConfig(dto, userId, projectId);
  }

  /**
   * Update global defaults
   */
  async updateGlobalConfig(
    dto: UpdateQualityGateConfigDto,
    userId: string,
  ): Promise<QualityGateConfig> {
    return this.upsertConfig(dto, userId, null);
  }

  /**
   * Get configuration history
   */
  async getConfigHistory(projectId?: string, limit = 20): Promise<QualityGateConfigHistory[]> {
    const where: Prisma.QualityGateConfigHistoryWhereInput = projectId
      ? { projectId }
      : { projectId: null };

    return this.prisma.qualityGateConfigHistory.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: limit,
      include: { changedBy: { select: { id: true, full_name: true, email: true } } },
    });
  }

  /**
   * Preview configuration impact using QAResult records (AC#6)
   */
  async previewConfigImpact(
    projectId: string,
    config: Partial<IQualityThresholds>,
  ): Promise<ConfigPreviewResponseDto> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const results = await this.prisma.qAResult.findMany({
      where: {
        execution: {
          ticket: {
            project_id: projectId,
          },
        },
        created_at: { gte: thirtyDaysAgo },
      },
      include: {
        execution: true,
      },
    });

    const totalTicketsAnalyzed = results.length;
    let wouldPass = 0;
    let wouldFail = 0;
    let currentPassCount = 0;
    const failureBreakdown: Record<string, number> = {};

    // Get effective thresholds for evaluation (merged with defaults)
    const currentConfig = await this.getEffectiveConfig(projectId);
    const newThresholds = { ...currentConfig.thresholds, ...config };

    for (const res of results) {
      if (res.overall_passed) currentPassCount++;

      // Simplified re-evaluation logic for preview
      let passed = true;
      const data = res as unknown as {
        test_coverage?: number;
        test_results?: { passed: number; failed: number };
        linting_errors?: { errorCount: number };
      };

      // Check minCoverage
      const coverage = data.test_coverage ?? 0;
      if (coverage < (newThresholds.minCoverage ?? 0)) {
        passed = false;
        failureBreakdown['minCoverage'] = (failureBreakdown['minCoverage'] || 0) + 1;
      }

      // Check test pass rate
      const testResults = data.test_results || { passed: 0, failed: 0 };
      const total = testResults.passed + testResults.failed;
      const passRate = total > 0 ? (testResults.passed / total) * 100 : 100;
      if (passRate < (newThresholds.minTestPassRate ?? 0)) {
        passed = false;
        failureBreakdown['minTestPassRate'] = (failureBreakdown['minTestPassRate'] || 0) + 1;
      }

      // Check linting
      const lintErrors = data.linting_errors?.errorCount || 0;
      if (lintErrors > (newThresholds.maxLintingErrors ?? 0)) {
        passed = false;
        failureBreakdown['maxLintingErrors'] = (failureBreakdown['maxLintingErrors'] || 0) + 1;
      }

      if (passed) wouldPass++;
      else wouldFail++;
    }

    const currentPassRate =
      totalTicketsAnalyzed > 0 ? (currentPassCount / totalTicketsAnalyzed) * 100 : 0;
    const impactCount = wouldPass - currentPassCount;
    const impact =
      impactCount >= 0
        ? `+${impactCount} tickets would pass with new configuration`
        : `${impactCount} tickets would fail with new configuration`;

    return {
      previewResults: {
        totalTicketsAnalyzed,
        wouldPass,
        wouldFail,
        currentPassRate,
        impact,
      },
      failureBreakdown,
    };
  }

  /**
   * Clone config from source project to target projects
   */
  async cloneConfig(
    sourceProjectId: string,
    targetProjectIds: string[],
    userId: string,
  ): Promise<{ successCount: number; failures: string[] }> {
    const sourceConfig = await this.getProjectConfig(sourceProjectId);
    if (!sourceConfig) {
      throw new NotFoundException(`Source configuration for project ${sourceProjectId} not found`);
    }

    const failures: string[] = [];
    let successCount = 0;

    for (const targetId of targetProjectIds) {
      try {
        const dto: UpdateQualityGateConfigDto = {
          thresholds: {
            minTestPassRate: sourceConfig.minTestPassRate,
            minCoverage: sourceConfig.minCoverage,
            targetCoverage: sourceConfig.targetCoverage,
            maxLintingErrors: sourceConfig.maxLintingErrors,
            maxLintingWarnings: sourceConfig.maxLintingWarnings,
            blockOnCriticalSecurity: sourceConfig.blockOnCriticalSecurity,
            blockOnHighSecurity: sourceConfig.blockOnHighSecurity,
            maxComplexity: sourceConfig.maxComplexity,
          },
          enabledCategories: sourceConfig.enabledCategories as unknown as QualityCategory[],
          allowOverride: sourceConfig.allowOverride,
          overrideRequiresApproval: sourceConfig.overrideRequiresApproval,
          reason: `Cloned from project ${sourceProjectId}`,
        };
        await this.updateProjectConfig(targetId, dto, userId);
        successCount++;
      } catch (error) {
        this.logger.error(`Failed to clone config to project ${targetId}`, error);
        failures.push(targetId);
      }
    }

    return { successCount, failures };
  }

  /**
   * Seed global defaults from environment variables
   * Used for migration/bootstrap
   */
  async seedGlobalDefaultsFromEnv(userId: string): Promise<QualityGateConfig> {
    const existing = await this.prisma.qualityGateConfig.findUnique({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { projectId: null as any },
    });

    if (existing) {
      this.logger.log('Global defaults already exist, skipping seed.');
      return existing;
    }

    const defaultConfig = this.getDefaultConfig();

    const dto: CreateQualityGateConfigDto = {
      thresholds: defaultConfig.thresholds,
      enabledCategories: defaultConfig.enabledCategories,
      allowOverride: defaultConfig.allowOverride,
      overrideRequiresApproval: defaultConfig.overrideRequiresApproval,
      reason: 'Initial seed from system defaults',
    };

    return this.upsertConfig(dto, userId, null);
  }

  private async upsertConfig(
    dto: UpdateQualityGateConfigDto | CreateQualityGateConfigDto,
    userId: string,
    projectId: string | null,
  ): Promise<QualityGateConfig> {
    // 1. Fetch existing to decide if create or update
    const existing = await this.prisma.qualityGateConfig.findUnique({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { projectId: projectId !== null ? projectId : (null as any) },
    });

    // Prepare data
    const data = {
      minTestPassRate: dto.thresholds?.minTestPassRate,
      minCoverage: dto.thresholds?.minCoverage,
      targetCoverage: dto.thresholds?.targetCoverage,
      maxLintingErrors: dto.thresholds?.maxLintingErrors,
      maxLintingWarnings: dto.thresholds?.maxLintingWarnings,
      blockOnCriticalSecurity: dto.thresholds?.blockOnCriticalSecurity,
      blockOnHighSecurity: dto.thresholds?.blockOnHighSecurity,
      maxComplexity: dto.thresholds?.maxComplexity,
      allowOverride: dto.allowOverride,
      overrideRequiresApproval: dto.overrideRequiresApproval,
      enabledCategories: dto.enabledCategories as unknown as Prisma.InputJsonValue,
    };

    // Filter undefined values
    const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let config: QualityGateConfig;
      let action: string;

      if (existing) {
        action = 'QUALITY_GATE_CONFIG_UPDATED';
        config = await tx.qualityGateConfig.update({
          where: { id: existing.id },
          data: {
            ...cleanData,
            version: { increment: 1 },
            updatedById: userId,
          },
        });
      } else {
        action = 'QUALITY_GATE_CONFIG_CREATED';
        config = await tx.qualityGateConfig.create({
          data: {
            projectId,
            ...this.mapDtoToEntityData(dto),
            createdById: userId,
            updatedById: userId,
          },
        });
      }

      // Create history record
      await tx.qualityGateConfigHistory.create({
        data: {
          configId: config.id,
          projectId,
          version: config.version,
          snapshot: config as unknown as Prisma.InputJsonValue,
          changedById: userId,
          changeReason: dto.reason || (existing ? 'Update' : 'Initial creation'),
        },
      });

      const inputData = existing
        ? (existing as unknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);
      const outputData = config as unknown as Record<string, unknown>;

      // Integrate AIDecisionLogger (AC#1 audit requirement)
      await this.auditLogger.logDecision({
        agentName: 'QualityGateConfigService',
        action: action,
        reasoning:
          dto.reason || (existing ? 'Configuration update' : 'Initial configuration creation'),
        ticketId: 'SYSTEM', // System-level config
        inputData,
        outputData,
        confidence: 1.0,
      });

      return config;
    });
  }

  private mapDtoToEntityData(dto: Partial<CreateQualityGateConfigDto>) {
    return {
      minTestPassRate: dto.thresholds?.minTestPassRate ?? DEFAULT_THRESHOLDS.minTestPassRate,
      minCoverage: dto.thresholds?.minCoverage ?? DEFAULT_THRESHOLDS.minCoverage,
      targetCoverage: dto.thresholds?.targetCoverage ?? DEFAULT_THRESHOLDS.targetCoverage,
      maxLintingErrors: dto.thresholds?.maxLintingErrors ?? DEFAULT_THRESHOLDS.maxLintingErrors,
      maxLintingWarnings:
        dto.thresholds?.maxLintingWarnings ?? DEFAULT_THRESHOLDS.maxLintingWarnings,
      blockOnCriticalSecurity:
        dto.thresholds?.blockOnCriticalSecurity ?? DEFAULT_THRESHOLDS.blockOnCriticalSecurity,
      blockOnHighSecurity:
        dto.thresholds?.blockOnHighSecurity ?? DEFAULT_THRESHOLDS.blockOnHighSecurity,
      maxComplexity: dto.thresholds?.maxComplexity ?? DEFAULT_THRESHOLDS.maxComplexity,
      allowOverride: dto.allowOverride ?? false,
      overrideRequiresApproval: dto.overrideRequiresApproval ?? true,
      enabledCategories: (dto.enabledCategories ?? [
        QualityCategory.LINTING,
        QualityCategory.TESTING,
        QualityCategory.COVERAGE,
        QualityCategory.SECURITY,
      ]) as unknown as Prisma.InputJsonValue,
    };
  }

  private mapEntityToInterface(entity: QualityGateConfig): IQualityGateConfig {
    const categories = entity.enabledCategories as string[];

    return {
      projectId: entity.projectId,
      thresholds: {
        minTestPassRate: entity.minTestPassRate,
        minCoverage: entity.minCoverage,
        targetCoverage: entity.targetCoverage,
        maxLintingErrors: entity.maxLintingErrors,
        maxLintingWarnings: entity.maxLintingWarnings,
        blockOnCriticalSecurity: entity.blockOnCriticalSecurity,
        blockOnHighSecurity: entity.blockOnHighSecurity,
        maxComplexity: entity.maxComplexity,
      },
      enabledCategories: categories.map((c) => c as QualityCategory),
      allowOverride: entity.allowOverride,
      overrideRequiresApproval: entity.overrideRequiresApproval,
    };
  }

  private getDefaultConfig(): IQualityGateConfig {
    const thresholds: IQualityThresholds = {
      minTestPassRate: this.configService.get<number>(
        'qualityGate.minTestPassRate',
        DEFAULT_THRESHOLDS.minTestPassRate,
      ),
      minCoverage: this.configService.get<number>(
        'qualityGate.minCoverage',
        DEFAULT_THRESHOLDS.minCoverage,
      ),
      maxLintingErrors: this.configService.get<number>(
        'qualityGate.maxLintingErrors',
        DEFAULT_THRESHOLDS.maxLintingErrors,
      ),
      maxLintingWarnings: this.configService.get<number>(
        'qualityGate.maxLintingWarnings',
        DEFAULT_THRESHOLDS.maxLintingWarnings,
      ),
      blockOnCriticalSecurity: this.configService.get<boolean>(
        'qualityGate.blockOnCriticalSecurity',
        DEFAULT_THRESHOLDS.blockOnCriticalSecurity,
      ),
      blockOnHighSecurity: this.configService.get<boolean>(
        'qualityGate.blockOnHighSecurity',
        DEFAULT_THRESHOLDS.blockOnHighSecurity,
      ),
      maxComplexity: this.configService.get<number>(
        'qualityGate.maxComplexity',
        DEFAULT_THRESHOLDS.maxComplexity,
      ),
      targetCoverage: this.configService.get<number>(
        'qualityGate.targetCoverage',
        DEFAULT_THRESHOLDS.targetCoverage,
      ),
    } as IQualityThresholds;

    const allowOverride = this.configService.get<boolean>('qualityGate.allowOverride', false);

    return {
      projectId: null,
      thresholds,
      enabledCategories: [
        QualityCategory.LINTING,
        QualityCategory.TESTING,
        QualityCategory.COVERAGE,
        QualityCategory.SECURITY,
      ],
      allowOverride,
      overrideRequiresApproval: true,
    };
  }
}
