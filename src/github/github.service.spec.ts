/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { GitHubService } from './github.service';
import { GitHubClientService } from './github-client.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';

describe('GitHubService', () => {
  let service: GitHubService;
  let clientService: GitHubClientService;
  let auditLogService: AuditLogService;

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
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubService>(GitHubService);
    clientService = module.get<GitHubClientService>(GitHubClientService);
    auditLogService = module.get<AuditLogService>(AuditLogService);
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
      (mockOctokit.git as any).getRef = jest.fn().mockResolvedValue({ data: refData });
      (mockOctokit.git as any).getCommit = jest.fn().mockResolvedValue({ data: commitData });
      (mockOctokit.git as any).createBlob = jest.fn().mockResolvedValue({ data: blobData });
      (mockOctokit.git as any).createTree = jest.fn().mockResolvedValue({ data: treeData });
      (mockOctokit.git as any).createCommit = jest.fn().mockResolvedValue({ data: newCommitData });
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
});
