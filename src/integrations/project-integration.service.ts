import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ProjectIntegration, IntegrationProvider, Prisma } from '@prisma/client';

export interface UpsertIntegrationData {
  workspace_id: string;
  workspace_name: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: Date | null;
  bot_user_id?: string | null;
  bot_username?: string | null;
  webhook_secret?: string | null;
  provider_config?: Record<string, unknown>;
  polling_enabled?: boolean;
  webhook_enabled?: boolean;
}

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

  async upsertIntegration(
    projectId: string,
    provider: IntegrationProvider,
    data: UpsertIntegrationData,
  ): Promise<ProjectIntegration> {
    const encryptedAccessToken =
      typeof data.access_token === 'string'
        ? this.encryption.encrypt(data.access_token)
        : (data.access_token ?? null);
    const encryptedRefreshToken =
      typeof data.refresh_token === 'string'
        ? this.encryption.encrypt(data.refresh_token)
        : (data.refresh_token ?? null);
    const encryptedWebhookSecret =
      typeof data.webhook_secret === 'string'
        ? this.encryption.encrypt(data.webhook_secret)
        : (data.webhook_secret ?? null);

    const encryptedData: Prisma.ProjectIntegrationUncheckedUpdateInput = {
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      token_expiry: data.token_expiry ?? null,
      bot_user_id: data.bot_user_id ?? null,
      bot_username: data.bot_username ?? null,
      workspace_id: data.workspace_id,
      workspace_name: data.workspace_name,
      webhook_secret: encryptedWebhookSecret,
      provider_config: (data.provider_config as Prisma.InputJsonValue) ?? {},
      updated_at: new Date(),
    };

    const createData: Prisma.ProjectIntegrationUncheckedCreateInput = {
      project_id: projectId,
      provider,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      token_expiry: data.token_expiry ?? null,
      bot_user_id: data.bot_user_id ?? null,
      bot_username: data.bot_username ?? null,
      workspace_id: data.workspace_id,
      workspace_name: data.workspace_name,
      webhook_secret: encryptedWebhookSecret,
      provider_config: (data.provider_config as Prisma.InputJsonValue) ?? {},
    };

    const integration = await this.prisma.projectIntegration.upsert({
      where: { project_id_provider: { project_id: projectId, provider } },
      create: createData,
      update: encryptedData,
    });

    return this.decryptTokens(integration);
  }

  async deleteIntegration(projectId: string, provider: IntegrationProvider): Promise<void> {
    try {
      await this.prisma.projectIntegration.delete({
        where: { project_id_provider: { project_id: projectId, provider } },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`No ${provider} integration found for project ${projectId}`);
      }
      throw error;
    }
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

  async findByWebhookId(webhookId: string): Promise<ProjectIntegration | null> {
    const integration = await this.prisma.projectIntegration.findFirst({
      where: { webhook_id: webhookId },
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
