/**
 * Workspace Service Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';
import { GitOperationsService } from './git-operations.service';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let gitService: jest.Mocked<GitOperationsService>;
  let mockActiveGauge: { set: jest.Mock };
  let mockOperationsCounter: { inc: jest.Mock };

  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    // Setup fs mocks BEFORE module creation
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.rm.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
      ReturnType<typeof fs.stat>
    >);
    mockFs.statfs.mockResolvedValue({
      bavail: 1000000,
      bsize: 4096,
      blocks: 2000000,
      bfree: 1500000,
    } as unknown as Awaited<ReturnType<typeof fs.statfs>>);

    mockActiveGauge = { set: jest.fn() };
    mockOperationsCounter = { inc: jest.fn() };

    const mockGitService = {
      clone: jest.fn(),
      configureUser: jest.fn(),
      checkoutBranch: jest.fn(),
      getDiff: jest.fn(),
      getChangedFiles: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'cursor.workspacesRoot': '/tmp/test-workspaces',
          'cursor.maxConcurrentWorkspaces': 10,
          'cursor.preserveFailedWorkspaces': true,
          'cursor.workspaceCleanupAgeMs': 7 * 24 * 60 * 60 * 1000,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: GitOperationsService, useValue: mockGitService },
        { provide: 'PROM_METRIC_CURSOR_WORKSPACES_ACTIVE', useValue: mockActiveGauge },
        {
          provide: 'PROM_METRIC_CURSOR_WORKSPACE_OPERATIONS_TOTAL',
          useValue: mockOperationsCounter,
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    gitService = module.get(GitOperationsService);

    // Initialize the service
    await service.onModuleInit();
  });

  afterEach(async () => {
    // Cleanup the service to stop the cleanup scheduler
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    it('should create workspace successfully', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      const workspace = await service.createWorkspace(
        'exec-123',
        '456',
        'https://github.com/test/repo.git',
        'main',
      );

      expect(workspace.id).toContain('456');
      expect(workspace.status).toBe('READY');
      expect(workspace.ticketId).toBe('456');
      expect(workspace.executionId).toBe('exec-123');
      expect(workspace.branchName).toBe('feature/ticket-456');

      expect(gitService.clone).toHaveBeenCalled();
      expect(gitService.configureUser).toHaveBeenCalledWith(
        expect.any(String),
        'Dark Factory',
        'bot@darkfactory.ai',
      );
      expect(gitService.checkoutBranch).toHaveBeenCalledWith(
        expect.any(String),
        'feature/ticket-456',
        true,
      );
      expect(mockOperationsCounter.inc).toHaveBeenCalledWith({
        operation: 'create',
        status: 'success',
      });
    });

    it('should fail when max concurrent workspaces reached', async () => {
      // Create 10 workspaces to hit the limit
      for (let i = 0; i < 10; i++) {
        gitService.clone.mockResolvedValue();
        gitService.configureUser.mockResolvedValue();
        gitService.checkoutBranch.mockResolvedValue();
        await service.createWorkspace(
          `exec-${i}`,
          `ticket-${i}`,
          'https://github.com/test/repo.git',
          'main',
        );
      }

      // 11th should fail
      await expect(
        service.createWorkspace('exec-11', 'ticket-11', 'https://github.com/test/repo.git', 'main'),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_LIMIT',
        isRetryable: false,
      });
    });

    it('should cleanup on clone failure', async () => {
      gitService.clone.mockRejectedValue(new Error('Clone failed'));

      await expect(
        service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main'),
      ).rejects.toMatchObject({
        code: 'CLONE_FAILED',
        isRetryable: true,
      });

      expect(mockOperationsCounter.inc).toHaveBeenCalledWith({
        operation: 'create',
        status: 'error',
      });
    });
  });

  describe('getWorkspace', () => {
    it('should return workspace by execution ID', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      const workspace = service.getWorkspace('exec-123');

      expect(workspace).toBeDefined();
      expect(workspace?.executionId).toBe('exec-123');
    });

    it('should return undefined for non-existent workspace', () => {
      const workspace = service.getWorkspace('non-existent');
      expect(workspace).toBeUndefined();
    });
  });

  describe('updateWorkspaceStatus', () => {
    it('should update workspace status', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      service.updateWorkspaceStatus('exec-123', 'EXECUTING');

      const workspace = service.getWorkspace('exec-123');
      expect(workspace?.status).toBe('EXECUTING');
    });

    it('should do nothing for non-existent workspace', () => {
      // Should not throw
      service.updateWorkspaceStatus('non-existent', 'EXECUTING');
    });
  });

  describe('extractChanges', () => {
    it('should extract diff and changed files', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();
      gitService.getDiff.mockResolvedValue('diff --git a/file.ts...');
      gitService.getChangedFiles.mockResolvedValue(['src/file.ts']);

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      const changes = await service.extractChanges('exec-123');

      expect(changes.diff).toBe('diff --git a/file.ts...');
      expect(changes.filesChanged).toEqual(['src/file.ts']);
    });

    it('should throw for non-existent workspace', async () => {
      await expect(service.extractChanges('non-existent')).rejects.toThrow('Workspace not found');
    });
  });

  describe('cleanupWorkspace', () => {
    it('should cleanup workspace', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      await service.cleanupWorkspace('exec-123', true);

      expect(mockFs.rm).toHaveBeenCalled();
      expect(service.getWorkspace('exec-123')).toBeUndefined();
    });

    it('should preserve failed workspace if configured', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');
      service.updateWorkspaceStatus('exec-123', 'FAILED');

      await service.cleanupWorkspace('exec-123', false);

      // Should NOT be deleted (preserveFailedWorkspaces = true)
      expect(mockFs.rm).not.toHaveBeenCalled();
      expect(service.getWorkspace('exec-123')).toBeDefined();
    });
  });

  describe('getActiveWorkspaces', () => {
    it('should return all active workspaces', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace(
        'exec-1',
        'ticket-1',
        'https://github.com/test/repo.git',
        'main',
      );
      await service.createWorkspace(
        'exec-2',
        'ticket-2',
        'https://github.com/test/repo.git',
        'main',
      );

      const workspaces = service.getActiveWorkspaces();

      expect(workspaces).toHaveLength(2);
    });
  });

  describe('getActiveCount', () => {
    it('should return count of active workspaces', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      expect(service.getActiveCount()).toBe(0);

      await service.createWorkspace(
        'exec-1',
        'ticket-1',
        'https://github.com/test/repo.git',
        'main',
      );

      expect(service.getActiveCount()).toBe(1);
    });
  });

  describe('checkDiskSpace', () => {
    it('should return available disk space', async () => {
      const result = await service.checkDiskSpace();

      expect(result.available).toBe(true);
      expect(result.usedMB).toBeGreaterThanOrEqual(0);
    });

    it('should return available=true on statfs error', async () => {
      mockFs.statfs.mockRejectedValue(new Error('statfs failed'));

      const result = await service.checkDiskSpace();

      expect(result.available).toBe(true);
      expect(result.usedMB).toBe(0);
    });
  });
});
