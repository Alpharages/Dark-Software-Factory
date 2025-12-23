import { Test, TestingModule } from '@nestjs/testing';
import { FileLockManagerService } from './file-lock-manager.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FilePredictionProvider } from './file-prediction.provider';

type FileLockRow = {
  id: string;
  ticket_id: string;
  execution_id: string;
  file_path: string;
  locked_at: Date;
  released_at?: Date | null;
  status: 'LOCKED' | 'RELEASED';
};

type QueueRow = {
  id: string;
  ticket_id: string;
  execution_id: string;
  file_path: string;
  requested_at: Date;
  acquired_at?: Date | null;
  status: 'WAITING' | 'ACQUIRED' | 'CANCELLED';
};

class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.current;
    let release!: () => void;
    this.current = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

class FakePrisma {
  private lockId = 0;
  private queueId = 0;
  private readonly mutex = new Mutex();

  public fileLocks: FileLockRow[] = [];
  public queue: QueueRow[] = [];

  fileLockQueue = {
    createMany: async (args: any) => {
      const data: any[] = args.data ?? [];
      const skipDuplicates: boolean = !!args.skipDuplicates;

      let inserted = 0;
      for (const row of data) {
        const exists = this.queue.some(
          (q) =>
            q.ticket_id === row.ticket_id &&
            q.execution_id === row.execution_id &&
            q.file_path === row.file_path,
        );
        if (exists) {
          if (!skipDuplicates) {
            throw new Error('Unique constraint violation on file_lock_queue');
          }
          continue;
        }

        this.queue.push({
          id: `q-${++this.queueId}`,
          ticket_id: row.ticket_id,
          execution_id: row.execution_id,
          file_path: row.file_path,
          requested_at: row.requested_at ?? new Date(),
          acquired_at: null,
          status: row.status ?? 'WAITING',
        });
        inserted++;
      }

      return { count: inserted };
    },

    findMany: async (args: any) => {
      const where = args.where ?? {};
      const orderBy = args.orderBy ?? [];
      let rows = [...this.queue];

      if (where.status) {
        rows = rows.filter((r) => r.status === where.status);
      }
      if (where.file_path?.in) {
        const set = new Set(where.file_path.in);
        rows = rows.filter((r) => set.has(r.file_path));
      }
      if (typeof where.file_path === 'string') {
        rows = rows.filter((r) => r.file_path === where.file_path);
      }
      if (where.ticket_id) rows = rows.filter((r) => r.ticket_id === where.ticket_id);
      if (where.execution_id) rows = rows.filter((r) => r.execution_id === where.execution_id);

      // Support the ordering patterns used by FileLockManagerService
      const normalizeOrder = (o: any) => Object.entries(o)[0] as [string, 'asc' | 'desc'];
      for (const o of orderBy.slice().reverse()) {
        const [field, dir] = normalizeOrder(o);
        rows.sort((a, b) => {
          const av: any = (a as any)[field];
          const bv: any = (b as any)[field];
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          return dir === 'asc' ? cmp : -cmp;
        });
      }

      return rows;
    },

    updateMany: async (args: any) => {
      const where = args.where ?? {};
      const data = args.data ?? {};
      let updated = 0;

      for (const row of this.queue) {
        if (where.status && row.status !== where.status) continue;
        if (where.ticket_id && row.ticket_id !== where.ticket_id) continue;
        if (where.execution_id && row.execution_id !== where.execution_id) continue;
        if (where.file_path?.in) {
          const set = new Set(where.file_path.in);
          if (!set.has(row.file_path)) continue;
        }

        Object.assign(row, data);
        updated++;
      }

      return { count: updated };
    },
  };

  fileLock = {
    findMany: async (args: any) => {
      const where = args.where ?? {};
      let rows = [...this.fileLocks];

      if (where.status) rows = rows.filter((r) => r.status === where.status);
      if (where.execution_id) rows = rows.filter((r) => r.execution_id === where.execution_id);
      if (where.ticket_id) rows = rows.filter((r) => r.ticket_id === where.ticket_id);
      if (where.file_path?.in) {
        const set = new Set(where.file_path.in);
        rows = rows.filter((r) => set.has(r.file_path));
      }

      return rows;
    },

    createMany: async (args: any) => {
      const data: any[] = args.data ?? [];

      // Enforce partial unique index: only one LOCKED row per file_path
      for (const row of data) {
        const conflict = this.fileLocks.some(
          (l) => l.file_path === row.file_path && l.status === 'LOCKED',
        );
        if (conflict) {
          throw new Error('Unique constraint violation on file_locks(file_path) WHERE status=LOCKED');
        }
      }

      for (const row of data) {
        this.fileLocks.push({
          id: `l-${++this.lockId}`,
          ticket_id: row.ticket_id,
          execution_id: row.execution_id,
          file_path: row.file_path,
          locked_at: new Date(),
          released_at: null,
          status: row.status ?? 'LOCKED',
        });
      }

      return { count: data.length };
    },

    updateMany: async (args: any) => {
      const where = args.where ?? {};
      const data = args.data ?? {};
      let updated = 0;

      for (const row of this.fileLocks) {
        if (where.status && row.status !== where.status) continue;
        if (where.execution_id && row.execution_id !== where.execution_id) continue;
        Object.assign(row, data);
        updated++;
      }

      return { count: updated };
    },
  };

  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const snapshot = {
        fileLocks: this.fileLocks.map((l) => ({ ...l })),
        queue: this.queue.map((q) => ({ ...q })),
      };

