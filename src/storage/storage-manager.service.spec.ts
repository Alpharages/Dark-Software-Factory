/**
 * Storage Manager Service Unit Tests
 * Story 14.3: Storage Manager Service
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageManagerService } from './storage-manager.service';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import * as fs from 'fs/promises';

// Mock fs module
jest.mock('fs/promises');

describe('StorageManagerService', () => {
  let service: StorageManagerService;
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
          useValue: {},
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
    it('should throw decommissioned error', async () => {
      await expect(service.archiveWorkspace('exec-123')).rejects.toThrow(
        'archiveWorkspace is decommissioned — Workspace table dropped in WR-1.1',
      );
    });
  });

  describe('performCleanup', () => {
    it('should throw decommissioned error', async () => {
      await expect(service.performCleanup()).rejects.toThrow(
        'performCleanup is decommissioned — Workspace table dropped in WR-1.1',
      );
    });
  });
});
