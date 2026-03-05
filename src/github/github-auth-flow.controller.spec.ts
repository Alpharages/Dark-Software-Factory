import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GitHubAuthFlowController } from './github-auth-flow.controller';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { JwtAuthGuard } from '@/common/guards';

describe('GitHubAuthFlowController', () => {
  let controller: GitHubAuthFlowController;
  let service: jest.Mocked<GitHubAuthFlowService>;

  // Minimal req stub — only `user.id` is used by the controller
  const mockReq = { user: { id: 'user-1' } } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeEach(async () => {
    const mockService = {
      getOAuthUrl: jest.fn(),
      handleCallback: jest.fn(),
      getConnectedAccounts: jest.fn(),
      getReposForAccount: jest.fn(),
      disconnectAccount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitHubAuthFlowController],
      providers: [{ provide: GitHubAuthFlowService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GitHubAuthFlowController>(GitHubAuthFlowController);
    service = module.get(GitHubAuthFlowService);

    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // GET /github/auth/login
  // ---------------------------------------------------------------------------

  describe('getLoginUrl', () => {
    it('returns the GitHub OAuth URL', () => {
      service.getOAuthUrl.mockReturnValue('https://github.com/login/oauth/authorize?client_id=x');

      const result = controller.getLoginUrl();

      expect(result).toEqual({ url: 'https://github.com/login/oauth/authorize?client_id=x' });
      expect(service.getOAuthUrl).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /github/auth/callback
  // ---------------------------------------------------------------------------

  describe('handleCallback', () => {
    it('returns { success: true } when the code is valid and service succeeds', async () => {
      service.handleCallback.mockResolvedValue(undefined);

      const result = await controller.handleCallback(mockReq, { code: 'valid-code' });

      expect(result).toEqual({ success: true });
      expect(service.handleCallback).toHaveBeenCalledWith('valid-code', 'user-1');
    });

    it('returns formatted message for bare access_denied (no error_description)', async () => {
      // GitHub sometimes sends just the error code with no description
      const result = await controller.handleCallback(mockReq, { error: 'access_denied' });

      expect(result).toEqual({ success: false, error: 'GitHub access request was declined.' });
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('returns the raw error_description when GitHub includes one (even for access_denied)', async () => {
      // When error_description is present it takes precedence over the error code,
      // so the access_denied rewrite does NOT fire.
      const result = await controller.handleCallback(mockReq, {
        error: 'access_denied',
        error_description: 'The user has denied your application access.',
      });

      expect(result).toEqual({
        success: false,
        error: 'The user has denied your application access.',
      });
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('returns the raw error_description for non-access_denied GitHub errors', async () => {
      const result = await controller.handleCallback(mockReq, {
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      });

      expect(result).toEqual({
        success: false,
        error: 'The code passed is incorrect or expired.',
      });
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('returns the raw error key when error_description is absent and error is not access_denied', async () => {
      const result = await controller.handleCallback(mockReq, { error: 'application_suspended' });

      expect(result).toEqual({ success: false, error: 'application_suspended' });
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('returns failure with "Authorization code is missing." when no code is provided', async () => {
      const result = await controller.handleCallback(mockReq, {});

      expect(result).toEqual({ success: false, error: 'Authorization code is missing.' });
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('returns failure when the service throws (e.g. GitHub rejects the code)', async () => {
      service.handleCallback.mockRejectedValue(new Error('Bad credentials'));

      const result = await controller.handleCallback(mockReq, { code: 'expired-code' });

      expect(result).toEqual({ success: false, error: 'Bad credentials' });
    });

    it('returns "Unknown error" when the thrown value is not an Error instance', async () => {
      service.handleCallback.mockRejectedValue('string-rejection');

      const result = await controller.handleCallback(mockReq, { code: 'some-code' });

      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /github/accounts
  // ---------------------------------------------------------------------------

  describe('getAccounts', () => {
    it('returns connected accounts for the authenticated user', async () => {
      const accounts = [
        {
          id: 'acc-1',
          username: 'testuser',
          avatarUrl: '',
          installationId: 'i1',
          updatedAt: new Date(),
        },
      ];
      service.getConnectedAccounts.mockResolvedValue(accounts as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await controller.getAccounts(mockReq);

      expect(result).toEqual(accounts);
      expect(service.getConnectedAccounts).toHaveBeenCalledWith('user-1');
    });

    it('returns an empty array when user has no connected accounts', async () => {
      service.getConnectedAccounts.mockResolvedValue([]);

      const result = await controller.getAccounts(mockReq);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /github/accounts/:accountId/repos
  // ---------------------------------------------------------------------------

  describe('getRepos', () => {
    it('returns repos for the given account', async () => {
      const repos = [
        {
          id: 1,
          fullName: 'testuser/repo1',
          private: false,
          htmlUrl: 'https://github.com/testuser/repo1',
        },
      ];
      service.getReposForAccount.mockResolvedValue(repos);

      const result = await controller.getRepos('acc-1', mockReq);

      expect(result).toEqual(repos);
      expect(service.getReposForAccount).toHaveBeenCalledWith('acc-1', 'user-1');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /github/accounts/:accountId
  // ---------------------------------------------------------------------------

  describe('disconnectAccount', () => {
    it('disconnects the account and returns success message with affected project count', async () => {
      const disconnectResult = {
        message: 'GitHub account @testuser disconnected successfully.',
        affectedProjects: 3,
      };
      service.disconnectAccount.mockResolvedValue(disconnectResult);

      const result = await controller.disconnectAccount('acc-1', mockReq);

      expect(result).toEqual(disconnectResult);
      expect(service.disconnectAccount).toHaveBeenCalledWith('acc-1', 'user-1');
    });

    it('propagates NotFoundException when account is not found', async () => {
      service.disconnectAccount.mockRejectedValue(
        new NotFoundException('GitHub account acc-1 not found.'),
      );

      await expect(controller.disconnectAccount('acc-1', mockReq)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates ForbiddenException when the user does not own the account', async () => {
      service.disconnectAccount.mockRejectedValue(
        new ForbiddenException('You do not own this GitHub account.'),
      );

      await expect(controller.disconnectAccount('acc-1', mockReq)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
