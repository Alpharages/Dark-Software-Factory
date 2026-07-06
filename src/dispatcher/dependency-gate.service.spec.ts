import { DependencyBlockBehavior, TicketStatus } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { DependencyManagerService } from '@/dependencies/dependency-manager.service';
import { TicketDependencyRepository } from '@/dependencies/ticket-dependency.repository';
import { DependencyGateService } from './dependency-gate.service';

describe('DependencyGateService', () => {
  let prisma: {
    ticket: { findUnique: jest.Mock; update: jest.Mock };
  };
  let dependencies: { getBlockers: jest.Mock };
  let dependencyManager: { isStatusResolved: jest.Mock };
  let service: DependencyGateService;

  beforeEach(() => {
    prisma = {
      ticket: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    dependencies = { getBlockers: jest.fn().mockResolvedValue([]) };
    dependencyManager = {
      isStatusResolved: jest.fn((status?: string) => status?.toLowerCase() === 'completed'),
    };
    service = new DependencyGateService(
      prisma as unknown as PrismaService,
      dependencies as unknown as TicketDependencyRepository,
      dependencyManager as unknown as DependencyManagerService,
    );
  });

  it('blocks when any blocker ticket is missing or unresolved', async () => {
    dependencies.getBlockers.mockResolvedValueOnce([
      { depends_on: 'done-task', circular_detected: false },
      { depends_on: 'missing-task', circular_detected: false },
    ]);
    prisma.ticket.findUnique
      // 1st call: resolve the gated ticket's external id + block behavior
      .mockResolvedValueOnce({
        clickup_task_id: 'clickup-ticket-1',
        dependency_block_behavior: null,
        project: { dependency_block_behavior: DependencyBlockBehavior.auto_resume },
      })
      // then per-blocker status lookups
      .mockResolvedValueOnce({ status: TicketStatus.COMPLETED })
      .mockResolvedValueOnce(null);

    await expect(service.check('ticket-1')).resolves.toEqual({
      blocked: true,
      unresolved: ['missing-task'],
      behavior: DependencyBlockBehavior.auto_resume,
    });

    // Blockers must be queried by the resolved external id, not the internal UUID.
    expect(dependencies.getBlockers).toHaveBeenCalledWith('clickup-ticket-1');
  });

  it('marks hold tickets as awaiting dependency release', async () => {
    await service.markBlocked('ticket-1', {
      blocked: true,
      unresolved: ['blocker'],
      behavior: DependencyBlockBehavior.hold,
    });

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: { status: TicketStatus.AWAITING_DEPENDENCY_RELEASE },
    });
  });
});
