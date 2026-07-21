import { Test } from '@nestjs/testing';
import { EventBusService } from '@/common/event-bus.service';
import { PrismaService } from '@/database/prisma.service';
import { DispatcherService } from '@/dispatcher/dispatcher.service';
import { PmInputResumeService } from './pm-input-resume.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';

/**
 * Guards the resume gate: a run must resume only when a human replies AFTER
 * DSF's own question comment, and must never resume a manual pause.
 */
describe('PmInputResumeService', () => {
  const D = (iso: string) => new Date(iso);
  let service: PmInputResumeService;
  let provider: { getSelf: jest.Mock; getComments: jest.Mock; addComment: jest.Mock };
  let prisma: any;
  let dispatcher: { redispatchImplement: jest.Mock };

  beforeEach(async () => {
    provider = {
      getSelf: jest.fn().mockResolvedValue({ id: 'bot-1', name: 'Bot', email: 'b@x.com' }),
      getComments: jest.fn(),
      addComment: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      execution: { findMany: jest.fn(), update: jest.fn().mockResolvedValue(true) },
      ticket: { findUnique: jest.fn() },
    };
    dispatcher = { redispatchImplement: jest.fn().mockResolvedValue({ dispatched: true }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PmInputResumeService,
        { provide: EventBusService, useValue: { on: jest.fn(), emit: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: DispatcherService, useValue: dispatcher },
        {
          provide: ProjectIntegrationService,
          useValue: { findFirstByProject: jest.fn().mockResolvedValue({ id: 'int-1' }) },
        },
        {
          provide: PMProviderFactory,
          useValue: { getProvider: jest.fn().mockResolvedValue(provider) },
        },
      ],
    }).compile();

    service = moduleRef.get(PmInputResumeService);

    prisma.execution.findMany.mockResolvedValue([{ id: 'exec-1', ticket_id: 'tk-1' }]);
    prisma.ticket.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(
        'clickup_task_id' in select ? { clickup_task_id: 'CU-1' } : { project_id: 'proj-1' },
      ),
    );
  });

  it('resumes when a human replies after the bot question', async () => {
    provider.getComments.mockResolvedValue([
      { id: 'c2', authorId: 'human-9', createdAt: D('2026-01-01T10:05:00Z') },
      { id: 'c1', authorId: 'bot-1', createdAt: D('2026-01-01T10:00:00Z') },
    ]);

    await service.pollAwaitingInput();

    expect(dispatcher.redispatchImplement).toHaveBeenCalledWith('tk-1', 'resume-exec-1');
    // Marker cleared so the next tick can't double-resume.
    expect(prisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { error_context: null },
    });
  });

  it('does NOT resume when the only reply predates the bot question', async () => {
    provider.getComments.mockResolvedValue([
      { id: 'c2', authorId: 'bot-1', createdAt: D('2026-01-01T10:05:00Z') },
      { id: 'c1', authorId: 'human-9', createdAt: D('2026-01-01T10:00:00Z') },
    ]);

    await service.pollAwaitingInput();

    expect(dispatcher.redispatchImplement).not.toHaveBeenCalled();
  });

  it('does NOT resume when only the bot has commented', async () => {
    provider.getComments.mockResolvedValue([
      { id: 'c1', authorId: 'bot-1', createdAt: D('2026-01-01T10:00:00Z') },
    ]);

    await service.pollAwaitingInput();

    expect(dispatcher.redispatchImplement).not.toHaveBeenCalled();
  });
});
