import { Test, TestingModule } from '@nestjs/testing';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import axios from 'axios';

// Octokit mock functions — defined at module level so they survive jest.mock hoisting
const mockListForAuthenticatedUser = jest.fn();
const mockGetAuthenticated = jest.fn();
const mockListInstallations = jest.fn();

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: {
      listForAuthenticatedUser: mockListForAuthenticatedUser,
    },
    users: {
      getAuthenticated: mockGetAuthenticated,
    },
    apps: {
      listInstallationsForAuthenticatedUser: mockListInstallations,
    },
    paginate: jest.fn().mockImplementation(async (fn, params) => {
      const result = await fn(params);
      return result.data;
    }),
  })),
}));

// axios mock — factory uses jest.fn() directly to avoid the TDZ hoisting issue
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

describe('GitHubAuthFlowService', () => {
  let service: GitHubAuthFlowService;
  let prisma: jest.Mocked<PrismaService>;
  let encryption: jest.Mocked<EncryptionService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockPrisma = {
      gitHubAccount: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const mockEncryption = {
      decrypt: jest.fn(),
      encrypt: jest.fn(),
    };

    const mockConfig = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubAuthFlowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<GitHubAuthFlowService>(GitHubAuthFlowService);
    prisma = module.get(PrismaService);
    encryption = module.get(EncryptionService);
    config = module.get(ConfigService);

    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // handleCallback
  // ---------------------------------------------------------------------------

  describe('handleCallback', () => {
    const mockGhUser = { id: 42, login: 'testuser', avatar_url: 'https://github.com/testuser.png' };

    beforeEach(() => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'github.clientId': 'mock-client-id',
          'github.clientSecret': 'mock-client-secret',
          FRONTEND_URL: 'http://localhost:5173',
        };
        return values[key];
      });

      jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'gh-token' } });
      mockGetAuthenticated.mockResolvedValue({ data: mockGhUser });
      mockListInstallations.mockResolvedValue({ data: { installations: [] } });
      (prisma.gitHubAccount.upsert as jest.Mock).mockResolvedValue({});
      encryption.encrypt.mockReturnValue('encrypted-token');
    });

    it('stores a fallback personal account when user has no GitHub App installations', async () => {
      await service.handleCallback('auth-code', 'user-1');

      expect(jest.mocked(axios.post)).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({ code: 'auth-code', client_id: 'mock-client-id' }),
        expect.any(Object),
      );
      expect(encryption.encrypt).toHaveBeenCalledWith('gh-token');
      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledTimes(1);
      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { installationId: 'user_42' },
          create: expect.objectContaining({
            userId: 'user-1',
            username: 'testuser',
            avatarUrl: 'https://github.com/testuser.png',
            accessToken: 'encrypted-token',
          }),
        }),
      );
    });

    it('stores one account per GitHub App installation', async () => {
      mockListInstallations.mockResolvedValue({
        data: {
          installations: [
            { id: 111, account: { login: 'org1', avatar_url: 'https://org1.png' } },
            { id: 222, account: { login: 'org2', avatar_url: 'https://org2.png' } },
          ],
        },
      });

      await service.handleCallback('auth-code', 'user-1');

      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledTimes(2);
      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { installationId: '111' },
          create: expect.objectContaining({ username: 'org1' }),
        }),
      );
      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { installationId: '222' },
          create: expect.objectContaining({ username: 'org2' }),
        }),
      );
    });

    it('falls back to the authenticated user login when installation account is missing', async () => {
      mockListInstallations.mockResolvedValue({
        data: {
          installations: [{ id: 999, account: null }],
        },
      });

      await service.handleCallback('auth-code', 'user-1');

      expect(prisma.gitHubAccount.upsert as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { installationId: '999' },
          create: expect.objectContaining({ username: 'testuser' }),
        }),
      );
    });

    it('throws if GitHub OAuth credentials are not configured', async () => {
      (config.get as jest.Mock).mockReturnValue(undefined);

      await expect(service.handleCallback('auth-code', 'user-1')).rejects.toThrow(
        'GitHub OAuth credentials not configured',
      );
      expect(jest.mocked(axios.post)).not.toHaveBeenCalled();
    });

    it('throws if GitHub token exchange does not return an access token', async () => {
      jest.mocked(axios.post).mockResolvedValue({ data: { error: 'bad_verification_code' } });

      await expect(service.handleCallback('auth-code', 'user-1')).rejects.toThrow(
        'Failed to obtain access token from GitHub',
      );
      expect(prisma.gitHubAccount.upsert as jest.Mock).not.toHaveBeenCalled();
    });

    it('throws a wrapped error if the database upsert fails', async () => {
      (prisma.gitHubAccount.upsert as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      await expect(service.handleCallback('auth-code', 'user-1')).rejects.toThrow(
        'Failed to store GitHub accounts: DB connection lost',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // disconnectAccount
  // ---------------------------------------------------------------------------

  describe('disconnectAccount', () => {
    const mockAccount = {
      id: 'acc-1',
      userId: 'user-1',
      username: 'testuser',
      accessToken: 'encrypted-token',
      installationId: 'inst-1',
      avatarUrl: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should delete account and return affected project count (happy path)', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        ...mockAccount,
        projects: [{ id: 'p1' }, { id: 'p2' }],
      });
      (prisma.gitHubAccount.delete as jest.Mock).mockResolvedValue(mockAccount);

      const result = await service.disconnectAccount('acc-1', 'user-1');

      expect(result).toEqual({
        message: 'GitHub account @testuser disconnected successfully.',
        affectedProjects: 2,
      });
      expect(prisma.gitHubAccount.findUnique as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        include: { projects: { select: { id: true } } },
      });
      expect(prisma.gitHubAccount.delete as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
      });
    });

    it('should return affectedProjects = 0 when no projects are linked', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        ...mockAccount,
        projects: [],
      });
      (prisma.gitHubAccount.delete as jest.Mock).mockResolvedValue(mockAccount);

      const result = await service.disconnectAccount('acc-1', 'user-1');

      expect(result).toEqual({
        message: 'GitHub account @testuser disconnected successfully.',
        affectedProjects: 0,
      });
      expect(prisma.gitHubAccount.findUnique as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        include: { projects: { select: { id: true } } },
      });
      expect(prisma.gitHubAccount.delete as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
      });
    });

    it('should throw ForbiddenException if caller does not own the account', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        ...mockAccount,
        userId: 'other-user',
        projects: [],
      });

      await expect(service.disconnectAccount('acc-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.gitHubAccount.delete as jest.Mock).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if account does not exist', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.disconnectAccount('acc-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.gitHubAccount.delete as jest.Mock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getReposForAccount
  // ---------------------------------------------------------------------------

  describe('getReposForAccount', () => {
    it('should return mapped repos on success', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        id: 'acc-1',
        userId: 'user-1',
        accessToken: 'encrypted-token',
        installationId: 'inst-1',
        username: 'testuser',
        avatarUrl: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      encryption.decrypt.mockReturnValue('decrypted-token');

      mockListForAuthenticatedUser.mockResolvedValue({
        data: [
          {
            id: 123,
            full_name: 'testuser/repo1',
            private: true,
            html_url: 'https://github.com/testuser/repo1',
          },
        ],
      });

      const result = await service.getReposForAccount('acc-1', 'user-1');

      expect(result).toEqual([
        {
          id: 123,
          fullName: 'testuser/repo1',
          private: true,
          htmlUrl: 'https://github.com/testuser/repo1',
        },
      ]);
      expect(prisma.gitHubAccount.findUnique as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
      });
      expect(encryption.decrypt as jest.Mock).toHaveBeenCalledWith('encrypted-token');
      expect(mockListForAuthenticatedUser).toHaveBeenCalledWith({
        per_page: 100,
        type: 'all',
      });
    });

    it('should throw ForbiddenException if account belongs to someone else', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        id: 'acc-1',
        userId: 'different-user',
        accessToken: 'encrypted-token',
        installationId: 'inst-1',
        username: 'testuser',
        avatarUrl: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(service.getReposForAccount('acc-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException if account not found', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getReposForAccount('non-existent', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw HttpException on GitHub API error', async () => {
      (prisma.gitHubAccount.findUnique as jest.Mock).mockResolvedValue({
        id: 'acc-1',
        userId: 'user-1',
        accessToken: 'encrypted-token',
        installationId: 'inst-1',
        username: 'testuser',
        avatarUrl: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      encryption.decrypt.mockReturnValue('decrypted-token');

      mockListForAuthenticatedUser.mockRejectedValue(new Error('GitHub outage'));

      await expect(service.getReposForAccount('acc-1', 'user-1')).rejects.toThrow(HttpException);
      await expect(service.getReposForAccount('acc-1', 'user-1')).rejects.toThrow(
        'GitHub API error: GitHub outage',
      );
    });
  });
});
