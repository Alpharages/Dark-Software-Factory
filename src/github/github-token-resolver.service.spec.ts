import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { GitHubTokenResolverService } from './github-token-resolver.service';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { Project, GitHubAccount } from '@prisma/client';

describe('GitHubTokenResolverService', () => {
  let service: GitHubTokenResolverService;
  let prisma: PrismaService;
  let encryption: EncryptionService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubTokenResolverService,
        {
          provide: PrismaService,
          useValue: {
            project: { findUnique: jest.fn() },
            gitHubAccount: { findUnique: jest.fn() },
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubTokenResolverService>(GitHubTokenResolverService);
    prisma = module.get<PrismaService>(PrismaService);
    encryption = module.get<EncryptionService>(EncryptionService);

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveForProject', () => {
    const projectId = 'proj-123';
    const plainUrl = 'https://github.com/owner/repo.git';
    const accountId = 'acct-uuid';
    const encryptedToken = 'encrypted-token-data';
    const decryptedToken = 'ghp_secret_token';

    it('should return null if project has no github_account_id', async () => {
      jest
        .spyOn(prisma.project, 'findUnique')
        .mockResolvedValue({ github_account_id: null } as unknown as Project);

      const result = await service.resolveForProject(projectId, plainUrl);

      expect(result).toBeNull();
      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        select: { github_account_id: true },
      });
      expect(prisma.gitHubAccount.findUnique).not.toHaveBeenCalled();
      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Project ${projectId} has no github_account_id`),
      );
    });

    it('should throw NotFoundException if linked account is deleted', async () => {
      jest
        .spyOn(prisma.project, 'findUnique')
        .mockResolvedValue({ github_account_id: accountId } as unknown as Project);
      jest.spyOn(prisma.gitHubAccount, 'findUnique').mockResolvedValue(null);

      await expect(service.resolveForProject(projectId, plainUrl)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.gitHubAccount.findUnique).toHaveBeenCalledWith({
        where: { id: accountId },
        select: { id: true, username: true, accessToken: true },
      });
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('should throw if decryption fails', async () => {
      jest
        .spyOn(prisma.project, 'findUnique')
        .mockResolvedValue({ github_account_id: accountId } as unknown as Project);
      jest.spyOn(prisma.gitHubAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        username: 'octocat',
        accessToken: encryptedToken,
      } as unknown as GitHubAccount);
      jest.spyOn(encryption, 'decrypt').mockImplementation(() => {
        throw new Error('Decryption Failed');
      });

      await expect(service.resolveForProject(projectId, plainUrl)).rejects.toThrow(
        'Decryption Failed',
      );
    });

    it('should build authenticated URL and not log the token (happy path + security)', async () => {
      jest
        .spyOn(prisma.project, 'findUnique')
        .mockResolvedValue({ github_account_id: accountId } as unknown as Project);
      jest.spyOn(prisma.gitHubAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        username: 'octocat',
        accessToken: encryptedToken,
      } as unknown as GitHubAccount);
      jest.spyOn(encryption, 'decrypt').mockReturnValue(decryptedToken);

      const result = await service.resolveForProject(projectId, plainUrl);

      expect(result).toEqual({
        authenticatedUrl: `https://x-access-token:${decryptedToken}@github.com/owner/repo.git`,
        username: 'octocat',
        accountId: accountId,
      });

      // Security check: ensure token is never logged
      const logCalls = loggerLogSpy.mock.calls;
      const warnCalls = loggerWarnSpy.mock.calls;
      const errorCalls = loggerErrorSpy.mock.calls;

      const allLogs = [...logCalls, ...warnCalls, ...errorCalls].flat().join(' ');
      expect(allLogs).not.toContain(decryptedToken);
      expect(allLogs).not.toContain('x-access-token'); // The URL itself should not be logged either
    });
  });
});
