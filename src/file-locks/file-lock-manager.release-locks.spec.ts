import { Test, TestingModule } from '@nestjs/testing';
import { FileLockManagerService } from './file-lock-manager.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FilePredictionProvider } from './file-prediction.provider';

describe('FileLockManagerService (releaseLocksForExecution)', () => {
  let service: FileLockManagerService;
  type MockPrisma = {
    fileLock: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    fileLockQueue: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = {
      fileLock: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      fileLockQueue: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as MockPrisma;

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

  it('does nothing when there are no active locks for the execution', async () => {
    prisma.fileLock.findMany.mockResolvedValueOnce([]);

    await expect(service.releaseLocksForExecution('exec-123')).resolves.not.toThrow();
    expect(prisma.fileLock.updateMany).not.toHaveBeenCalled();
  });

  it('releases locks and attempts to advance queue', async () => {
    prisma.fileLock.findMany.mockResolvedValueOnce([
      {
        file_path: 'src/a.ts',
        ticket_id: 'ticket-1',
        execution_id: 'exec-123',
        locked_at: new Date(),
      },
      {
        file_path: 'src/b.ts',
        ticket_id: 'ticket-1',
        execution_id: 'exec-123',
        locked_at: new Date(),
      },
    ]);

    // Heads of queue for affected files
    prisma.fileLockQueue.findMany.mockResolvedValue([
      {
        id: 'q1',
        file_path: 'src/a.ts',
        ticket_id: 'ticket-2',
        execution_id: 'exec-456',
        requested_at: new Date(),
      },
      {
        id: 'q2',
        file_path: 'src/b.ts',
        ticket_id: 'ticket-2',
        execution_id: 'exec-456',
        requested_at: new Date(),
      },
    ]);

    const acquireSpy = jest.spyOn(service, 'acquireLocks').mockResolvedValue({ acquired: true });

    await service.releaseLocksForExecution('exec-123');

    expect(prisma.fileLock.updateMany).toHaveBeenCalled();
    expect(acquireSpy).toHaveBeenCalled();
  });
});
