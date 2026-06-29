import * as child_process from 'child_process';
import * as fs from 'fs';
import { ProjectWorkspaceService } from './project-workspace.service';

jest.mock('child_process');
jest.mock('fs');

describe('ProjectWorkspaceService', () => {
  let prisma: { ticket: { findUnique: jest.Mock } };
  let config: { get: jest.Mock };
  let encryption: { decrypt: jest.Mock };
  let service: ProjectWorkspaceService;
  const execFileSync = child_process.execFileSync as jest.Mock;
  const existsSync = fs.existsSync as jest.Mock;
  const mkdirSync = fs.mkdirSync as jest.Mock;

  beforeEach(() => {
    execFileSync.mockReset().mockReturnValue('');
    existsSync.mockReset();
    mkdirSync.mockReset();
    prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({
          project: {
            id: 'project-1',
            github_repository_url: 'https://github.com/acme/app.git',
            default_branch: 'main',
            gitHubAccount: { accessToken: 'enc:tok' },
          },
        }),
      },
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'openharness.projectWorkspacesRoot' ? '/workspaces' : undefined,
      ),
    };
    encryption = { decrypt: jest.fn().mockReturnValue('plain-token') };
    service = new ProjectWorkspaceService(config as never, prisma as never, encryption as never);
  });

  it('clones the project repo into a per-project path on first use', async () => {
    existsSync.mockReturnValue(false); // no existing clone

    const result = await service.resolveWorkspaceDir('ticket-1', '/fallback');

    expect(result.dir).toBe('/workspaces/project-1');
    expect(result.project).toEqual({
      id: 'project-1',
      repositoryUrl: 'https://github.com/acme/app.git',
      defaultBranch: 'main',
    });

    const cloneCall = execFileSync.mock.calls.find((c) => (c[1] as string[]).includes('clone'));
    expect(cloneCall[1]).toEqual([
      'clone',
      '--branch',
      'main',
      'https://x-access-token:plain-token@github.com/acme/app.git',
      '/workspaces/project-1',
    ]);
    // Token-bearing URL must not be persisted in the remote.
    const setUrl = execFileSync.mock.calls.find((c) => (c[1] as string[]).includes('set-url'));
    expect(setUrl[1]).toContain('https://github.com/acme/app.git');
  });

  it('refreshes (not re-clones) an existing clone', async () => {
    existsSync.mockReturnValue(true); // .git present

    await service.resolveWorkspaceDir('ticket-1', '/fallback');

    expect(execFileSync.mock.calls.some((c) => (c[1] as string[]).includes('clone'))).toBe(false);
    expect(execFileSync.mock.calls.some((c) => (c[1] as string[]).includes('fetch'))).toBe(true);
    expect(execFileSync.mock.calls.some((c) => (c[1] as string[]).includes('reset'))).toBe(true);
  });

  it('falls back to the given dir when the project has no repository', async () => {
    prisma.ticket.findUnique.mockResolvedValue({
      project: { id: 'p', github_repository_url: '', default_branch: 'main', gitHubAccount: null },
    });

    const result = await service.resolveWorkspaceDir('ticket-1', '/fallback');

    expect(result).toEqual({ dir: '/fallback', project: null });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('normalizes an ssh repo URL to https before authenticating', async () => {
    existsSync.mockReturnValue(false);
    prisma.ticket.findUnique.mockResolvedValue({
      project: {
        id: 'project-1',
        github_repository_url: 'git@github.com:acme/app.git',
        default_branch: 'main',
        gitHubAccount: { accessToken: 'enc:tok' },
      },
    });

    const result = await service.resolveWorkspaceDir('ticket-1', '/fallback');

    expect(result.project?.repositoryUrl).toBe('https://github.com/acme/app.git');
    const cloneCall = execFileSync.mock.calls.find((c) => (c[1] as string[]).includes('clone'));
    expect(cloneCall[1]).toContain('https://x-access-token:plain-token@github.com/acme/app.git');
  });

  it('throws a credential-redacted error when cloning fails', async () => {
    existsSync.mockReturnValue(false);
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if ((args as string[]).includes('clone')) {
        throw new Error(
          'fatal: https://x-access-token:plain-token@github.com/acme/app.git not found',
        );
      }
      return '';
    });

    await expect(service.resolveWorkspaceDir('ticket-1', '/fallback')).rejects.toThrow(
      /https:\/\/\*\*\*@github\.com/,
    );
  });
});
