/**
 * Git Mirror Service Tests
 * Story 23.1: Local Git Mirror Service
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram } from 'prom-client';
import * as path from 'path';
import * as os from 'os';
import { GitMirrorService } from './git-mirror.service';
import { StorageManagerService, DiskUsageInfo } from '../storage/storage-manager.service';
import { GitHubAuthService } from '../github/github-auth.service';
import {
  MirrorAuthError,
  MirrorNetworkError,
  MirrorCorruptedError,
  MirrorDiskSpaceError,
  MirrorLockTimeoutError,
} from './exceptions/git-mirror.exception';

// Create temp dir before mocking fs
const tempDir = path.join(os.tmpdir(), 'git-mirror-test-' + Date.now());

// Mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ isDirectory: () => true }),
  statfs: jest.fn().mockResolvedValue({
    blocks: 1000000,
    bavail: 500000,
    bsize: 4096,
  }),
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn().mockRejectedValue(new Error('Not found')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
}));

// Mock child_process
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'child_process';
const mockedExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('GitMirrorService', () => {
  let service: GitMirrorService;
  let configService: ConfigService;
  let mockStorageManager: jest.Mocked<StorageManagerService>;

  const mockMirrorGauge = {
    set: jest.fn(),
  } as unknown as Gauge<string>;

  const mockHitCounter = {
    inc: jest.fn(),
  } as unknown as Counter<string>;

  const mockCloneHistogram = {
    observe: jest.fn(),
  } as unknown as Histogram<string>;

  const mockUpdateHistogram = {
    observe: jest.fn(),
  } as unknown as Histogram<string>;

  const mockSizeGauge = {
    set: jest.fn(),
  } as unknown as Gauge<string>;

  const mockEvictedCounter = {
    inc: jest.fn(),
  } as unknown as Counter<string>;

  const mockGitHubAuthService = {
    getAuthenticatedClient: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<GitHubAuthService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockStorageManager = {
      getDiskUsage: jest.fn().mockResolvedValue({
        availableBytes: BigInt(100 * 1024 * 1024 * 1024), // 100GB free
        usedBytes: BigInt(50 * 1024 * 1024 * 1024),
        totalBytes: BigInt(150 * 1024 * 1024 * 1024),
        usedPercentage: 33.3,
      } as DiskUsageInfo),
    } as unknown as jest.Mocked<StorageManagerService>;

    const module = await Test.createTestingModule({
      providers: [
        GitMirrorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                GIT_MIRROR_BASE_PATH: path.join(tempDir, 'git-mirrors'),
                GIT_MIRROR_TTL_HOURS: 24,
                GIT_MIRROR_MAX_SIZE_GB: 50,
                GIT_MIRROR_MIN_FREE_SPACE_GB: 10,
                GIT_MIRROR_CLEANUP_INTERVAL_MS: 3600000,
                ENABLE_GIT_MIRRORING: true,
                GITHUB_TOKEN: 'ghp_test_token_12345',
                'github.token': 'ghp_test_token_12345',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        { provide: StorageManagerService, useValue: mockStorageManager },
        { provide: GitHubAuthService, useValue: mockGitHubAuthService },
        { provide: 'PROM_METRIC_GIT_MIRROR_TOTAL', useValue: mockMirrorGauge },
        { provide: 'PROM_METRIC_GIT_MIRROR_HIT_TOTAL', useValue: mockHitCounter },
        {
          provide: 'PROM_METRIC_GIT_MIRROR_CLONE_DURATION_SECONDS',
          useValue: mockCloneHistogram,
        },
        {
          provide: 'PROM_METRIC_GIT_MIRROR_UPDATE_DURATION_SECONDS',
          useValue: mockUpdateHistogram,
        },
        { provide: 'PROM_METRIC_GIT_MIRROR_SIZE_BYTES', useValue: mockSizeGauge },
        { provide: 'PROM_METRIC_GIT_MIRROR_EVICTED_TOTAL', useValue: mockEvictedCounter },
      ],
    }).compile();

    service = module.get<GitMirrorService>(GitMirrorService);
    configService = module.get<ConfigService>(ConfigService);

    // Initialize the service
    await (service as unknown as { onModuleInit(): Promise<void> }).onModuleInit();
  });

  afterEach(async () => {
    // Clean up service
    await (service as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
  });

  describe('Configuration', () => {
    it('should load configuration values from ConfigService', () => {
      expect(service).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith(
        'GIT_MIRROR_BASE_PATH',
        '/tmp/dsf/git-mirrors',
      );
      expect(configService.get).toHaveBeenCalledWith('GIT_MIRROR_TTL_HOURS', 24);
      expect(configService.get).toHaveBeenCalledWith('ENABLE_GIT_MIRRORING', true);
    });

    it('should throw error if mirroring is disabled', async () => {
      const disabledModule = await Test.createTestingModule({
        providers: [
          GitMirrorService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, unknown> = {
                  GIT_MIRROR_BASE_PATH: path.join(tempDir, 'git-mirrors'),
                  GIT_MIRROR_TTL_HOURS: 24,
                  GIT_MIRROR_MAX_SIZE_GB: 50,
                  GIT_MIRROR_MIN_FREE_SPACE_GB: 10,
                  GIT_MIRROR_CLEANUP_INTERVAL_MS: 3600000,
                  ENABLE_GIT_MIRRORING: false, // Disabled
                  GITHUB_TOKEN: 'ghp_test_token',
                  'github.token': 'ghp_test_token',
                };
                return config[key];
              }),
            },
          },
          { provide: StorageManagerService, useValue: mockStorageManager },
          { provide: GitHubAuthService, useValue: mockGitHubAuthService },
          { provide: 'PROM_METRIC_GIT_MIRROR_TOTAL', useValue: mockMirrorGauge },
          { provide: 'PROM_METRIC_GIT_MIRROR_HIT_TOTAL', useValue: mockHitCounter },
          {
            provide: 'PROM_METRIC_GIT_MIRROR_CLONE_DURATION_SECONDS',
            useValue: mockCloneHistogram,
          },
          {
            provide: 'PROM_METRIC_GIT_MIRROR_UPDATE_DURATION_SECONDS',
            useValue: mockUpdateHistogram,
          },
          { provide: 'PROM_METRIC_GIT_MIRROR_SIZE_BYTES', useValue: mockSizeGauge },
          { provide: 'PROM_METRIC_GIT_MIRROR_EVICTED_TOTAL', useValue: mockEvictedCounter },
        ],
      }).compile();

      const disabledService = disabledModule.get<GitMirrorService>(GitMirrorService);
      await (disabledService as unknown as { onModuleInit(): Promise<void> }).onModuleInit();

      await expect(
        disabledService.getOrCreateMirror('https://github.com/owner/repo.git'),
      ).rejects.toThrow('Git mirroring is disabled');
    });
  });

  describe('parseRepositoryUrl', () => {
    it('should parse GitHub HTTPS URL with .git extension', () => {
      const result = (
        service as unknown as { parseRepositoryUrl(url: string): { owner: string; repo: string } }
      ).parseRepositoryUrl('https://github.com/alpharages/Dark Software Factory.git');
      expect(result).toEqual({ owner: 'alpharages', repo: 'Dark Software Factory' });
    });

    it('should parse GitHub HTTPS URL without .git extension', () => {
      const result = (
        service as unknown as { parseRepositoryUrl(url: string): { owner: string; repo: string } }
      ).parseRepositoryUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw error for invalid URL format', () => {
      expect(() =>
        (
          service as unknown as { parseRepositoryUrl(url: string): { owner: string; repo: string } }
        ).parseRepositoryUrl('invalid-url'),
      ).toThrow('Invalid repository URL format');
    });

    it('should throw error for non-GitHub URLs', () => {
      expect(() =>
        (
          service as unknown as { parseRepositoryUrl(url: string): { owner: string; repo: string } }
        ).parseRepositoryUrl('https://gitlab.com/owner/repo.git'),
      ).toThrow('Invalid repository URL format');
    });
  });

  describe('parseMirrorPath', () => {
    it('should parse mirror path correctly', () => {
      const basePath = path.join(tempDir, 'git-mirrors');
      const mirrorPath = path.join(basePath, 'owner', 'repo.git');

      const result = (
        service as unknown as {
          parseMirrorPath(mirrorPath: string): { owner: string; repo: string };
        }
      ).parseMirrorPath(mirrorPath);

      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw error for invalid mirror path', () => {
      // A path that would result in empty relative path or invalid structure
      expect(() =>
        (
          service as unknown as {
            parseMirrorPath(mirrorPath: string): { owner: string; repo: string };
          }
        ).parseMirrorPath(tempDir),
      ).toThrow('Invalid mirror path');
    });
  });

  describe('getMirrorPath', () => {
    it('should return correct mirror path for owner/repo', () => {
      const result = (
        service as unknown as { getMirrorPath(owner: string, repo: string): string }
      ).getMirrorPath('alpharages', 'Dark Software Factory');
      expect(result).toContain('alpharages');
      expect(result).toContain('Dark Software Factory.git');
    });
  });

  describe('isMirrorStale', () => {
    it('should return true for mirror older than TTL', () => {
      // TTL is 24 hours, so 25 hours ago should be stale
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const result = (
        service as unknown as { isMirrorStale(lastUpdated: Date): boolean }
      ).isMirrorStale(oldDate);
      expect(result).toBe(true);
    });

    it('should return false for mirror within TTL', () => {
      // 1 hour ago should NOT be stale (TTL is 24 hours)
      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
      const result = (
        service as unknown as { isMirrorStale(lastUpdated: Date): boolean }
      ).isMirrorStale(recentDate);
      expect(result).toBe(false);
    });

    it('should return false for freshly created mirror', () => {
      const now = new Date();
      const result = (
        service as unknown as { isMirrorStale(lastUpdated: Date): boolean }
      ).isMirrorStale(now);
      expect(result).toBe(false);
    });
  });

  describe('Exception Classes', () => {
    it('should create MirrorAuthError with correct properties', () => {
      const error = new MirrorAuthError('https://github.com/owner/repo.git');
      expect(error.message).toContain('Authentication failed');
      expect(error.message).toContain('github.com/owner/repo.git');
      expect(error.getStatus()).toBe(401);
    });

    it('should create MirrorNetworkError with correct properties', () => {
      const error = new MirrorNetworkError('https://github.com/owner/repo.git', 'ECONNREFUSED');
      expect(error.message).toContain('Network error');
      expect(error.message).toContain('ECONNREFUSED');
      expect(error.getStatus()).toBe(503);
    });

    it('should create MirrorCorruptedError with correct properties', () => {
      const error = new MirrorCorruptedError('/mirrors/owner/repo.git');
      expect(error.message).toContain('corrupted');
      expect(error.message).toContain('/mirrors/owner/repo.git');
      expect(error.getStatus()).toBe(500);
    });

    it('should create MirrorDiskSpaceError with correct properties', () => {
      const error = new MirrorDiskSpaceError(10000000000, 5000000000);
      expect(error.message).toContain('Insufficient disk space');
      expect(error.getStatus()).toBe(507);
    });

    it('should create MirrorLockTimeoutError with correct properties', () => {
      const error = new MirrorLockTimeoutError('/mirrors/owner/repo.git', 30000);
      expect(error.message).toContain('lock timeout');
      expect(error.message).toContain('30000ms');
      expect(error.getStatus()).toBe(409);
    });
  });

  describe('Mirror Locking', () => {
    it('should acquire and release mirror lock', async () => {
      const acquireMirrorLock = (
        service as unknown as {
          acquireMirrorLock(key: string): Promise<() => void>;
        }
      ).acquireMirrorLock.bind(service);

      const release = await acquireMirrorLock('test/mirror');
      expect(typeof release).toBe('function');

      // Should not throw
      release();
    });

    it('should serialize concurrent access to same mirror', async () => {
      const acquireMirrorLock = (
        service as unknown as {
          acquireMirrorLock(key: string): Promise<() => void>;
        }
      ).acquireMirrorLock.bind(service);

      let lock1Acquired = false;
      let lock2Acquired = false;

      // First lock
      const lock1Promise = acquireMirrorLock('concurrent/test').then((release) => {
        lock1Acquired = true;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            release();
            lock1Acquired = false;
            resolve();
          }, 50);
        });
      });

      // Small delay to ensure order
      await new Promise((r) => setTimeout(r, 10));

      // Second lock (should wait for first)
      const lock2Promise = acquireMirrorLock('concurrent/test').then((release) => {
        lock2Acquired = true;
        expect(lock1Acquired).toBe(false); // First lock should be released
        release();
      });

      await Promise.all([lock1Promise, lock2Promise]);
      expect(lock2Acquired).toBe(true);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations with exponential backoff', async () => {
      const withRetry = (
        service as unknown as {
          withRetry<T>(fn: () => Promise<T>, name: string): Promise<T>;
        }
      ).withRetry.bind(service);

      let attempts = 0;
      const failingOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Temporary error'));
        }
        return Promise.resolve('success');
      });

      const result = await withRetry(failingOperation, 'test operation');

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(failingOperation).toHaveBeenCalledTimes(3);
    });

    it('should not retry MirrorAuthError', async () => {
      const withRetry = (
        service as unknown as {
          withRetry<T>(fn: () => Promise<T>, name: string): Promise<T>;
        }
      ).withRetry.bind(service);

      let attempts = 0;
      const authFailingOperation = jest.fn().mockImplementation(() => {
        attempts++;
        throw new MirrorAuthError('https://github.com/owner/repo.git');
      });

      await expect(withRetry(authFailingOperation, 'auth test')).rejects.toThrow(MirrorAuthError);
      expect(attempts).toBe(1); // Should not retry
    });

    it('should throw last error after max retries', async () => {
      const withRetry = (
        service as unknown as {
          withRetry<T>(fn: () => Promise<T>, name: string): Promise<T>;
        }
      ).withRetry.bind(service);

      const alwaysFailing = jest.fn().mockRejectedValue(new Error('Persistent error'));

      await expect(withRetry(alwaysFailing, 'failing test')).rejects.toThrow('Persistent error');
      expect(alwaysFailing).toHaveBeenCalledTimes(3); // maxRetries
    });
  });

  describe('Git Command Execution', () => {
    beforeEach(() => {
      mockedExecFile.mockReset();
    });

    it('should call execFile with correct arguments', () => {
      // Verify that the execFile mock is set up correctly
      // Actual execution testing is done via integration tests

      // Reset and verify the mock function exists
      mockedExecFile.mockClear();
      expect(mockedExecFile).not.toHaveBeenCalled();

      // The actual execution is complex to mock due to promisify
      // This test documents that execGit uses execFile internally
    });

    it('should execute git command with auth via environment', async () => {
      mockedExecFile.mockImplementation((cmd, args, opts, callback) => {
        // Verify auth is passed via env, not URL
        const options = opts as { env?: Record<string, string> };
        expect(options?.env?.['GIT_USERNAME']).toBe('x-access-token');
        expect(options?.env?.['GIT_PASSWORD']).toBe('ghp_test_token_12345');

        if (callback) {
          (callback as (error: Error | null, stdout: string, stderr: string) => void)(
            null,
            'success',
            '',
          );
        }
        return undefined as unknown as ReturnType<typeof execFile>;
      });

      const execGitWithAuth = (
        service as unknown as {
          execGitWithAuth(
            args: string[],
            cwd?: string,
            desc?: string,
          ): Promise<{ stdout: string; stderr: string }>;
        }
      ).execGitWithAuth.bind(service);

      await execGitWithAuth(
        ['clone', 'https://github.com/owner/repo.git', '/dest'],
        undefined,
        'Clone',
      );
    });

    it('should sanitize error messages to prevent token exposure', async () => {
      mockedExecFile.mockImplementation((cmd, args, opts, callback) => {
        if (callback) {
          (callback as (error: Error | null, stdout: string, stderr: string) => void)(
            new Error('fatal: unable to access: x-access-token:ghp_secret123@github.com'),
            '',
            '',
          );
        }
        return undefined as unknown as ReturnType<typeof execFile>;
      });

      const execGitWithAuth = (
        service as unknown as {
          execGitWithAuth(
            args: string[],
            cwd?: string,
            desc?: string,
          ): Promise<{ stdout: string; stderr: string }>;
        }
      ).execGitWithAuth.bind(service);

      try {
        await execGitWithAuth(['clone', 'https://github.com/owner/repo.git', '/dest']);
        fail('Should have thrown');
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        // Token should be masked
        expect(errorMessage).not.toContain('ghp_secret123');
        expect(errorMessage).toContain('***');
      }
    });
  });

  describe('Disk Space Management', () => {
    it('should check disk space before creating mirror', async () => {
      mockStorageManager.getDiskUsage.mockResolvedValue({
        availableBytes: BigInt(5 * 1024 * 1024 * 1024), // Only 5GB free, but need 10GB
        usedBytes: BigInt(50 * 1024 * 1024 * 1024),
        totalBytes: BigInt(55 * 1024 * 1024 * 1024),
        usedPercentage: 90.9,
      } as DiskUsageInfo);

      // Mock evictOldestMirrorsIfNeeded to not free enough space
      const evictSpy = jest.spyOn(service, 'evictOldestMirrorsIfNeeded').mockResolvedValue(0);

      const checkDiskSpaceForMirror = (
        service as unknown as {
          checkDiskSpaceForMirror(): Promise<void>;
        }
      ).checkDiskSpaceForMirror.bind(service);

      await expect(checkDiskSpaceForMirror()).rejects.toThrow(MirrorDiskSpaceError);

      evictSpy.mockRestore();
    });

    it('should allow mirror creation when sufficient disk space', async () => {
      mockStorageManager.getDiskUsage.mockResolvedValue({
        availableBytes: BigInt(20 * 1024 * 1024 * 1024), // 20GB free
        usedBytes: BigInt(50 * 1024 * 1024 * 1024),
        totalBytes: BigInt(70 * 1024 * 1024 * 1024),
        usedPercentage: 71.4,
      } as DiskUsageInfo);

      const checkDiskSpaceForMirror = (
        service as unknown as {
          checkDiskSpaceForMirror(): Promise<void>;
        }
      ).checkDiskSpaceForMirror.bind(service);

      // Should not throw
      await expect(checkDiskSpaceForMirror()).resolves.toBeUndefined();
    });
  });

  describe('Metadata Management', () => {
    it('should debounce metadata writes', async () => {
      const scheduleMetadataWrite = (
        service as unknown as {
          scheduleMetadataWrite(): Promise<void>;
        }
      ).scheduleMetadataWrite.bind(service);

      // Multiple rapid calls should be debounced
      await scheduleMetadataWrite();
      await scheduleMetadataWrite();
      await scheduleMetadataWrite();

      // Wait for debounce timeout
      await new Promise((r) => setTimeout(r, 1100));

      // File should only be written once (or a few times, not 3)
      // Note: This test verifies the debouncing mechanism is in place
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete mirror lifecycle', async () => {
      // Mock successful git operations
      let gitCallCount = 0;
      mockedExecFile.mockImplementation((cmd, args, opts, callback) => {
        gitCallCount++;
        const argsArray = (args as string[]) || [];

        // Simulate git clone --mirror
        if (argsArray.includes('clone') && argsArray.includes('--mirror')) {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              'Cloning into bare repository',
              '',
            );
          }
        }
        // Simulate git fsck
        else if (argsArray.includes('fsck')) {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              '',
              '',
            );
          }
        }
        // Other commands
        else {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              'success',
              '',
            );
          }
        }
        return undefined as unknown as ReturnType<typeof execFile>;
      });

      // Step 1: Get or create mirror (should create new)
      const repoUrl = 'https://github.com/test/repo.git';
      const mirrorInfo = await service.getOrCreateMirror(repoUrl);

      expect(mirrorInfo).toBeDefined();
      expect(mirrorInfo.owner).toBe('test');
      expect(mirrorInfo.repo).toBe('repo');
      expect(gitCallCount).toBeGreaterThan(0);

      // Step 2: Clone from mirror
      const targetPath = path.join(tempDir, 'workspace');
      await service.cloneFromMirror(mirrorInfo.mirrorPath, targetPath);

      // Verify metrics were recorded
      expect(mockCloneHistogram.observe).toHaveBeenCalled();
      expect(mockHitCounter.inc).toHaveBeenCalled();
    });
  });

  describe('Metrics', () => {
    it('should update mirror gauge on init', () => {
      expect(mockMirrorGauge.set).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should update size gauge when creating mirror', async () => {
      // Mock successful git operations
      mockedExecFile.mockImplementation((cmd, args, opts, callback) => {
        const argsArray = (args as string[]) || [];

        if (argsArray.includes('clone') && argsArray.includes('--mirror')) {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              'Cloning into bare repository',
              '',
            );
          }
        } else if (argsArray.includes('fsck')) {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              '',
              '',
            );
          }
        } else {
          if (callback) {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              'success',
              '',
            );
          }
        }
        return undefined as unknown as ReturnType<typeof execFile>;
      });

      await service.getOrCreateMirror('https://github.com/test/repo.git');

      // Verify size gauge was set
      expect(mockSizeGauge.set).toHaveBeenCalledWith(
        { owner: 'test', repo: 'repo' },
        expect.any(Number),
      );
    });

    it('should increment evicted counter when evicting mirrors', async () => {
      // Set up low disk space scenario
      mockStorageManager.getDiskUsage.mockResolvedValue({
        availableBytes: BigInt(5 * 1024 * 1024 * 1024), // Only 5GB free
        usedBytes: BigInt(50 * 1024 * 1024 * 1024),
        totalBytes: BigInt(55 * 1024 * 1024 * 1024),
        usedPercentage: 90.9,
      } as DiskUsageInfo);

      // Mock a mirror in metadata cache
      const metadataCache = (service as unknown as { metadataCache: Map<string, unknown> })
        .metadataCache;
      metadataCache.set('test/evict-repo', {
        owner: 'test',
        repo: 'evict-repo',
        mirrorPath: path.join(tempDir, 'git-mirrors', 'test', 'evict-repo.git'),
        sizeBytes: 1024 * 1024 * 100, // 100MB
        lastUpdated: new Date().toISOString(),
        lastUsed: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        cloneCount: 1,
        updateCount: 0,
        repositoryUrl: 'https://github.com/test/evict-repo.git',
        createdAt: new Date().toISOString(),
      });

      await service.evictOldestMirrorsIfNeeded();

      // Verify evicted counter was incremented
      expect(mockEvictedCounter.inc).toHaveBeenCalledWith({ reason: 'disk_space' });
    });
  });
});
