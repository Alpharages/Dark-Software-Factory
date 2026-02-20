import { Test, TestingModule } from '@nestjs/testing';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ForbiddenException, HttpException } from '@nestjs/common';

// Mock Octokit class
const mockListForAuthenticatedUser = jest.fn();

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: {
      listForAuthenticatedUser: mockListForAuthenticatedUser,
    },
    paginate: jest.fn().mockImplementation(async (fn, params) => {
      const result = await fn(params);
      return result.data;
    }),
  })),
}));

describe('GitHubAuthFlowService', () => {
  let service: GitHubAuthFlowService;
  let prisma: jest.Mocked<PrismaService>;
  let encryption: jest.Mocked<EncryptionService>;

  beforeEach(async () => {
    const mockPrisma = {
      gitHubAccount: {
        findUnique: jest.fn(),
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

    // clear mocks
    jest.clearAllMocks();
  });

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
