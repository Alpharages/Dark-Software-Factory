import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { ConnectedAppModel } from '@/prisma/client';
import { AppProvider } from '@/prisma/enums';
import { ConnectedAppResponseDto } from './dto/connected-app-response.dto';
import { Prisma } from '@prisma/client';

export interface CreateConnectedAppData {
  workspace_id: string;
  workspace_name: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: Date | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class ConnectedAppsService {
  private readonly logger = new Logger(ConnectedAppsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async create(
    userId: string,
    provider: AppProvider,
    data: CreateConnectedAppData,
  ): Promise<ConnectedAppResponseDto> {
    const encryptedAccessToken = data.access_token
      ? this.encryptionService.encrypt(data.access_token)
      : null;
    const encryptedRefreshToken = data.refresh_token
      ? this.encryptionService.encrypt(data.refresh_token)
      : null;

    const connectedApp = await this.prisma.connectedApp.create({
      data: {
        user_id: userId,
        provider,
        workspace_id: data.workspace_id,
        workspace_name: data.workspace_name,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: data.token_expiry,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return this.toResponseDto(connectedApp);
  }

  async upsert(
    userId: string,
    provider: AppProvider,
    workspaceId: string,
    data: CreateConnectedAppData,
  ): Promise<ConnectedAppResponseDto> {
    const encryptedAccessToken = data.access_token
      ? this.encryptionService.encrypt(data.access_token)
      : null;
    const encryptedRefreshToken = data.refresh_token
      ? this.encryptionService.encrypt(data.refresh_token)
      : null;

    const connectedApp = await this.prisma.connectedApp.upsert({
      where: {
        user_id_provider_workspace_id: {
          user_id: userId,
          provider,
          workspace_id: workspaceId,
        },
      },
      update: {
        workspace_name: data.workspace_name,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: data.token_expiry,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
      },
      create: {
        user_id: userId,
        provider,
        workspace_id: workspaceId,
        workspace_name: data.workspace_name,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: data.token_expiry,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return this.toResponseDto(connectedApp);
  }

  async findByUser(userId: string): Promise<ConnectedAppResponseDto[]> {
    const apps = await this.prisma.connectedApp.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    return apps.map((app: ConnectedAppModel) => this.toResponseDto(app));
  }

  async findByUserAndProvider(
    userId: string,
    provider: AppProvider,
  ): Promise<ConnectedAppResponseDto[]> {
    const apps = await this.prisma.connectedApp.findMany({
      where: { user_id: userId, provider },
      orderBy: { created_at: 'desc' },
    });

    return apps.map((app: ConnectedAppModel) => this.toResponseDto(app));
  }

  async findById(id: string): Promise<ConnectedAppResponseDto | null> {
    const app = await this.prisma.connectedApp.findUnique({ where: { id } });
    return app ? this.toResponseDto(app) : null;
  }

  async getDecrypted(id: string, userId: string): Promise<ConnectedAppModel> {
    const app = await this.prisma.connectedApp.findUnique({ where: { id } });

    if (!app) {
      throw new NotFoundException(`Connected app with ID ${id} not found`);
    }

    if (app.user_id !== userId) {
      throw new ForbiddenException('You do not have permission to access this connected app');
    }

    let decryptedAccessToken: string | null = null;
    if (app.access_token) {
      try {
        decryptedAccessToken = this.encryptionService.decrypt(app.access_token);
      } catch (_err) {
        this.logger.warn(`Failed to decrypt access_token for ConnectedApp ${app.id}`);
      }
    }

    let decryptedRefreshToken: string | null = null;
    if (app.refresh_token) {
      try {
        decryptedRefreshToken = this.encryptionService.decrypt(app.refresh_token);
      } catch (_err) {
        this.logger.warn(`Failed to decrypt refresh_token for ConnectedApp ${app.id}`);
      }
    }

    return { ...app, access_token: decryptedAccessToken, refresh_token: decryptedRefreshToken };
  }

  async delete(id: string, userId: string): Promise<void> {
    const app = await this.prisma.connectedApp.findUnique({ where: { id } });

    if (!app) {
      throw new NotFoundException(`Connected app with ID ${id} not found`);
    }

    if (app.user_id !== userId) {
      throw new ForbiddenException('You do not have permission to delete this connected app');
    }

    await this.prisma.connectedApp.delete({ where: { id } });
  }

  private toResponseDto(app: ConnectedAppModel): ConnectedAppResponseDto {
    return {
      id: app.id,
      provider: app.provider as AppProvider,
      workspaceId: app.workspace_id,
      workspaceName: app.workspace_name,
      metadata: app.metadata as Record<string, unknown> | null,
      connectedAt: app.created_at.toISOString(),
    };
  }
}
