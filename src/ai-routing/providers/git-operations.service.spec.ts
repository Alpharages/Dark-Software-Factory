/**
 * Git Operations Service Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 */

import { Test, TestingModule } from '@nestjs/testing';
import { GitOperationsService } from './git-operations.service';
import * as childProcess from 'child_process';
import * as fsPromises from 'fs/promises';

// Mock child_process.execFile with callback pattern support for promisify
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

// Mock fs/promises for .gitignore operations
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  appendFile: jest.fn(),
}));

describe('GitOperationsService', () => {
  let service: GitOperationsService;
  let mockExecFile: jest.Mock;

  // Helper to mock successful execFile call (callback-based for promisify compatibility)
  const mockSuccess = (stdout = '', stderr = '') => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        // Call callback asynchronously to simulate real behavior
        process.nextTick(() => callback(null, { stdout, stderr }));
      },
    );
  };

  // Helper to mock failed execFile call
  const mockFailure = (error: Error) => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        process.nextTick(() => callback(error));
      },
    );
  };

  // Helper for sequential mock responses
  const mockSequence = (responses: Array<{ stdout: string; stderr: string } | Error>) => {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        const response = responses[callIndex++];
        process.nextTick(() => {
          if (response instanceof Error) {
            callback(response);
          } else {
            callback(null, response);
          }
        });
      },
    );
  };

  beforeEach(async () => {
    mockExecFile = childProcess.execFile as unknown as jest.Mock;

    // Default: .gitignore already contains all exclusions (no append needed)
    (fsPromises.readFile as jest.Mock).mockResolvedValue(
      '# compiled output\n/dist\n/node_modules\n.pnpm-store\n.yarn/cache\n.npm\n__pycache__\n.cache\n',
    );
    (fsPromises.appendFile as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [GitOperationsService],
    }).compile();

    service = module.get<GitOperationsService>(GitOperationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('clone', () => {
    it('should clone repository to target path', async () => {
      mockSuccess();

      await service.clone('https://github.com/test/repo.git', '/tmp/workspace');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://github.com/test/repo.git', '/tmp/workspace'],
        expect.objectContaining({ timeout: 120000 }),
        expect.any(Function),
      );
    });

    it('should clone with depth option', async () => {
      mockSuccess();

      await service.clone('https://github.com/test/repo.git', '/tmp/workspace', { depth: 1 });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--depth', '1']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should clone with branch option', async () => {
      mockSuccess();

      await service.clone('https://github.com/test/repo.git', '/tmp/workspace', {
        branch: 'develop',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--branch', 'develop']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should throw on clone failure', async () => {
      mockFailure(new Error('Clone failed'));

      await expect(
        service.clone('https://github.com/test/repo.git', '/tmp/workspace'),
      ).rejects.toThrow('Git operation failed');
    });
  });

  describe('configureUser', () => {
    it('should configure git user name and email', async () => {
      mockSuccess();

      await service.configureUser('/tmp/workspace', 'Test User', 'test@example.com');

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', 'user.name', 'Test User'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', 'user.email', 'test@example.com'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
    });
  });

  describe('checkoutBranch', () => {
    it('should checkout existing branch', async () => {
      mockSuccess();

      await service.checkoutBranch('/tmp/workspace', 'feature-branch');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feature-branch'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
    });

    it('should create and checkout new branch', async () => {
      mockSuccess();

      await service.checkoutBranch('/tmp/workspace', 'new-branch', true);

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['checkout', '-b', 'new-branch'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
    });
  });

  describe('getDiff', () => {
    it('should stage changes and return diff', async () => {
      const mockDiff = 'diff --git a/file.ts b/file.ts\\n...';
      mockSequence([
        { stdout: '', stderr: '' }, // add -A
        { stdout: mockDiff, stderr: '' }, // diff --cached
      ]);

      const diff = await service.getDiff('/tmp/workspace');

      expect(diff).toBe(mockDiff);
    });
  });

  describe('getChangedFiles', () => {
    it('should return list of changed files', async () => {
      const mockStatus = 'M  src/file1.ts\nA  src/file2.ts\nD  src/file3.ts';
      mockSuccess(mockStatus);

      const files = await service.getChangedFiles('/tmp/workspace');

      expect(files).toEqual(['src/file1.ts', 'src/file2.ts', 'src/file3.ts']);
    });

    it('should return empty array when no changes', async () => {
      mockSuccess('');

      const files = await service.getChangedFiles('/tmp/workspace');

      expect(files).toEqual([]);
    });

    it('should filter out .pnpm-store and other excluded paths', async () => {
      const mockStatus =
        'A  src/app.ts\nA  .pnpm-store/v10/files/00/abc123\nA  .pnpm-store/v10/files/01/def456\nM  README.md\nA  __pycache__/module.cpython-311.pyc';
      mockSuccess(mockStatus);

      const files = await service.getChangedFiles('/tmp/workspace');

      expect(files).toEqual(['src/app.ts', 'README.md']);
    });
  });

  describe('hasChanges', () => {
    it('should return true when there are changes', async () => {
      mockSuccess('M  src/file.ts');

      const hasChanges = await service.hasChanges('/tmp/workspace');

      expect(hasChanges).toBe(true);
    });

    it('should return false when no changes', async () => {
      mockSuccess('');

      const hasChanges = await service.hasChanges('/tmp/workspace');

      expect(hasChanges).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockSuccess('feature-branch\n');

      const branch = await service.getCurrentBranch('/tmp/workspace');

      expect(branch).toBe('feature-branch');
    });
  });

  describe('resetChanges', () => {
    it('should reset and clean workspace', async () => {
      mockSuccess();

      await service.resetChanges('/tmp/workspace');

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'HEAD'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['clean', '-fd'],
        expect.objectContaining({ cwd: '/tmp/workspace' }),
        expect.any(Function),
      );
    });
  });

  describe('commit', () => {
    it('should create commit and return SHA', async () => {
      const mockSha = 'abc123def456';
      mockSequence([
        { stdout: '', stderr: '' }, // add -A
        { stdout: '', stderr: '' }, // commit -m
        { stdout: mockSha + '\n', stderr: '' }, // rev-parse HEAD
      ]);

      const sha = await service.commit('/tmp/workspace', 'Test commit message');

      expect(sha).toBe(mockSha);
    });
  });
});
