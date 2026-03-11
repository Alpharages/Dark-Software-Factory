import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ProjectIntegration, IntegrationProvider, Prisma } from '@prisma/client';

@Injectable()
export class ProjectIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async createIntegration(
    data: Prisma.ProjectIntegrationUncheckedCreateInput,
  ): Promise<ProjectIntegration> {
    const encryptedData = { ...data };

    if (data.access_token) {
      encryptedData.access_token = this.encryption.encrypt(data.access_token);
    }
    if (data.refresh_token) {
      encryptedData.refresh_token = this.encryption.encrypt(data.refresh_token);
    }
    if (data.webhook_secret) {
      encryptedData.webhook_secret = this.encryption.encrypt(data.webhook_secret);
    }

    const created = await this.prisma.projectIntegration.create({
      data: encryptedData,
    });

    return this.decryptTokens(created);
  }

  async updateIntegration(
    id: string,
    data: Prisma.ProjectIntegrationUncheckedUpdateInput,
  ): Promise<ProjectIntegration> {
    const encryptedData = { ...data };

    if (typeof data.access_token === 'string') {
      encryptedData.access_token = this.encryption.encrypt(data.access_token);
    }
    if (typeof data.refresh_token === 'string') {
      encryptedData.refresh_token = this.encryption.encrypt(data.refresh_token);
    }
    if (typeof data.webhook_secret === 'string') {
      encryptedData.webhook_secret = this.encryption.encrypt(data.webhook_secret);
    }

    const updated = await this.prisma.projectIntegration.update({
      where: { id },
      data: encryptedData,
    });

    return this.decryptTokens(updated);
  }

  async findByProjectAndProvider(
    projectId: string,
    provider: IntegrationProvider,
  ): Promise<ProjectIntegration | null> {
    const integration = await this.prisma.projectIntegration.findUnique({
      where: { project_id_provider: { project_id: projectId, provider } },
    });

    if (!integration) return null;

    return this.decryptTokens(integration);
  }

  async getDecryptedIntegration(id: string): Promise<ProjectIntegration | null> {
    const integration = await this.prisma.projectIntegration.findUnique({
      where: { id },
    });

    if (!integration) return null;

    return this.decryptTokens(integration);
  }

  private decryptTokens(integration: ProjectIntegration): ProjectIntegration {
    try {
      return {
        ...integration,
        access_token: integration.access_token
          ? this.encryption.decrypt(integration.access_token)
          : null,
        refresh_token: integration.refresh_token
          ? this.encryption.decrypt(integration.refresh_token)
          : null,
        webhook_secret: integration.webhook_secret
          ? this.encryption.decrypt(integration.webhook_secret)
          : null,
      };
    } catch (error) {
      throw new Error(
        `Failed to decrypt tokens for integration ${integration.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
