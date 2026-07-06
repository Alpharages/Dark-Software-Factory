import { DependencyBlockBehavior, DependencyStatus, TicketStatus } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { DependencyManagerService } from '@/dependencies/dependency-manager.service';
import { TicketDependencyRepository } from '@/dependencies/ticket-dependency.repository';
import { DependencyGateService } from './dependency-gate.service';

describe('DependencyGateService', () => {
  let prisma: {
    ticket: { findUnique: jest.Mock; update: jest.Mock };
  };
  let dependencies: { getBlockers: jest.Mock };
  let dependencyManager: { isDependencyResolved: jest.Mock };
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
      isDependencyResolved: jest.fn().mockResolvedValue(false),
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
    prisma.ticket.findUnique.mockResolvedValueOnce({
      clickup_task_id: 'clickup-ticket-1',
      dependency_block_behavior: null,
      project: { dependency_block_behavior: DependencyBlockBehavior.auto_resume },
    });
    dependencyManager.isDependencyResolved.mockImplementation(
      async (depId: string) => depId === 'done-task',
    );

    await expect(service.check('ticket-1')).resolves.toEqual({
      blocked: true,
      unresolved: ['missing-task'],
      behavior: DependencyBlockBehavior.auto_resume,
    });

    // Blockers must be queried by the resolved external id, not the internal UUID.
    expect(dependencies.getBlockers).toHaveBeenCalledWith('clickup-ticket-1');
    // Resolution must delegate to the shared DependencyManagerService check (which has the
    // local-status-then-ClickUp-fallback logic), not re-implement a local-only lookup here.
    expect(dependencyManager.isDependencyResolved).toHaveBeenCalledWith('done-task');
    expect(dependencyManager.isDependencyResolved).toHaveBeenCalledWith('missing-task');
  });

  it('treats an already-RESOLVED edge as satisfied without a live status re-fetch (AC2 hot path)', async () => {
    dependencies.getBlockers.mockResolvedValueOnce([
      { depends_on: 'done-task', circular_detected: false, status: DependencyStatus.RESOLVED },
    ]);
    prisma.ticket.findUnique.mockResolvedValueOnce({
      clickup_task_id: 'clickup-ticket-1',
      dependency_block_behavior: null,
      project: { dependency_block_behavior: DependencyBlockBehavior.auto_resume },
    });

    await expect(service.check('ticket-1')).resolves.toEqual({
      blocked: false,
      unresolved: [],
      behavior: DependencyBlockBehavior.auto_resume,
    });
    expect(dependencyManager.isDependencyResolved).not.toHaveBeenCalled();
  });

  it('never blocks on a self-referential edge', async () => {
    dependencies.getBlockers.mockResolvedValueOnce([
      {
        depends_on: 'clickup-ticket-1',
        circular_detected: false,
        status: DependencyStatus.WAITING,
      },
    ]);
    prisma.ticket.findUnique.mockResolvedValueOnce({
      clickup_task_id: 'clickup-ticket-1',
      dependency_block_behavior: null,
      project: { dependency_block_behavior: DependencyBlockBehavior.auto_resume },
    });

    await expect(service.check('ticket-1')).resolves.toEqual({
      blocked: false,
      unresolved: [],
      behavior: DependencyBlockBehavior.auto_resume,
    });
    expect(dependencyManager.isDependencyResolved).not.toHaveBeenCalled();
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
