/**
 * Storage Manager Service Unit Tests
 * Story 14.3: Storage Manager Service
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageManagerService } from './storage-manager.service';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { ArchiveStatus } from '@/prisma/client';
import * as fs from 'fs/promises';

// Mock fs module
jest.mock('fs/promises');

describe('StorageManagerService', () => {
  let service: StorageManagerService;
  let prisma: jest.Mocked<PrismaService>;
  let metrics: jest.Mocked<MetricsService>;
  let config: jest.Mocked<ConfigService>;

  const mockWorkspacesRoot = '/tmp/test-workspaces';
  const mockArchivesRoot = `${mockWorkspacesRoot}/workspace-archives`;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageManagerService,
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              findUnique: jest.fn(),
            },
            workspaceArchive: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: MetricsService,
          useValue: {
            setGauge: jest.fn(),
            incrementCounter: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const configMap: Record<string, unknown> = {
                'cursor.workspacesRoot': mockWorkspacesRoot,
                'storage.diskThresholdPercent': 85,
                'storage.retentionDays': 30,
              };
              return configMap[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageManagerService>(StorageManagerService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    metrics = module.get(MetricsService) as jest.Mocked<MetricsService>;
    config = module.get(ConfigService) as jest.Mocked<ConfigService>;

    // Mock fs.mkdir
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should initialize storage manager with correct configuration', async () => {
      await service.onModuleInit();

      expect(fs.mkdir).toHaveBeenCalledWith(mockArchivesRoot, { recursive: true });
      expect(config.get).toHaveBeenCalledWith('cursor.workspacesRoot', '/tmp/cursor-workspaces');
      expect(config.get).toHaveBeenCalledWith('storage.diskThresholdPercent', 85);
      expect(config.get).toHaveBeenCalledWith('storage.retentionDays', 30);
    });
  });

  describe('getDiskUsage', () => {
    it('should return disk usage information and update metrics', async () => {
      // Mock fs.statfs
      const mockStats = {
        blocks: 1000000n,
        bsize: 4096n,
        bavail: 500000n,
        bfree: 500000n,
      };
      (fs.statfs as jest.Mock).mockResolvedValue(mockStats);

      await service.onModuleInit();
      const result = await service.getDiskUsage();

      // Verify calculations
      const expectedTotal = BigInt(1000000) * BigInt(4096);
      const expectedAvailable = BigInt(500000) * BigInt(4096);
      const expectedUsed = expectedTotal - expectedAvailable;

      expect(result.totalBytes).toBe(expectedTotal);
      expect(result.availableBytes).toBe(expectedAvailable);
      expect(result.usedBytes).toBe(expectedUsed);
      expect(result.usedPercentage).toBe(50); // 50% used

      // Verify Prometheus metrics were recorded
      expect(metrics.setGauge).toHaveBeenCalledWith(
        'storage_disk_usage_bytes',
        Number(expectedUsed),
        { type: 'used' },
      );
      expect(metrics.setGauge).toHaveBeenCalledWith(
        'storage_disk_usage_bytes',
        Number(expectedAvailable),
        { type: 'available' },
      );
      expect(metrics.setGauge).toHaveBeenCalledWith(
        'storage_disk_usage_bytes',
        Number(expectedTotal),
        { type: 'total' },
      );
    });
  });

  describe('archiveWorkspace', () => {
    it('should throw error if workspace not found', async () => {
      (prisma.workspace.findUnique as jest.Mock).mockResolvedValue(null);

      await service.onModuleInit();
      await expect(service.archiveWorkspace('exec-123')).rejects.toThrow(
        'Workspace not found for execution: exec-123',
      );
    });

    // Additional archive tests would require extensive mocking of archiver library
    // These are deferred to integration tests
  });

  describe('performCleanup', () => {
    it('should perform retention-based cleanup', async () => {
      // Mock disk usage (below threshold)
      const mockStats = {
        blocks: 1000000n,
        bsize: 4096n,
        bavail: 800000n, // 80% available = 20% used
        bfree: 800000n,
      };
      (fs.statfs as jest.Mock).mockResolvedValue(mockStats);

      // Mock old archives (older than 30 days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const oldDate = new Date(cutoffDate.getTime() - 24 * 60 * 60 * 1000); // 31 days ago

      (prisma.workspaceArchive.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'archive-1',
          execution_id: 'exec-1',
          workspace_path: '/path/to/workspace',
          archive_path: '/path/to/archive.zip',
          size_bytes: BigInt(1000000),
          compressed_size: BigInt(500000),
          status: ArchiveStatus.ARCHIVED,
          archived_at: oldDate,
          error_message: null,
        },
      ]);

      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      (prisma.workspaceArchive.delete as jest.Mock).mockResolvedValue({} as any);

      await service.onModuleInit();
      await service.performCleanup();

      // Verify old archive was deleted
      expect(fs.unlink).toHaveBeenCalledWith('/path/to/archive.zip');
      expect(prisma.workspaceArchive.delete).toHaveBeenCalledWith({
        where: { id: 'archive-1' },
      });

      // Verify metrics were recorded
      expect(metrics.incrementCounter).toHaveBeenCalledWith('storage_cleanup_operations_total');
    });

    it('should trigger emergency cleanup when disk usage exceeds threshold', async () => {
      // Mock disk usage (above 85% threshold)
      const mockStats = {
        blocks: 1000000n,
        bsize: 4096n,
        bavail: 100000n, // 10% available = 90% used
        bfree: 100000n,
      };
      (fs.statfs as jest.Mock).mockResolvedValue(mockStats);

      // Mock oldest archives for emergency cleanup
      const oldDate = new Date('2023-01-01');
      (prisma.workspaceArchive.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // Regular cleanup query (empty)
        .mockResolvedValueOnce([
          // Emergency cleanup query (oldest archives)
          {
            id: 'archive-emergency-1',
            execution_id: 'exec-emer-1',
            workspace_path: '/path/to/workspace',
            archive_path: '/path/to/old-archive.zip',
            size_bytes: BigInt(1000000),
            compressed_size: BigInt(500000),
            status: ArchiveStatus.ARCHIVED,
            archived_at: oldDate,
            error_message: null,
          },
        ]);

      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      (prisma.workspaceArchive.delete as jest.Mock).mockResolvedValue({} as any);

      await service.onModuleInit();
      await service.performCleanup();

      // Verify emergency cleanup was triggered
      expect(fs.unlink).toHaveBeenCalledWith('/path/to/old-archive.zip');
      expect(prisma.workspaceArchive.delete).toHaveBeenCalledWith({
        where: { id: 'archive-emergency-1' },
      });
    });
  });
});
