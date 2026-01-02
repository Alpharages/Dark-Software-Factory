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

interface FakeQueueData {
  ticket_id: string;
  execution_id: string;
  file_path: string;
  requested_at?: Date;
  status?: 'WAITING' | 'ACQUIRED' | 'CANCELLED';
}

// Story: Improved types for Prisma mock to resolve lint errors
interface PrismaWhere {
  status?: string | { in: string[] };
  file_path?: string | { in: string[] };
  ticket_id?: string;
  execution_id?: string;
  locked_at?: { lt: Date };
}

interface PrismaData {
  status?: 'LOCKED' | 'RELEASED' | 'WAITING' | 'ACQUIRED' | 'CANCELLED';
  ticket_id?: string;
  execution_id?: string;
  file_path?: string;
}

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
    createMany: async (args: { data?: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
      const data = args.data ?? [];
      let inserted = 0;
      for (const rowObj of data) {
        const row = rowObj as unknown as FakeQueueData;
        const exists = this.queue.some(
          (q) =>
            q.ticket_id === row.ticket_id &&
            q.execution_id === row.execution_id &&
            q.file_path === row.file_path &&
            q.status === 'WAITING',
        );
        if (exists && !args.skipDuplicates) {
          throw new Error('Unique constraint violation on file_lock_queue');
        }
        if (!exists) {
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
      }
      return { count: inserted };
    },

    findMany: async (args: { where?: PrismaWhere; orderBy?: Record<string, 'asc' | 'desc'>[] }) => {
      const where = args.where ?? {};
      const orderBy = args.orderBy ?? [];
      let rows = [...this.queue];

      if (where.status) {
        const s = where.status;
        if (typeof s === 'string') {
          rows = rows.filter((r) => r.status === s);
        } else if (s.in) {
          rows = rows.filter((r) => s.in.includes(r.status));
        }
      }
      if (where.file_path) {
        if (typeof where.file_path === 'string') {
          rows = rows.filter((r) => r.file_path === where.file_path);
        } else if (where.file_path.in) {
          rows = rows.filter((r) => (where.file_path as { in: string[] }).in.includes(r.file_path));
        }
      }
      if (where.ticket_id) rows = rows.filter((r) => r.ticket_id === where.ticket_id);
      if (where.execution_id) rows = rows.filter((r) => r.execution_id === where.execution_id);

      const normalizeOrder = (o: object) => Object.entries(o)[0] as [string, 'asc' | 'desc'];
      for (const o of [...orderBy].reverse()) {
        const [field, dir] = normalizeOrder(o);
        rows.sort((a, b) => {
          const av = (a as Record<string, unknown>)[field];
          const bv = (b as Record<string, unknown>)[field];
          const factor = dir === 'asc' ? 1 : -1;
          if (av instanceof Date && bv instanceof Date) {
            return factor * (av.getTime() - bv.getTime());
          }
          if ((av as string | number) < (bv as string | number)) return -1 * factor;
          if ((av as string | number) > (bv as string | number)) return 1 * factor;
          return 0;
        });
      }
      return rows;
    },

    updateMany: async (args: { where: PrismaWhere; data: PrismaData }) => {
      const where = args.where ?? {};
      const data = args.data ?? {};
      let updated = 0;
      for (const row of this.queue) {
        let match = true;
        if (where.status) {
          const statusVal = where.status;
          if (typeof statusVal === 'string') {
            if (row.status !== statusVal) match = false;
          } else if (statusVal.in && !statusVal.in.includes(row.status)) {
            match = false;
          }
        }
        if (where.ticket_id && row.ticket_id !== where.ticket_id) match = false;
        if (where.execution_id && row.execution_id !== where.execution_id) match = false;
        if (where.file_path) {
          const pathVal = where.file_path;
          if (typeof pathVal === 'string') {
            if (row.file_path !== pathVal) match = false;
          } else if (pathVal.in && !pathVal.in.includes(row.file_path)) {
            match = false;
          }
        }
        if (match) {
          Object.assign(row, data);
          updated++;
        }
      }
      return { count: updated };
    },

    count: async (args: { where?: PrismaWhere }) => {
      return (await this.fileLockQueue.findMany(args)).length;
    },
  };

  fileLock = {
    findMany: async (args: { where?: PrismaWhere }) => {
      const where = args.where ?? {};
      let rows = [...this.fileLocks];
      if (where.status) {
        const s = where.status;
        if (typeof s === 'string') {
          rows = rows.filter((r) => r.status === s);
        } else if (s.in) {
          rows = rows.filter((r) => s.in.includes(r.status));
        }
      }
      if (where.execution_id) rows = rows.filter((r) => r.execution_id === where.execution_id);
      if (where.ticket_id) rows = rows.filter((r) => r.ticket_id === where.ticket_id);
      if (where.file_path) {
        if (typeof where.file_path === 'string') {
          rows = rows.filter((r) => r.file_path === where.file_path);
        } else if (where.file_path.in) {
          rows = rows.filter((r) => (where.file_path as { in: string[] }).in.includes(r.file_path));
        }
      }
      if (where.locked_at?.lt) {
        rows = rows.filter((r) => r.locked_at < where.locked_at!.lt);
      }
      return rows;
    },

    createMany: async (args: { data?: Record<string, unknown>[] }) => {
      const data = args.data ?? [];
      for (const row of data) {
        const existing = this.fileLocks.find(
          (l) => l.file_path === row.file_path && l.status === 'LOCKED',
        );
        if (existing) {
          throw new Error('Unique constraint violation');
        }
      }
      for (const rowObj of data) {
        const row = rowObj as unknown as FileLockRow;
        this.fileLocks.push({
          id: `l-${++this.lockId}`,
          ticket_id: row.ticket_id,
          execution_id: row.execution_id,
          file_path: row.file_path,
          locked_at: new Date(),
          status: row.status ?? 'LOCKED',
        });
      }
      return { count: data.length };
    },

    updateMany: async (args: { where: PrismaWhere; data: PrismaData }) => {
      const where = args.where ?? {};
      const data = args.data ?? {};
      let updated = 0;
      for (const row of this.fileLocks) {
        let match = true;
        if (where.status) {
          const statusVal = where.status;
          if (typeof statusVal === 'string') {
            if (row.status !== statusVal) match = false;
          } else if (statusVal.in && !statusVal.in.includes(row.status)) {
            match = false;
          }
        }
        if (where.execution_id && row.execution_id !== where.execution_id) match = false;
        if (where.ticket_id && row.ticket_id !== where.ticket_id) match = false;
        if (match) {
          Object.assign(row, data);
          updated++;
        }
      }
      return { count: updated };
    },

    count: async (args: { where?: PrismaWhere }) => {
      return (await this.fileLock.findMany(args)).length;
    },
  };

  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => {
    return this.mutex.runExclusive(async () => {
      const snapshot = {
        fileLocks: this.fileLocks.map((l) => ({ ...l })),
        queue: this.queue.map((q) => ({ ...q })),
      };
      try {
        return await fn(this);
      } catch (_e) {
        this.fileLocks = snapshot.fileLocks;
        this.queue = snapshot.queue;
        throw _e;
      }
    });
  };
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

    const activeLocks = prisma.fileLocks.filter(
      (l) => l.status === 'LOCKED' && l.file_path === 'src/a.ts',
    );
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

    const bLocks = prisma.fileLocks.filter(
      (l) => l.ticket_id === 'ticket-b' && l.status === 'LOCKED',
    );
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
      prisma.fileLocks.some(
        (l) => l.execution_id === 'exec-a' && l.file_path === 'src/a.ts' && l.status === 'LOCKED',
      ),
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
    const visibleLocks = await (prisma as unknown as PrismaService).fileLock.findMany({
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

    const activeLock = prisma.fileLocks.find(
      (l) => l.file_path === 'src/a.ts' && l.status === 'LOCKED',
    );
    expect(activeLock?.ticket_id).toBe('ticket-b');
  });
});
