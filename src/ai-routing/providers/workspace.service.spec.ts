/**
 * Workspace Service Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';
import { GitOperationsService } from './git-operations.service';
import * as fs from 'fs/promises';
import { PrismaService } from '@/database/prisma.service';
import { StorageManagerService } from '../../storage/storage-manager.service';
import { GitMirrorService } from '../../git-mirror/git-mirror.service';
import { ExecutionTrackerService } from '../../execution/execution-tracker.service';
import { GitHubTokenResolverService } from '../../github/github-token-resolver.service';

// Mock fs/promises
jest.mock('fs/promises');

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let gitService: jest.Mocked<GitOperationsService>;
  let mockGitMirrorService: jest.Mocked<GitMirrorService>;
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

    // In-memory prisma.workspace mock to support concurrency/count semantics
    const workspaces: Array<{ execution_id: string; [key: string]: unknown }> = [];

    const mockPrismaService = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({ project_id: 'proj-123' }),
      },
      workspace: {
        findUnique: jest.fn(async ({ where }: { where: { execution_id: string } }) => {
          return workspaces.find((w) => w.execution_id === where.execution_id) ?? null;
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { execution_id: string } }) => {
          const found = workspaces.find((w) => w.execution_id === where.execution_id);
          if (!found) throw new Error('Not found');
          return found;
        }),
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: {
              ticket_id: string;
              status: { in: string[] } | { notIn: string[] };
            };
            orderBy: { updated_at: 'desc' };
          }) => {
            // simplified findFirst implementation to match test scenario
            const matches = workspaces.filter((w) => w.ticket_id === where.ticket_id);
            // Sort by updated_at desc (if we were tracking it)
            // matches.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());

            // Filter by status if provided
            // For test, we assume if ticket_id matches, it's the one we want unless test specifically sets bad status
            return matches[0] || null;
          },
        ),
        findMany: jest.fn(async () => {
          // Used by recoverWorkspaces / cleanup scheduler; return all
          return workspaces;
        }),
        count: jest.fn(async () => workspaces.length),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { ...data, created_at: new Date(), updated_at: new Date() } as unknown as {
            execution_id: string;
            ticket_id: string;
          };
          workspaces.push(record);
          return record;
        }),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { execution_id?: string; id?: string };
            data: Record<string, unknown>;
          }) => {
            // Check if we are updating by id or execution_id
            let idx = -1;
            if (where.execution_id) {
              idx = workspaces.findIndex((w) => w.execution_id === where.execution_id);
            } else if (where.id) {
              // In mock, allow lookup by id (which might be workspace_id depending on how it's used, but let's assume we find it)
              // The real findFirst returns a full object including 'id'.
              // For this mock, 'id' is probably not set/used consistently unless we did so in create.
              // Let's assume we can fallback to searching by ticket_id or iterate all
              // But wait, the update call in the service is: update({ where: { id: existingTicketWorkspace.id }, ... })
              // We need to ensure logic works.
              idx = workspaces.findIndex(
                (w) => w.workspace_id === where.id || w.execution_id === where.id,
              ); // hack for mock
              // Ideally we should assign 'id' on create.
            }

            if (idx < 0) {
              // Try one last ditch effort: if we found it via findFirst, it exists.
              // If we are updating it, we likely have the object ref in memory in real usage.
              // For the mock, let's just grab the first one if we can't find it? No that's dangerous.
              // Inspect 'where':
              if (where.id) {
                // In create, we didn't explicitly set 'id', only 'workspace_id'. Prisma usually sets 'id' (int/uuid).
                // Let's assume for this mock that 'workspace_id' is used as 'id' or we need to fix create to set 'id'.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                idx = workspaces.findIndex((w) => (w as any).id === where.id);
              }
            }

            if (idx < 0) throw new Error('Not found');
            workspaces[idx] = { ...workspaces[idx], ...data, updated_at: new Date() };
            return workspaces[idx];
          },
        ),
        upsert: jest.fn(
          async ({
            where,
            update,
            create,
          }: {
            where: { execution_id: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
          }) => {
            const idx = workspaces.findIndex((w) => w.execution_id === where.execution_id);
            if (idx >= 0) {
              // Update existing
              workspaces[idx] = { ...workspaces[idx], ...update, updated_at: new Date() };
              return workspaces[idx];
            } else {
              // Create new
              const record = {
                ...create,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                id: (create as any).workspace_id, // Hack to ensure ID exists for update later
                created_at: new Date(),
                updated_at: new Date(),
              } as unknown as { execution_id: string; ticket_id: string };
              workspaces.push(record);
              return record;
            }
          },
        ),
        delete: jest.fn(async ({ where }: { where: { execution_id: string } }) => {
          const idx = workspaces.findIndex((w) => w.execution_id === where.execution_id);
          if (idx < 0) throw new Error('Not found');
          const [deleted] = workspaces.splice(idx, 1);
          return deleted;
        }),
        deleteMany: jest.fn(async () => {
          const count = workspaces.length;
          workspaces.splice(0, workspaces.length);
          return { count };
        }),
      },
    };

    const mockStorageManagerService = {
      getDiskUsage: jest.fn().mockResolvedValue({
        availableBytes: 1000 * 1024 * 1024,
        usedBytes: 500 * 1024 * 1024,
        totalBytes: 1500 * 1024 * 1024,
      }),
      archiveWorkspace: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: GitOperationsService, useValue: mockGitService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageManagerService, useValue: mockStorageManagerService },
        {
          provide: GitHubTokenResolverService,
          useValue: { resolveForProject: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: GitMirrorService,
          useValue: {
            getOrCreateMirror: jest.fn(),
            cloneFromMirror: jest.fn(),
          },
        },
        { provide: 'PROM_METRIC_CURSOR_WORKSPACES_ACTIVE', useValue: mockActiveGauge },
        {
          provide: 'PROM_METRIC_CURSOR_WORKSPACE_OPERATIONS_TOTAL',
          useValue: mockOperationsCounter,
        },
        {
          provide: ExecutionTrackerService,
          useValue: {
            emitProgress: jest.fn().mockResolvedValue(undefined),
            emitActivity: jest.fn().mockResolvedValue(undefined),
            emitImmediateLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    gitService = module.get(GitOperationsService);
    mockGitMirrorService = module.get(GitMirrorService) as jest.Mocked<GitMirrorService>;

    // Initialize the service
    await service.onModuleInit();
  });

  afterEach(async () => {
    // Cleanup the service to stop the cleanup scheduler
    if (service) {
      await service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    beforeEach(() => {
      // Reset mocks before each test
      jest.clearAllMocks();
    });

    it('should create workspace successfully using mirror', async () => {
      // Mock mirror service success
      mockGitMirrorService.getOrCreateMirror.mockResolvedValue({
        owner: 'test',
        repo: 'repo',
        mirrorPath: '/tmp/mirrors/test/repo.git',
        sizeBytes: 1000000,
        lastUpdated: new Date(),
        lastUsed: new Date(),
        cloneCount: 0,
      });
      mockGitMirrorService.cloneFromMirror.mockResolvedValue(undefined);
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

      // Mirror service should be used instead of direct clone
      expect(mockGitMirrorService.getOrCreateMirror).toHaveBeenCalled();
      expect(mockGitMirrorService.cloneFromMirror).toHaveBeenCalled();
      expect(gitService.clone).not.toHaveBeenCalled();
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

    it('should fallback to direct clone when mirror fails', async () => {
      // Mock mirror service failure
      mockGitMirrorService.getOrCreateMirror.mockRejectedValue(new Error('Mirror unavailable'));
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      const workspace = await service.createWorkspace(
        'exec-123',
        '456',
        'https://github.com/test/repo.git',
        'main',
      );

      expect(workspace.status).toBe('READY');
      // Should fallback to direct clone
      expect(gitService.clone).toHaveBeenCalled();
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
      // Mirror fails, then direct clone fails
      mockGitMirrorService.getOrCreateMirror.mockRejectedValue(new Error('Mirror unavailable'));
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

    it('should handle re-creation of existing workspace (idempotency)', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      // First creation
      await service.createWorkspace(
        'exec-retry',
        'retry-ticket',
        'https://github.com/test/repo.git',
        'main',
      );

      // Retry creation (should update existing record and not fail)
      const workspace = await service.createWorkspace(
        'exec-retry',
        'retry-ticket',
        'https://github.com/test/repo.git',
        'main',
      );

      expect(workspace.executionId).toBe('exec-retry');
      expect(workspace.status).toBe('READY');
    });
  });

  describe('getWorkspace', () => {
    it('should return workspace by execution ID', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      const workspace = await service.getWorkspace('exec-123');

      expect(workspace).toBeDefined();
      expect(workspace?.executionId).toBe('exec-123');
    });

    it('should return undefined for non-existent workspace', async () => {
      const workspace = await service.getWorkspace('non-existent');
      expect(workspace).toBeUndefined();
    });
  });

  describe('updateWorkspaceStatus', () => {
    it('should update workspace status', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');

      await service.updateWorkspaceStatus('exec-123', 'EXECUTING');

      const workspace = await service.getWorkspace('exec-123');
      expect(workspace?.status).toBe('EXECUTING');
    });

    it('should do nothing for non-existent workspace', async () => {
      // Should not throw
      await service.updateWorkspaceStatus('non-existent', 'EXECUTING');
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

      // createWorkspace() performs a best-effort rm() before clone; isolate cleanup assertions.
      mockFs.rm.mockClear();

      await service.cleanupWorkspace('exec-123', true);

      expect(mockFs.rm).toHaveBeenCalled();
      const workspace = await service.getWorkspace('exec-123');
      // cleanupWorkspace marks the workspace as CLEANED (mapped to COMPLETED) but does not delete the DB record.
      expect(workspace?.status).toBe('COMPLETED');
    });

    it('should preserve failed workspace if configured', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      await service.createWorkspace('exec-123', '456', 'https://github.com/test/repo.git', 'main');
      await service.updateWorkspaceStatus('exec-123', 'FAILED');

      // createWorkspace() performs a best-effort rm() before clone; isolate cleanup assertions.
      mockFs.rm.mockClear();

      await service.cleanupWorkspace('exec-123', false);

      // Should NOT be deleted (preserveFailedWorkspaces = true)
      expect(mockFs.rm).not.toHaveBeenCalled();
      const workspace = await service.getWorkspace('exec-123');
      expect(workspace).toBeDefined();
      expect(workspace?.status).toBe('FAILED');
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

      const workspaces = await service.getActiveWorkspaces();

      expect(workspaces).toHaveLength(2);
    });
  });

  describe('getActiveCount', () => {
    it('should return count of active workspaces', async () => {
      gitService.clone.mockResolvedValue();
      gitService.configureUser.mockResolvedValue();
      gitService.checkoutBranch.mockResolvedValue();

      expect(await service.getActiveCount()).toBe(0);

      await service.createWorkspace(
        'exec-1',
        'ticket-1',
        'https://github.com/test/repo.git',
        'main',
      );

      expect(await service.getActiveCount()).toBe(1);
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
      expect(result.usedMB).toBe(500);
    });
  });
});
