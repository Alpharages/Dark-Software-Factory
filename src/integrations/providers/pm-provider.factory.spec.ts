import axios from 'axios';
import { PMProviderFactory } from './pm-provider.factory';
import { ProjectIntegrationService } from '../project-integration.service';
import { ConfigService } from '@nestjs/config';
import { ClickUpProvider } from './clickup/clickup.provider';
import { UnsupportedProviderException } from '../../common/exceptions/unsupported-provider.exception';
import { IntegrationAuthException } from '../../common/exceptions/integration-auth.exception';
import { PMProvider, ProjectIntegration } from '@prisma/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PMProviderFactory', () => {
  let factory: PMProviderFactory;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let configService: jest.Mocked<ConfigService>;

  const makeIntegration = (overrides: Partial<ProjectIntegration> = {}): ProjectIntegration =>
    ({
      id: 'integration-1',
      project_id: 'project-1',
      provider: PMProvider.CLICKUP,
      access_token: 'decrypted-access-token',
      refresh_token: 'refresh-token',
      token_expiry: new Date(Date.now() + 30 * 60 * 1000), // 30 min ahead — no refresh
      workspace_id: 'ws-1',
      workspace_name: 'Test Workspace',
      bot_user_id: null,
      bot_username: null,
      polling_enabled: false,
      polling_interval_min: 10,
      polling_last_run_at: null,
      webhook_enabled: false,
      webhook_id: null,
      webhook_secret: null,
      provider_config: {},
      ai_trigger_status: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    }) as ProjectIntegration;

  beforeEach(() => {
    integrationService = {
      updateIntegration: jest.fn(),
    } as unknown as jest.Mocked<ProjectIntegrationService>;
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'clickup.clientId') return 'test-client-id';
        if (key === 'clickup.clientSecret') return 'test-client-secret';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;
    factory = new PMProviderFactory(integrationService, configService);
    jest.clearAllMocks();
  });

  describe('getProvider', () => {
    it('returns ClickUpProvider for CLICKUP with valid non-expiring token', async () => {
      const provider = await factory.getProvider(makeIntegration());
      expect(provider).toBeInstanceOf(ClickUpProvider);
      expect(integrationService.updateIntegration).not.toHaveBeenCalled();
    });

    it('skips refresh when token_expiry is null', async () => {
      const provider = await factory.getProvider(makeIntegration({ token_expiry: null }));
      expect(provider).toBeInstanceOf(ClickUpProvider);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('does NOT refresh when token is far from expiry (30 min)', async () => {
      await factory.getProvider(
        makeIntegration({ token_expiry: new Date(Date.now() + 30 * 60 * 1000) }),
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('refreshes token when within 5-min window (2 min left) and uses new token', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 2 * 60 * 1000) });
      const refreshed = { ...nearExpiry, access_token: 'new-access-token' };
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new-access-token', refresh_token: 'new-refresh', expires_in: 3600 },
      });
      integrationService.updateIntegration.mockResolvedValue(
        refreshed as unknown as ProjectIntegration,
      );

      const provider = await factory.getProvider(nearExpiry);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.clickup.com/api/v2/oauth/token',
        null,
        expect.objectContaining({
          params: expect.objectContaining({ grant_type: 'refresh_token' }),
        }),
      );
      expect(integrationService.updateIntegration).toHaveBeenCalledWith(
        'integration-1',
        expect.objectContaining({ access_token: 'new-access-token' }),
      );
      expect(provider).toBeInstanceOf(ClickUpProvider);
      // Verify new token was used for provider construction

      expect((provider as unknown as Record<string, unknown>).accessToken).toBe('new-access-token');
    });

    it('throws UnsupportedProviderException for unknown provider', async () => {
      const integration = makeIntegration({
        provider: 'JIRA' as PMProvider,
        token_expiry: null,
      });
      await expect(factory.getProvider(integration)).rejects.toThrow(UnsupportedProviderException);
    });

    it('throws IntegrationAuthException when refresh HTTP call fails', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 60_000) });
      mockedAxios.post.mockRejectedValue(new Error('Network error'));
      await expect(factory.getProvider(nearExpiry)).rejects.toThrow(IntegrationAuthException);
    });

    it('throws IntegrationAuthException when refresh_token is null', async () => {
      const integration = makeIntegration({
        token_expiry: new Date(Date.now() + 60_000),
        refresh_token: null,
      });
      await expect(factory.getProvider(integration)).rejects.toThrow(IntegrationAuthException);
    });

    it('throws IntegrationAuthException when access_token is null after refresh', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 60_000) });
      const refreshedWithNullToken = { ...nearExpiry, access_token: null };
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 },
      });
      integrationService.updateIntegration.mockResolvedValue(
        refreshedWithNullToken as unknown as ProjectIntegration,
      );

      await expect(factory.getProvider(nearExpiry)).rejects.toThrow(IntegrationAuthException);
    });

    it('updates DB with new tokens after successful refresh', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 2 * 60 * 1000) });
      const refreshed = {
        ...nearExpiry,
        access_token: 'new-access-token',
        refresh_token: 'new-refresh',
      };
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new-access-token', refresh_token: 'new-refresh', expires_in: 3600 },
      });
      integrationService.updateIntegration.mockResolvedValue(
        refreshed as unknown as ProjectIntegration,
      );

      await factory.getProvider(nearExpiry);

      expect(integrationService.updateIntegration).toHaveBeenCalledWith(
        'integration-1',
        expect.objectContaining({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh',
          token_expiry: expect.any(Date),
        }),
      );
    });
  });
});