      const tx = {
        fileLock: this.fileLock,
        fileLockQueue: this.fileLockQueue,
      };

      try {
        return await fn(tx);
      } catch (e) {
        // rollback
        this.fileLocks = snapshot.fileLocks;
        this.queue = snapshot.queue;
        throw e;
      }
    });
  }
}

describe('FileLockManagerService (concurrency)', () => {
  let service: FileLockManagerService;
  let prisma: FakePrisma;

  beforeEach(async () => {
    prisma = new FakePrisma();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FileLockManagerService,
        { provide: PrismaService, useValue: prisma as unknown as PrismaService },
        { provide: AIDecisionLoggerService, useValue: { logDecision: jest.fn() } },
        { provide: MetricsService, useValue: { incrementCounter: jest.fn() } },
        { provide: FilePredictionProvider, useValue: { predict: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(FileLockManagerService);
  });

  it('only allows one ticket to hold a lock for a file at a time (AC#7)', async () => {
    const [a, b] = await Promise.all([
      service.acquireLocks({
        ticketId: 'ticket-a',
        executionId: 'exec-a',
        filePaths: ['src/a.ts'],
      }),
      service.acquireLocks({
        ticketId: 'ticket-b',
        executionId: 'exec-b',
        filePaths: ['src/a.ts'],
      }),
    ]);

    const acquiredCount = [a, b].filter((r) => r.acquired).length;
    expect(acquiredCount).toBe(1);

    const activeLocks = prisma.fileLocks.filter((l) => l.status === 'LOCKED' && l.file_path === 'src/a.ts');
    expect(activeLocks.length).toBe(1);
  });

  it('is atomic: if one file conflicts, none are acquired (AC#7)', async () => {
    const first = await service.acquireLocks({
      ticketId: 'ticket-a',
      executionId: 'exec-a',
      filePaths: ['src/a.ts'],
    });
    expect(first.acquired).toBe(true);

    const second = await service.acquireLocks({
      ticketId: 'ticket-b',
      executionId: 'exec-b',
      filePaths: ['src/a.ts', 'src/b.ts'],
    });
    expect(second.acquired).toBe(false);

    const bLocks = prisma.fileLocks.filter((l) => l.ticket_id === 'ticket-b' && l.status === 'LOCKED');
    expect(bLocks).toEqual([]);
  });

  it('honors FIFO ordering per file path (AC#7)', async () => {
    const r1 = await service.acquireLocks({
      ticketId: 'ticket-a',
      executionId: 'exec-a',
      filePaths: ['src/a.ts'],
    });
    const r2 = await service.acquireLocks({
      ticketId: 'ticket-b',
      executionId: 'exec-b',
      filePaths: ['src/a.ts'],
    });
    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(false);

    // Sanity: ensure the lock exists before release
    expect(
      prisma.fileLocks.some((l) => l.execution_id === 'exec-a' && l.file_path === 'src/a.ts' && l.status === 'LOCKED'),
    ).toBe(true);
    expect(
      prisma.queue.some(
        (q) =>
          q.ticket_id === 'ticket-b' &&
          q.execution_id === 'exec-b' &&
          q.file_path === 'src/a.ts' &&
          q.status === 'WAITING',
      ),
    ).toBe(true);

    // Sanity: confirm the service's prisma accessor would "see" the lock too
    const visibleLocks = await (prisma as any).fileLock.findMany({
      where: { execution_id: 'exec-a', status: 'LOCKED' },
    });
    expect(visibleLocks).toHaveLength(1);

    const acquireSpy = jest.spyOn(service, 'acquireLocks');

    // Release first, queue advance should grant to second
    await service.releaseLocksForExecution('exec-a');

    // Ensure release attempted to promote waiting tickets
    expect(acquireSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket-b', executionId: 'exec-b' }),
    );

    const activeLock = prisma.fileLocks.find((l) => l.file_path === 'src/a.ts' && l.status === 'LOCKED');
    expect(activeLock?.ticket_id).toBe('ticket-b');
  });
});


