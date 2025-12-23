import { Test, TestingModule } from '@nestjs/testing';
import { FileLockManagerService } from './file-lock-manager.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FilePredictionProvider } from './file-prediction.provider';

describe('FileLockManagerService (acquireLocks)', () => {
  let service: FileLockManagerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      fileLockQueue: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      fileLock: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => {
        const tx = {
          fileLockQueue: {
            findMany: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          fileLock: {
            findMany: jest.fn(),
            createMany: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FileLockManagerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AIDecisionLoggerService, useValue: { logDecision: jest.fn() } },
        { provide: MetricsService, useValue: { incrementCounter: jest.fn() } },
        { provide: FilePredictionProvider, useValue: { predict: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(FileLockManagerService);
  });

  it('returns acquired=false when not head-of-queue for any required file', async () => {
    // tx.fileLockQueue.findMany returns someone else first in queue for src/a.ts
    prisma.$transaction = jest.fn(async (fn: any) => {
      const tx = {
        fileLockQueue: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'q1', file_path: 'src/a.ts', ticket_id: 'other', execution_id: 'exec-other', requested_at: new Date() },
            { id: 'q2', file_path: 'src/a.ts', ticket_id: 'ticket-123', execution_id: 'exec-123', requested_at: new Date() },
            { id: 'q3', file_path: 'src/b.ts', ticket_id: 'ticket-123', execution_id: 'exec-123', requested_at: new Date() },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        fileLock: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn(),
        },
      };
      return fn(tx);
    });

    const res = await service.acquireLocks({
      ticketId: 'ticket-123',
      executionId: 'exec-123',
      filePaths: ['src/b.ts', 'src/a.ts'],
    });

    expect(res.acquired).toBe(false);
  });

  it('returns acquired=true and creates locks when head-of-queue for all required files', async () => {
    prisma.$transaction = jest.fn(async (fn: any) => {
      const tx = {
        fileLockQueue: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'q1', file_path: 'src/a.ts', ticket_id: 'ticket-123', execution_id: 'exec-123', requested_at: new Date() },
            { id: 'q2', file_path: 'src/b.ts', ticket_id: 'ticket-123', execution_id: 'exec-123', requested_at: new Date() },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        fileLock: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };
      return fn(tx);
    });

    const res = await service.acquireLocks({
      ticketId: 'ticket-123',
      executionId: 'exec-123',
      filePaths: ['src/b.ts', 'src/a.ts'],
    });

    expect(res.acquired).toBe(true);
  });
});


