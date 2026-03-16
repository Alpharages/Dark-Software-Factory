import axios from 'axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ProjectIntegrationService } from './project-integration.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationAuthException } from '../common/exceptions/integration-auth.exception';
import { ClickUpProvider } from './providers/clickup/clickup.provider';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegration } from '@prisma/client';

jest.mock('axios');
jest.mock('./providers/clickup/clickup.provider');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedClickUpProvider = ClickUpProvider as jest.MockedClass<typeof ClickUpProvider>;

const MOCK_CONFIG: Record<string, string> = {
  'clickup.clientId': 'test-client-id',
  'clickup.clientSecret': 'test-client-secret',
  'clickup.redirectUri': 'https://api.example.com/api/v1/integrations/clickup/callback',
  FRONTEND_URL: 'https://app.example.com',
};

describe('ClickUpOAuthService', () => {
  let service: ClickUpOAuthService;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let configService: jest.Mocked<ConfigService>;
  let prismaService: { project: { findUniqueOrThrow: jest.Mock } };

  beforeEach(() => {
    integrationService = {
      upsertIntegration: jest.fn().mockResolvedValue({ id: 'int-1' }),
    } as unknown as jest.Mocked<ProjectIntegrationService>;
    configService = {
      get: jest.fn((key: string) => MOCK_CONFIG[key] ?? ''),
    } as unknown as jest.Mocked<ConfigService>;
    prismaService = {
      project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'project-1' }) },
    };
    service = new ClickUpOAuthService(
      configService,
      prismaService as unknown as PrismaService,
      integrationService,
    );
    jest.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    configService.get.mockImplementation((key: string) => MOCK_CONFIG[key] ?? '');
    prismaService.project.findUniqueOrThrow.mockResolvedValue({ id: 'project-1' });
    integrationService.upsertIntegration.mockResolvedValue({
      id: 'int-1',
    } as unknown as ProjectIntegration);
  });

  describe('getConnectUrl', () => {
    it('returns correct ClickUp auth URL with state=projectId:CLICKUP', async () => {
      const url = await service.getConnectUrl('project-1');
      expect(url).toContain('app.clickup.com/api');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('project-1');
      expect(url).toContain('CLICKUP');
      expect(prismaService.project.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'project-1' },
      });
    });

    it('throws BadRequestException when CLICKUP_CLIENT_ID is empty', async () => {
      configService.get.mockReturnValue('');
      await expect(service.getConnectUrl('p-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when CLICKUP_REDIRECT_URI is empty', async () => {
      configService.get.mockImplementation((k: string) =>
        k === 'clickup.clientId' ? 'some-id' : '',
      );
      await expect(service.getConnectUrl('p-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      prismaService.project.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));
      await expect(service.getConnectUrl('bad-project')).rejects.toThrow(NotFoundException);
    });
  });

  describe('exchangeCode', () => {
    it('calls POST token endpoint with query params and null body', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'pk_abc', token_type: 'Bearer' },
      });
      const result = await service.exchangeCode('auth-code');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        null,
        expect.objectContaining({
          params: expect.objectContaining({
            code: 'auth-code',
            client_id: 'test-client-id',
            redirect_uri: 'https://api.example.com/api/v1/integrations/clickup/callback',
          }),
        }),
      );
      expect(result.access_token).toBe('pk_abc');
    });

    it('throws IntegrationAuthException when access_token is missing', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });
      await expect(service.exchangeCode('bad')).rejects.toThrow(IntegrationAuthException);
    });
  });

  describe('handleCallback', () => {
    beforeEach(() => {
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'pk_abc', token_type: 'Bearer' },
      });
      MockedClickUpProvider.prototype.getSelf = jest
        .fn()
        .mockResolvedValue({ id: '123', name: 'Bot', email: 'bot@example.com' });
      mockedAxios.get.mockResolvedValue({ data: { teams: [{ id: 99, name: 'Test WS' }] } });
    });

    it('upserts with token_expiry: null and refresh_token: null', async () => {
      await service.handleCallback('code', 'project-1:CLICKUP');
      expect(integrationService.upsertIntegration).toHaveBeenCalledWith(
        'project-1',
        expect.anything(),
        expect.objectContaining({ token_expiry: null, refresh_token: null }),
      );
    });

    it('returns connected URL on success', async () => {
      const url = await service.handleCallback('code', 'project-1:CLICKUP');
      expect(url).toContain('/settings/pm-callback');
      expect(url).toContain('integration=connected');
      expect(url).toContain('state=project-1');
    });

    it('upserts with fallback bot fields when getSelf throws', async () => {
      MockedClickUpProvider.prototype.getSelf = jest.fn().mockRejectedValue(new Error('down'));
      mockedAxios.get.mockRejectedValue(new Error('down'));
      await service.handleCallback('code', 'project-1:CLICKUP');
      expect(integrationService.upsertIntegration).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          bot_user_id: null,
          bot_username: null,
          workspace_id: 'unknown',
          workspace_name: 'ClickUp Workspace',
        }),
      );
    });

    it('returns error URL without throwing when code is empty', async () => {
      const url = await service.handleCallback('', 'project-1:CLICKUP');
      expect(url).toContain('integration=error');
      expect(integrationService.upsertIntegration).not.toHaveBeenCalled();
    });
  });
});
