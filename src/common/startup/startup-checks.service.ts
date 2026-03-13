import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';

@Injectable()
export class StartupChecksService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.checkClickUpConfig();
  }

  private async checkClickUpConfig(): Promise<void> {
    const hasApiKey = !!this.config.get<string>('CLICKUP_API_KEY');

    if (!hasApiKey) {
      const oauthCount = await this.prisma.projectIntegration.count();
      if (oauthCount === 0) {
        this.logger.warn(
          '[CS1-7] WARNING: No CLICKUP_API_KEY set and no ProjectIntegration OAuth records found. ' +
            'ClickUp functionality is unavailable until a project connects via OAuth ' +
            '(/api/v1/integrations/:projectId/clickup/connect).',
          'StartupChecksService',
        );
      }
    }
  }
}
