/**
 * QA Sampling Config Service
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * Manages the QA sampling configuration in the database
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/logger/logger.service';
import { ISamplingConfig, IRiskRules } from '../interfaces/qa-sampling.interface';

/**
 * Default risk rules
 */
const DEFAULT_RISK_RULES: IRiskRules = {
  fileCount: {
    highThreshold: 10,
    mediumThreshold: 5,
    highMultiplier: 100,
    mediumMultiplier: 2.0,
  },
  complexity: {
    highThreshold: 10,
    mediumThreshold: 5,
    highMultiplier: 100,
    mediumMultiplier: 1.5,
  },
  aiProvider: {
    geminiMultiplier: 1.2,
    claudeMultiplier: 1.0,
  },
};

/**
 * Input for creating/updating sampling config
 */
export interface ISamplingConfigInput {
  percentage: number;
  riskBasedEnabled: boolean;
  riskRules?: IRiskRules;
  randomSeed?: string;
}

@Injectable()
export class QaSamplingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get the current sampling configuration
   * Returns the first config found, or creates a default one if none exists
   * @returns Sampling configuration
   */
  async getConfig(): Promise<ISamplingConfig> {
    const config = await this.prisma.qaSamplingConfig.findFirst({
      orderBy: { created_at: 'desc' },
    });

    if (!config) {
      this.logger.debug('No sampling config found, returning default');
      return this.getDefaultConfig();
    }

    return this.mapToInterface(config);
  }

  /**
   * Get configuration by ID
   * @param id - Config ID
   * @returns Sampling configuration or null
   */
  async getConfigById(id: string): Promise<ISamplingConfig | null> {
    const config = await this.prisma.qaSamplingConfig.findUnique({
      where: { id },
    });

    if (!config) {
      return null;
    }

    return this.mapToInterface(config);
  }

  /**
   * Update or create the sampling configuration
   * Uses upsert pattern - always maintains a single config record
   * @param input - Configuration input
   * @returns Updated configuration
   */
  async updateConfig(input: ISamplingConfigInput): Promise<ISamplingConfig> {
    this.logger.debug(`Updating sampling config: ${input.percentage}%`);

    // Validate percentage
    const percentage = Math.max(0, Math.min(100, input.percentage));

    // Get existing config to update, or create new
    const existing = await this.prisma.qaSamplingConfig.findFirst({
      orderBy: { created_at: 'desc' },
    });

    let config;
    if (existing) {
      config = await this.prisma.qaSamplingConfig.update({
        where: { id: existing.id },
        data: {
          percentage: new Prisma.Decimal(percentage),
          risk_based_enabled: input.riskBasedEnabled,
          risk_rules: (input.riskRules || DEFAULT_RISK_RULES) as unknown as Prisma.InputJsonValue,
          random_seed: input.randomSeed || null,
        },
      });
      this.logger.debug(`Updated sampling config ${config.id}`);
    } else {
      config = await this.prisma.qaSamplingConfig.create({
        data: {
          percentage: new Prisma.Decimal(percentage),
          risk_based_enabled: input.riskBasedEnabled,
          risk_rules: (input.riskRules || DEFAULT_RISK_RULES) as unknown as Prisma.InputJsonValue,
          random_seed: input.randomSeed || null,
        },
      });
      this.logger.debug(`Created sampling config ${config.id}`);
    }

    return this.mapToInterface(config);
  }

  /**
   * Create a new configuration (keeps history)
   * Unlike updateConfig, this always creates a new record
   * @param input - Configuration input
   * @returns Created configuration
   */
  async createConfig(input: ISamplingConfigInput): Promise<ISamplingConfig> {
    this.logger.debug(`Creating new sampling config: ${input.percentage}%`);

    // Validate percentage
    const percentage = Math.max(0, Math.min(100, input.percentage));

    const config = await this.prisma.qaSamplingConfig.create({
      data: {
        percentage: new Prisma.Decimal(percentage),
        risk_based_enabled: input.riskBasedEnabled,
        risk_rules: (input.riskRules || DEFAULT_RISK_RULES) as unknown as Prisma.InputJsonValue,
        random_seed: input.randomSeed || null,
      },
    });

    this.logger.debug(`Created sampling config ${config.id}`);
    return this.mapToInterface(config);
  }

  /**
   * Get default configuration
   * Used when no config exists in database
   */
  getDefaultConfig(): ISamplingConfig {
    return {
      id: 'default',
      percentage: this.configService.get<number>('qaReview.sampling.defaultPercentage', 20),
      riskBasedEnabled: this.configService.get<boolean>('qaReview.sampling.riskBasedEnabled', true),
      riskRules: DEFAULT_RISK_RULES,
    };
  }

  /**
   * Get configuration history
   * @param limit - Number of records to return
   * @returns List of configurations
   */
  async getConfigHistory(limit: number = 10): Promise<ISamplingConfig[]> {
    const configs = await this.prisma.qaSamplingConfig.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return configs.map((c) => this.mapToInterface(c));
  }

  /**
   * Validate risk rules
   * @param rules - Rules to validate
   * @returns Validated rules
   */
  validateRiskRules(rules: Partial<IRiskRules>): IRiskRules {
    return {
      fileCount: {
        highThreshold: rules.fileCount?.highThreshold ?? DEFAULT_RISK_RULES.fileCount.highThreshold,
        mediumThreshold:
          rules.fileCount?.mediumThreshold ?? DEFAULT_RISK_RULES.fileCount.mediumThreshold,
        highMultiplier:
          rules.fileCount?.highMultiplier ?? DEFAULT_RISK_RULES.fileCount.highMultiplier,
        mediumMultiplier:
          rules.fileCount?.mediumMultiplier ?? DEFAULT_RISK_RULES.fileCount.mediumMultiplier,
      },
      complexity: {
        highThreshold:
          rules.complexity?.highThreshold ?? DEFAULT_RISK_RULES.complexity.highThreshold,
        mediumThreshold:
          rules.complexity?.mediumThreshold ?? DEFAULT_RISK_RULES.complexity.mediumThreshold,
        highMultiplier:
          rules.complexity?.highMultiplier ?? DEFAULT_RISK_RULES.complexity.highMultiplier,
        mediumMultiplier:
          rules.complexity?.mediumMultiplier ?? DEFAULT_RISK_RULES.complexity.mediumMultiplier,
      },
      aiProvider: {
        geminiMultiplier:
          rules.aiProvider?.geminiMultiplier ?? DEFAULT_RISK_RULES.aiProvider.geminiMultiplier,
        claudeMultiplier:
          rules.aiProvider?.claudeMultiplier ?? DEFAULT_RISK_RULES.aiProvider.claudeMultiplier,
      },
    };
  }

  /**
   * Map database entity to interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapToInterface(config: any): ISamplingConfig {
    const riskRules = config.risk_rules as IRiskRules | undefined;

    return {
      id: config.id,
      percentage: parseFloat(config.percentage.toString()),
      riskBasedEnabled: config.risk_based_enabled,
      riskRules: riskRules || DEFAULT_RISK_RULES,
      randomSeed: config.random_seed,
    };
  }
}
