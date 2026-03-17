import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ConnectedAppsController } from './connected-apps.controller';
import { ConnectedAppsService } from './connected-apps.service';
import { ClickUpOAuthService } from '@/integrations/clickup-oauth.service';
import { FastifyReply } from 'fastify';
import { ForbiddenException } from '@nestjs/common';
import { AppProvider } from '@/prisma/enums';

describe('ConnectedAppsController', () => {
  let controller: ConnectedAppsController;
  let appsService: jest.Mocked<ConnectedAppsService>;
  let oauthService: jest.Mocked<ClickUpOAuthService>;
  let configService: jest.Mocked<ConfigService>;

  const mockAppsService = {
    findByUser: jest.fn(),
    getDecrypted: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
  };

  const mockOAuthService = {
    getUserConnectUrl: jest.fn(),
    exchangeCode: jest.fn(),
    getBotIdentity: jest.fn(),
    getHierarchyWithToken: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectedAppsController],
      providers: [
        { provide: ConnectedAppsService, useValue: mockAppsService },
        { provide: ClickUpOAuthService, useValue: mockOAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConnectedAppsController>(ConnectedAppsController);
    appsService = module.get(ConnectedAppsService);
    oauthService = module.get(ClickUpOAuthService);
    configService = module.get(ConfigService);
    jest.clearAllMocks();
  });

  describe('listConnectedApps', () => {
    it('should return apps for current user', async () => {
      const mockApps = [{ id: 'app-1', provider: 'CLICKUP' }];
      mockAppsService.findByUser.mockResolvedValue(mockApps as unknown as any);

      const result = await controller.listConnectedApps('user-1');

      expect(result).toBe(mockApps);
      expect(appsService.findByUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getClickUpConnectUrl', () => {
    it('should return connect URL with default returnTo', async () => {
      mockOAuthService.getUserConnectUrl.mockResolvedValue('https://auth.url');

      const result = await controller.getClickUpConnectUrl('user-1');

      expect(result).toEqual({ url: 'https://auth.url' });
      expect(oauthService.getUserConnectUrl).toHaveBeenCalledWith('user-1', 'settings');
    });

    it('should use provided returnTo', async () => {
      await controller.getClickUpConnectUrl('user-1', '/custom');
      expect(oauthService.getUserConnectUrl).toHaveBeenCalledWith('user-1', '/custom');
    });
  });

  describe('clickUpCallback', () => {
    const mockReply = { redirect: jest.fn() } as unknown as FastifyReply;
    const state = Buffer.from(
      JSON.stringify({ type: 'user', userId: 'user-1', returnTo: 'settings' }),
    ).toString('base64url');

    beforeEach(() => {
      configService.get.mockReturnValue('https://frontend.url');
    });

    it('should successfully connect and redirect', async () => {
      const tokenData = { access_token: 'token-123' };
      const identity = {
        workspace_id: 'ws-1',
        workspace_name: 'Work',
        bot_user_id: 'bot-1',
        bot_username: 'bot',
      };
      const connectedApp = { id: 'app-1' };

      mockOAuthService.exchangeCode.mockResolvedValue(tokenData as any);
      mockOAuthService.getBotIdentity.mockResolvedValue(identity as any);
      mockAppsService.upsert.mockResolvedValue(connectedApp as any);

      await controller.clickUpCallback('code-123', state, mockReply);

      expect(oauthService.exchangeCode).toHaveBeenCalledWith('code-123');
      expect(appsService.upsert).toHaveBeenCalledWith('user-1', AppProvider.CLICKUP, 'ws-1', {
        workspace_id: 'ws-1',
        workspace_name: 'Work',
        access_token: 'token-123',
        refresh_token: null,
        token_expiry: null,
        metadata: { botUserId: 'bot-1', botUsername: 'bot' },
      });
      expect(mockReply.redirect).toHaveBeenCalledWith(
        'https://frontend.url/settings/pm-callback?integration=connected&returnTo=settings&accountId=app-1',
        302,
      );
    });

    it('should redirect to error on malformed state', async () => {
      await controller.clickUpCallback('code-123', 'bad-state', mockReply);
      expect(mockReply.redirect).toHaveBeenCalledWith(
        'https://frontend.url/settings/pm-callback?integration=error&returnTo=settings',
        302,
      );
    });

    it('should redirect to error on missing code', async () => {
      await controller.clickUpCallback('', state, mockReply);
      expect(mockReply.redirect).toHaveBeenCalledWith(
        'https://frontend.url/settings/pm-callback?integration=error&returnTo=settings',
        302,
      );
    });
  });

  describe('getHierarchy', () => {
    it('should fetch hierarchy using decrypted token and teamId', async () => {
      const mockApp = { access_token: 'clear-token' };
      const mockHierarchy = { organizations: [] };
      mockAppsService.getDecrypted.mockResolvedValue(mockApp as unknown as any);
      mockOAuthService.getHierarchyWithToken.mockResolvedValue(mockHierarchy as any);

      const result = await controller.getHierarchy('user-1', 'app-1', 'team-123');

      expect(result).toBe(mockHierarchy);
      expect(appsService.getDecrypted).toHaveBeenCalledWith('app-1', 'user-1');
      expect(oauthService.getHierarchyWithToken).toHaveBeenCalledWith('clear-token', 'team-123');
    });

    it('should throw if app has no token', async () => {
      mockAppsService.getDecrypted.mockResolvedValue({ access_token: null } as unknown as any);
      await expect(controller.getHierarchy('user-1', 'app-1')).rejects.toThrow();
    });

    it('should propagate ForbiddenException when user does not own the app', async () => {
      mockAppsService.getDecrypted.mockRejectedValue(new ForbiddenException());
      await expect(controller.getHierarchy('other-user', 'app-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('disconnect', () => {
    it('should delete connection', async () => {
      mockAppsService.delete.mockResolvedValue(undefined);

      const result = await controller.disconnect('user-1', 'app-1');

      expect(result).toEqual({ message: 'Connected app disconnected successfully' });
      expect(appsService.delete).toHaveBeenCalledWith('app-1', 'user-1');
    });

    it('should propagate errors from service', async () => {
      mockAppsService.delete.mockRejectedValue(new ForbiddenException());
      await expect(controller.disconnect('user-1', 'app-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
