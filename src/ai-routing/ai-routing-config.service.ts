import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AIProvider } from '@prisma/client';
import { UpdateAiRoutingConfigDto, EffectiveAiRoutingConfigDto } from './dto/ai-routing-config.dto';

/**
 * L1: System Defaults — last-resort values when no DB row exists.
 * Thresholds set to 10/40 to reflect real-world complexity score distribution.
 */
export const DEFAULT_AI_ROUTING: EffectiveAiRoutingConfigDto = {
  primaryProviderOverride: null,
  complexityThresholdHigh: 40,
  complexityThresholdMedium: 10,
  tierLowPrimary: AIProvider.KIMI,
  tierLowFallback: AIProvider.CLAUDE_CODE,
  tierMediumPrimary: AIProvider.CLAUDE_CODE,
  tierMediumFallback: AIProvider.GEMINI,
  tierHighPrimary: AIProvider.CLAUDE_CODE,
  tierHighFallback: AIProvider.CODEX,
};

@Injectable()
export class AiRoutingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get effective configuration for a project.
   * Resolution order: L1 (hardcoded defaults) → L2 (global DB row) → L3 (project DB row)
   */
  async getEffectiveConfig(projectId?: string): Promise<EffectiveAiRoutingConfigDto> {
    const effective = { ...DEFAULT_AI_ROUTING };

    const [globalConfig, projectConfig] = await Promise.all([
      this.prisma.aiRoutingConfig.findFirst({ where: { projectId: { equals: null } } }),
      projectId
        ? this.prisma.aiRoutingConfig.findUnique({ where: { projectId } })
        : Promise.resolve(null),
    ]);

    if (globalConfig) this.mergeConfig(effective, globalConfig as Record<string, unknown>);
    if (projectConfig) this.mergeConfig(effective, projectConfig as Record<string, unknown>);

    return effective;
  }

  /**
   * Upsert the global (singleton) config row.
   * The global row is always fully populated — undefined fields are filled from defaults.
   */
  async upsertGlobalConfig(userId: string, data: UpdateAiRoutingConfigDto) {
    await this.validateThresholds(data);
    return this.prisma.aiRoutingConfig.upsert({
      where: { projectId: undefined as unknown as string },
      update: { ...data, updatedById: userId },
      create: { ...data, projectId: null, updatedById: userId },
    });
  }

  /**
   * Upsert a project-level override row.
   * Only explicitly provided fields are stored; null fields mean "inherit from global".
   */
  async upsertProjectConfig(projectId: string, userId: string, data: UpdateAiRoutingConfigDto) {
    await this.validateThresholds(data, projectId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    return this.prisma.aiRoutingConfig.upsert({
      where: { projectId },
      update: { ...data, updatedById: userId },
      create: { ...data, projectId, updatedById: userId },
    });
  }

  /**
   * Remove project override — project reverts to global/default config.
   * Uses deleteMany to avoid throwing if no override row exists (idempotent).
   */
  async deleteProjectConfig(projectId: string) {
    return this.prisma.aiRoutingConfig.deleteMany({ where: { projectId } });
  }

  /**
   * Guard: complexityThresholdHigh must always be strictly greater than complexityThresholdMedium.
   * When only one is provided, the other is resolved from the current effective config.
   */
  private async validateThresholds(data: UpdateAiRoutingConfigDto, projectId?: string) {
    const { complexityThresholdHigh, complexityThresholdMedium } = data;
    if (complexityThresholdHigh === undefined && complexityThresholdMedium === undefined) return;

    if (complexityThresholdHigh !== undefined && complexityThresholdMedium !== undefined) {
      if (complexityThresholdHigh <= complexityThresholdMedium) {
        throw new BadRequestException(
          'complexityThresholdHigh must be greater than complexityThresholdMedium',
        );
      }
      return;
    }

    // One provided — resolve the other from current effective config
    const current = await this.getEffectiveConfig(projectId);
    const high = complexityThresholdHigh ?? current.complexityThresholdHigh;
    const medium = complexityThresholdMedium ?? current.complexityThresholdMedium;
    if (high <= medium) {
      throw new BadRequestException(
        'complexityThresholdHigh must be greater than complexityThresholdMedium',
      );
    }
  }

  /**
   * Merge non-null source fields into the effective config target.
   * Null/undefined source fields are skipped (meaning "inherit from lower level").
   * Source is typed as a loose record because Prisma model fields use `T | null` not `T | undefined`.
   */
  private mergeConfig(target: EffectiveAiRoutingConfigDto, source: Record<string, unknown>) {
    const fields = Object.keys(DEFAULT_AI_ROUTING) as Array<keyof EffectiveAiRoutingConfigDto>;
    for (const field of fields) {
      // eslint-disable-next-line security/detect-object-injection
      const value = source[field];
      if (value !== undefined && value !== null) {
        // eslint-disable-next-line security/detect-object-injection
        (target as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }
}
