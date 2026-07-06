import { DependencyEdgeType } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { TicketDependencyRepository } from './ticket-dependency.repository';

describe('TicketDependencyRepository', () => {
  let prisma: {
    $transaction: jest.Mock;
    ticketDependency: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let repository: TicketDependencyRepository;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockResolvedValue([]),
      ticketDependency: {
        findMany: jest.fn(),
        upsert: jest.fn((args) => args),
        deleteMany: jest.fn((args) => args),
      },
    };
    repository = new TicketDependencyRepository(prisma as unknown as PrismaService);
  });

  it('queries blockers as waiting_on edges for the ticket', async () => {
    await repository.getBlockers('task-a');

    expect(prisma.ticketDependency.findMany).toHaveBeenCalledWith({
      where: { ticket_id: 'task-a', type: DependencyEdgeType.waiting_on },
      orderBy: { created_at: 'asc' },
    });
  });

  it('reconciles current edges and deletes stale rows for the same source only', async () => {
    await repository.reconcile(
      'task-a',
      [
        { dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on },
        { dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on },
        { dependsOnExternalId: 'task-a', type: DependencyEdgeType.waiting_on },
      ],
      'clickup',
    );

    expect(prisma.ticketDependency.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.ticketDependency.deleteMany).toHaveBeenCalledWith({
      where: {
        ticket_id: 'task-a',
        source: 'clickup',
        depends_on: { notIn: ['task-b'] },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.objectContaining({ create: expect.objectContaining({ depends_on: 'task-b' }) }),
      expect.objectContaining({ where: expect.objectContaining({ source: 'clickup' }) }),
    ]);
  });
});
