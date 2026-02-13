import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SystemConfig } from '@/prisma/client';

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get a configuration value with fallback to environment variables
   */
  async get(key: string, defaultValue?: string): Promise<string> {
    // 1. Try DB
    const config = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (config) {
      return config.value;
    }

    // 2. Try Env (Upper snake case convention)
    const envKey = key.toUpperCase().replace(/\./g, '_');
    const envValue = this.configService.get<string>(envKey);

    if (envValue !== undefined) {
      return envValue;
    }

    // 3. Default
    return defaultValue ?? '';
  }

  /**
   * Get all configuration entries
   */
  async getAll(): Promise<SystemConfig[]> {
    return this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Set a configuration value
   */
  async set(
    key: string,
    value: string,
    description?: string,
    is_secret: boolean = false,
    updatedBy?: string,
  ): Promise<SystemConfig> {
    this.logger.log(`Updating config key: ${key}, user: ${updatedBy}`);
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: {
        value,
        description,
        is_secret,
        updated_by: updatedBy,
      },
      create: {
        key,
        value,
        description,
        is_secret,
        updated_by: updatedBy,
      },
    });
  }

  /**
   * Reset a configuration to default (delete from DB, falling back to env)
   */
  /**
   * Reset a configuration to default (delete from DB, falling back to env)
   */
  async reset(key: string, updatedBy?: string): Promise<void> {
    this.logger.log(`Resetting config key: ${key}, user: ${updatedBy}`);
    try {
      await this.prisma.systemConfig.delete({ where: { key } });
    } catch (_error) {
      // Ignore if not found
      this.logger.warn(`Failed to reset config ${key}: ${(_error as Error).message}`);
    }
  }

  /**
   * Reset all configurations to defaults (delete all from DB)
   */
  async resetAll(updatedBy?: string): Promise<void> {
    this.logger.log(`Resetting ALL configs, user: ${updatedBy}`);
    await this.prisma.systemConfig.deleteMany({});
  }
}
