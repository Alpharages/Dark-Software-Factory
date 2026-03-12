import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { ClickUpOAuthController } from './clickup-oauth.controller';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ProjectIntegrationService } from './project-integration.service';
import { IntegrationProvider } from '@prisma/client';

describe('ClickUpOAuthController', () => {
  let controller: ClickUpOAuthController;
  let oauthService: jest.Mocked<ClickUpOAuthService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;

  const mockOAuthService = {
    getConnectUrl: jest.fn().mockResolvedValue('https://app.clickup.com/api?client_id=x'),
    handleCallback: jest
      .fn()
      .mockResolvedValue('https://app.example.com/projects/p-1/settings?integration=connected'),
  };

  const mockIntegrationService = {
    deleteIntegration: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClickUpOAuthController],
      providers: [
        { provide: ClickUpOAuthService, useValue: mockOAuthService },
        { provide: ProjectIntegrationService, useValue: mockIntegrationService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClickUpOAuthController>(ClickUpOAuthController);
    oauthService = module.get(ClickUpOAuthService);
    integrationService = module.get(ProjectIntegrationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('connect', () => {
    it('returns { url } from oauthService.getConnectUrl', async () => {
      const result = await controller.connect('proj-1');
      expect(result).toEqual({ url: 'https://app.clickup.com/api?client_id=x' });
      expect(oauthService.getConnectUrl).toHaveBeenCalledWith('proj-1');
    });
  });

  describe('callback', () => {
    it('calls handleCallback with code+state and redirects via reply.redirect(url, 302)', async () => {
      const mockReply = { redirect: jest.fn() };

      await controller.callback('code-123', 'proj-1:CLICKUP', mockReply as unknown as FastifyReply);

      expect(oauthService.handleCallback).toHaveBeenCalledWith('code-123', 'proj-1:CLICKUP');
      expect(mockReply.redirect).toHaveBeenCalledWith(
        'https://app.example.com/projects/p-1/settings?integration=connected',
        302,
      );
    });
  });

  describe('disconnect', () => {
    it('calls deleteIntegration and returns { message }', async () => {
      const result = await controller.disconnect('proj-1');
      expect(result).toEqual({ message: 'ClickUp integration disconnected successfully' });
      expect(integrationService.deleteIntegration).toHaveBeenCalledWith(
        'proj-1',
        IntegrationProvider.CLICKUP,
      );
    });
  });
});
