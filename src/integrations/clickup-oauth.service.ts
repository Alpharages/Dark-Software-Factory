import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IntegrationProvider } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegrationService } from './project-integration.service';
import { ClickUpProvider } from './providers/clickup/clickup.provider';
import { IntegrationAuthException } from '../common/exceptions/integration-auth.exception';

interface ClickUpTokenResponse {
  access_token: string;
  token_type: string;
  // ClickUp workspace tokens are non-expiring: no refresh_token, no expires_in
}

@Injectable()
export class ClickUpOAuthService {
  private readonly logger = new Logger(ClickUpOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  async getConnectUrl(projectId: string): Promise<string> {
    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';

    if (!clientId) throw new BadRequestException('CLICKUP_CLIENT_ID is not configured');
    if (!redirectUri) throw new BadRequestException('CLICKUP_REDIRECT_URI is not configured');

    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }).catch(() => {
      throw new NotFoundException(`Project ${projectId} not found`);
    });

    const state = `${projectId}:CLICKUP`;
    return (
      `https://app.clickup.com/api` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  async exchangeCode(code: string): Promise<ClickUpTokenResponse> {
    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const clientSecret = this.config.get<string>('clickup.clientSecret') ?? '';
    const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';
    const apiUrl = this.config.get<string>('clickup.apiUrl') ?? 'https://api.clickup.com/api/v2';

    const response = await axios.post<ClickUpTokenResponse>(`${apiUrl}/oauth/token`, null, {
      params: { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
    });

    if (!response.data.access_token) {
      throw new IntegrationAuthException(
        'pending',
        new Error('ClickUp token exchange returned no access_token'),
      );
    }

    return response.data;
  }

  async getBotIdentity(accessToken: string): Promise<{
    bot_user_id: string | null;
    bot_username: string | null;
    workspace_id: string;
    workspace_name: string;
  }> {
    const apiUrl = this.config.get<string>('clickup.apiUrl') ?? 'https://api.clickup.com/api/v2';

    try {
      const provider = new ClickUpProvider(accessToken);
      const [self, teamsResponse] = await Promise.all([
        provider.getSelf(),
        axios.get<{ teams: Array<{ id: number; name: string }> }>(`${apiUrl}/team`, {
          headers: { Authorization: accessToken },
        }),
      ]);

      const teams = teamsResponse.data.teams;
      return {
        bot_user_id: self?.id ?? null,
        bot_username: self?.name ?? null,
        workspace_id: teams.length > 0 ? String(teams[0].id) : 'unknown',
        workspace_name: teams.length > 0 ? teams[0].name : 'ClickUp Workspace',
      };
    } catch (error) {
      this.logger.warn(
        'Failed to fetch ClickUp bot identity or workspace — using fallback values',
        { error: error instanceof Error ? error.message : error },
      );
      return {
        bot_user_id: null,
        bot_username: null,
        workspace_id: 'unknown',
        workspace_name: 'ClickUp Workspace',
      };
    }
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const parts = (state ?? '').split(':');
    const projectId = parts.length >= 2 ? parts[0] : '';
    const fallbackUrl = projectId
      ? `${frontendUrl}/settings/pm-callback?integration=error&state=${encodeURIComponent(projectId)}`
      : `${frontendUrl}/settings/pm-callback?integration=error`;

    try {
      if (!code || !projectId) {
        throw new Error(`Missing code or unparseable state: "${state}"`);
      }

      const tokenData = await this.exchangeCode(code);
      const identity = await this.getBotIdentity(tokenData.access_token);

      await this.integrationService.upsertIntegration(projectId, IntegrationProvider.CLICKUP, {
        workspace_id: identity.workspace_id,
        workspace_name: identity.workspace_name,
        access_token: tokenData.access_token,
        refresh_token: null,
        token_expiry: null,
        bot_user_id: identity.bot_user_id,
        bot_username: identity.bot_username,
        provider_config: {},
      });

      this.logger.log(
        `ClickUp OAuth connected project ${projectId} to workspace "${identity.workspace_name}"`,
      );
      return `${frontendUrl}/settings/pm-callback?integration=connected&state=${encodeURIComponent(projectId)}`;
    } catch (error) {
      this.logger.error('ClickUp OAuth callback failed', {
        projectId,
        error: error instanceof Error ? error.message : error,
      });
      return fallbackUrl;
    }
  }
}
