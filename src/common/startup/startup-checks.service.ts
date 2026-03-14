import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';

@Injectable()
export class StartupChecksService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.checkClickUpConfig();
  }

  private async checkClickUpConfig(): Promise<void> {
    const oauthCount = await this.prisma.projectIntegration.count();
    if (oauthCount === 0) {
      this.logger.warn(
        'No ProjectIntegration OAuth records found. ' +
          'ClickUp functionality is unavailable until a project connects via OAuth ' +
          '(/api/v1/integrations/:projectId/clickup/connect).',
        'StartupChecksService',
      );
    }
  }
}
