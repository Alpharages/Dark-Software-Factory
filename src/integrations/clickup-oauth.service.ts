import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { ClickUpHierarchy, ClickUpOrganization } from '@/clickup/clickup.service';
import { PMProvider } from '@/prisma/enums';
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

  async getUserConnectUrl(userId: string, returnTo: string): Promise<string> {
    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';

    if (!clientId) throw new BadRequestException('CLICKUP_CLIENT_ID is not configured');
    if (!redirectUri) throw new BadRequestException('CLICKUP_REDIRECT_URI is not configured');

    const state = Buffer.from(JSON.stringify({ type: 'user', userId, returnTo })).toString(
      'base64url',
    );

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
    const response = await axios.post<ClickUpTokenResponse>(
      'https://api.clickup.com/api/v2/oauth/token',
      null,
      {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
      },
    );

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
    try {
      const provider = new ClickUpProvider(accessToken);
      const [self, teamsResponse] = await Promise.all([
        provider.getSelf(),
        axios.get<{ teams: Array<{ id: number; name: string }> }>(
          'https://api.clickup.com/api/v2/team',
          { headers: { Authorization: accessToken } },
        ),
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

  /**
   * Fetches hierarchical ClickUp data with an access token
   */
  async getHierarchyWithToken(accessToken: string, teamId?: string): Promise<ClickUpHierarchy> {
    const client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: { Authorization: accessToken },
      timeout: 10000,
    });

    try {
      // 1. Get Teams (Workspaces)
      const teamsRes = await client.get('/team');
      let teams = teamsRes.data.teams;

      if (!teams || teams.length === 0) {
        throw new Error('No ClickUp teams found');
      }

      // Filter teams if teamId is provided
      if (teamId) {
        teams = teams.filter((t: { id: string }) => String(t.id) === teamId);
        if (teams.length === 0) {
          throw new Error(`ClickUp team ${teamId} not found`);
        }
      }

      const organizations: ClickUpOrganization[] = [];

      // 2. Process each team (Organization)
      for (const team of teams) {
        const organization: ClickUpOrganization = {
          id: String(team.id),
          name: team.name,
          spaces: [],
        };

        try {
          // Get Spaces for the Team
          const spacesRes = await client.get(`/team/${team.id}/space`);
          const spaces = spacesRes.data.spaces;

          // 3. For each Space, get Folders and Lists in parallel
          await Promise.all(
            spaces.map(async (space: { id: string; name: string }) => {
              try {
                const [folderlessListsRes, foldersRes] = await Promise.all([
                  client.get(`/space/${space.id}/list`),
                  client.get(`/space/${space.id}/folder`),
                ]);

                const lists: Array<{ id: string; name: string }> = [
                  ...folderlessListsRes.data.lists.map((l: { id: string; name: string }) => ({
                    id: String(l.id),
                    name: String(l.name),
                  })),
                  ...foldersRes.data.folders.flatMap(
                    (folder: { name: string; lists?: Array<{ id: string; name: string }> }) =>
                      (folder.lists ?? []).map((l) => ({
                        id: String(l.id),
                        name: `${folder.name} > ${l.name}`,
                      })),
                  ),
                ];

                organization.spaces.push({
                  id: String(space.id),
                  name: String(space.name),
                  lists,
                });
              } catch (err) {
                this.logger.warn(`Failed to fetch lists for space ${space.id}`, {
                  error: err instanceof Error ? err.message : String(err),
                  teamId: team.id,
                });
              }
            }),
          );
        } catch (err) {
          this.logger.warn(`Failed to fetch spaces for team ${team.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        organizations.push(organization);
      }

      return { organizations };
    } catch (error) {
      this.logger.error('Failed to fetch ClickUp hierarchy with token', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
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

      await this.integrationService.upsertIntegration(projectId, PMProvider.CLICKUP, {
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
