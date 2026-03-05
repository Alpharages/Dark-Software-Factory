import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { GitHubService } from './github.service';
import { GitHubClientService } from './github-client.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics';
import { SentryService } from '@/common/sentry';
import { LoggerService } from '@/common/logger';
import { PrismaService } from '@/database/prisma.service';

describe('GitHubService', () => {
  let service: GitHubService;
  let auditLogService: AuditLogService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockOctokit = {
    repos: {
      get: jest.fn().mockResolvedValue({
        data: {
          owner: { login: 'owner' },
          name: 'repo',
          default_branch: 'main',
          visibility: 'public',
          html_url: 'url',
        },
      }),
      createCommitStatus: jest.fn().mockResolvedValue({ data: {} }),
    },
    git: {
      createRef: jest.fn().mockResolvedValue({ data: {} }),
      getRef: jest.fn(),
      getCommit: jest.fn(),
      createBlob: jest.fn(),
      createTree: jest.fn(),
      createCommit: jest.fn(),
      updateRef: jest.fn(),
    },
    pulls: {
      create: jest.fn().mockResolvedValue({ data: { number: 1, html_url: 'pr_url' } }),
    },
    issues: {
      createComment: jest.fn().mockResolvedValue({ data: {} }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubService,
        {
          provide: GitHubClientService,
          useValue: {
            execute: jest.fn().mockImplementation((fn) => fn(mockOctokit)),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {},
        },
        {
          provide: SentryService,
          useValue: {},
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            execution: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            gitHubPush: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubService>(GitHubService);
    module.get<GitHubClientService>(GitHubClientService);
    auditLogService = module.get<AuditLogService>(AuditLogService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRepository', () => {
    it('should return repo details', async () => {
      const result = await service.getRepository('owner', 'repo');
      expect(result.owner).toEqual('owner');
      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    });
  });

  describe('createBranch', () => {
    it('should create branch and audit log', async () => {
      await service.createBranch('owner', 'repo', 'feature/1', 'sha123');

      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'refs/heads/feature/1',
        sha: 'sha123',
      });

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_branch',
          entityId: 'owner/repo/feature/1',
        }),
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create PR and audit log', async () => {
      await service.createPullRequest('owner', 'repo', 'Title', 'Body', 'head', 'base');

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_pr',
        }),
      );
    });
  });

  describe('pushCommit', () => {
    it('should push commit using Git Data API flow', async () => {
      // Setup Git Data API mocks
      const refData = { object: { sha: 'current-commit-sha' } };
      const commitData = { tree: { sha: 'current-tree-sha' } };
      const blobData = { sha: 'new-blob-sha' };
      const treeData = { sha: 'new-tree-sha' };
      const newCommitData = { sha: 'new-commit-sha' };

      mockOctokit.repos.get = jest.fn(); // Just in case
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).getRef = jest.fn().mockResolvedValue({ data: refData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).getCommit = jest.fn().mockResolvedValue({ data: commitData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).createBlob = jest.fn().mockResolvedValue({ data: blobData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).createTree = jest.fn().mockResolvedValue({ data: treeData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).createCommit = jest.fn().mockResolvedValue({ data: newCommitData });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockOctokit.git as any).updateRef = jest.fn().mockResolvedValue({ data: {} });

      const files = [{ path: 'test.txt', content: 'test content' }];

      await service.pushCommit('owner', 'repo', 'feature/branch', files, 'Commit message');

      // Verify chain
      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'heads/feature/branch',
      });
      expect(mockOctokit.git.getCommit).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        commit_sha: 'current-commit-sha',
      });
      expect(mockOctokit.git.createBlob).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        content: 'test content',
        encoding: 'utf-8',
      });
      expect(mockOctokit.git.createTree).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        base_tree: 'current-tree-sha',
        tree: [
          {
            path: 'test.txt',
            mode: '100644',
            type: 'blob',
            sha: 'new-blob-sha',
          },
        ],
      });
      expect(mockOctokit.git.createCommit).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        message: 'Commit message',
        tree: 'new-tree-sha',
        parents: ['current-commit-sha'],
      });
      expect(mockOctokit.git.updateRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'heads/feature/branch',
        sha: 'new-commit-sha',
      });
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'push_commit' }),
      );
    });
  });

  describe('updateCommitStatus', () => {
    mockOctokit.repos.createCommitStatus = jest.fn().mockResolvedValue({ data: {} });

    it('should update commit status', async () => {
      await service.updateCommitStatus(
        'owner',
        'repo',
        'sha123',
        'success',
        'ci/build',
        'Build passed',
        'http://target',
      );

      expect(mockOctokit.repos.createCommitStatus).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        sha: 'sha123',
        state: 'success',
        context: 'ci/build',
        description: 'Build passed',
        target_url: 'http://target',
      });
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_commit_status' }),
      );
    });
  });

  describe('getPrMergeRateStats', () => {
    it('should calculate merge rate using merged PRs without retries', async () => {
      // Two-query approach: gitHubPush.findMany for pushes, execution.findMany for retry counts
      (prismaService.gitHubPush.findMany as jest.Mock).mockResolvedValue([
        { push_status: 'MERGED', execution_id: 'e1' },
        { push_status: 'MERGED', execution_id: 'e2' },
        { push_status: 'FAILED', execution_id: 'e3' },
      ]);
      (prismaService.execution.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', retry_count: 0 },
        { id: 'e2', retry_count: 1 },
        { id: 'e3', retry_count: 0 },
      ]);

      const result = await service.getPrMergeRateStats();

      expect(result.totalPrs).toBe(3);
      expect(result.mergedWithoutRework).toBe(1);
      expect(result.prMergeRate).toBeCloseTo(1 / 3);
    });

    it('should return zero rate when PM has no scoped executions', async () => {
      (prismaService.execution.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getPrMergeRateStats({ pmId: 'pm-1', role: 'PM' });

      expect(result.prMergeRate).toBe(0);
      expect(result.totalPrs).toBe(0);
      expect(result.mergedWithoutRework).toBe(0);
      expect(prismaService.gitHubPush.findMany).not.toHaveBeenCalled();
    });

    it('should scope gitHubPush query to PM execution IDs', async () => {
      // First call: PM scope lookup returns execution IDs
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'e1' },
        { id: 'e2' },
      ]);
      (prismaService.gitHubPush.findMany as jest.Mock).mockResolvedValue([
        { push_status: 'MERGED', execution_id: 'e1' },
      ]);
      // Second call: retry count lookup
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'e1', retry_count: 0 },
      ]);

      const result = await service.getPrMergeRateStats({ pmId: 'pm-1', role: 'PM' });

      expect(prismaService.gitHubPush.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            execution_id: { in: ['e1', 'e2'] },
          }),
        }),
      );
      expect(result.prMergeRate).toBeCloseTo(1);
      expect(result.mergedWithoutRework).toBe(1);
    });
  });
});
