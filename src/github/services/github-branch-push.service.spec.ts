import * as child_process from 'child_process';
import { GitHubBranchPushService } from './github-branch-push.service';
import { GitHubStatus } from '@/prisma/client';

jest.mock('child_process');

describe('GitHubBranchPushService', () => {
  let prisma: {
    project: { findUnique: jest.Mock };
    gitHubPush: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let config: { get: jest.Mock };
  let tokenResolver: { resolveForProject: jest.Mock };
  let service: GitHubBranchPushService;
  const execFileSync = child_process.execFileSync as jest.Mock;

  const params = {
    executionId: 'exec-1',
    projectId: 'project-1',
    repoDir: '/clones/project-1',
    branch: 'ohp/86abc',
    repositoryUrl: 'https://github.com/acme/app.git',
  };

  /** Default git stub: branch exists, 2 commits ahead, known sha, push ok. */
  function gitStub(aheadCount = '2') {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      const sub = args[2]; // after ['-C', repoDir, <sub>...]
      if (sub === 'rev-parse' && args.includes('--verify')) return '';
      if (sub === 'rev-list') return `${aheadCount}\n`;
      if (sub === 'rev-parse') return 'abc1234def5678\n';
      if (sub === 'push') return '';
      return '';
    });
  }

  beforeEach(() => {
    execFileSync.mockReset();
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ default_branch: 'main' }) },
      gitHubPush: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'push-1' }),
        update: jest.fn().mockResolvedValue({ id: 'push-1' }),
      },
    };
    config = { get: jest.fn().mockReturnValue('ghp_globaltoken') };
    tokenResolver = {
      resolveForProject: jest.fn().mockResolvedValue({
        authenticatedUrl: 'https://x-access-token:tok@github.com/acme/app.git',
      }),
    };
    service = new GitHubBranchPushService(prisma as never, config as never, tokenResolver as never);
  });

  it('pushes the branch and records a BRANCH_CREATED GitHubPush row', async () => {
    gitStub();

    const result = await service.pushExecutionBranch(params);

    expect(result.pushed).toBe(true);
    expect(result.commitSha).toBe('abc1234def5678');

    const pushCall = execFileSync.mock.calls.find((c) => (c[1] as string[]).includes('push'));
    expect(pushCall[1]).toEqual([
      '-C',
      '/clones/project-1',
      'push',
      '--force-with-lease',
      'https://x-access-token:tok@github.com/acme/app.git',
      'refs/heads/ohp/86abc:refs/heads/ohp/86abc',
    ]);
    expect(prisma.gitHubPush.create).toHaveBeenCalledWith({
      data: {
        execution_id: 'exec-1',
        repository: 'https://github.com/acme/app.git',
        branch_name: 'ohp/86abc',
        commit_sha: 'abc1234def5678',
        push_status: GitHubStatus.BRANCH_CREATED,
      },
    });
  });

  it('skips the push when the branch has no commits ahead of the default branch', async () => {
    gitStub('0');

    const result = await service.pushExecutionBranch(params);

    expect(result).toEqual({ pushed: false, skippedReason: 'no-commits' });
    expect(execFileSync.mock.calls.some((c) => (c[1] as string[]).includes('push'))).toBe(false);
    expect(prisma.gitHubPush.create).not.toHaveBeenCalled();
  });

  it('skips when the branch ref does not exist', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--verify')) throw new Error('unknown revision');
      return '';
    });

    const result = await service.pushExecutionBranch(params);

    expect(result).toEqual({ pushed: false, skippedReason: 'branch-missing' });
  });

  it('updates an existing GitHubPush row instead of creating a duplicate', async () => {
    gitStub();
    prisma.gitHubPush.findFirst.mockResolvedValue({ id: 'existing-push' });

    await service.pushExecutionBranch(params);

    expect(prisma.gitHubPush.update).toHaveBeenCalledWith({
      where: { id: 'existing-push' },
      data: expect.objectContaining({ push_status: GitHubStatus.BRANCH_CREATED }),
    });
    expect(prisma.gitHubPush.create).not.toHaveBeenCalled();
  });

  it('falls back to the global token when per-project resolution returns null', async () => {
    gitStub();
    tokenResolver.resolveForProject.mockResolvedValue(null);

    await service.pushExecutionBranch(params);

    const pushCall = execFileSync.mock.calls.find((c) => (c[1] as string[]).includes('push'));
    expect(pushCall[1]).toContain('https://x-access-token:ghp_globaltoken@github.com/acme/app.git');
  });

  it('redacts credentials from a failed push error', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      const sub = args[2];
      if (sub === 'rev-parse' && args.includes('--verify')) return '';
      if (sub === 'rev-list') return '2\n';
      if (sub === 'rev-parse') return 'abc1234\n';
      if (sub === 'push')
        throw new Error('fatal: https://x-access-token:tok@github.com/acme/app.git denied');
      return '';
    });

    await expect(service.pushExecutionBranch(params)).rejects.toThrow(
      /https:\/\/\*\*\*@github\.com/,
    );
  });
});
