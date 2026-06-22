import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, PMProvider } from '@/prisma/client';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { ITaskEvent, TaskProviderType, TaskTriggerSource } from '@/ticket-intake/dto';
import { DispatcherService } from './dispatcher.service';

describe('DispatcherService', () => {
  const event: ITaskEvent = {
    externalId: 'task-1',
    providerType: TaskProviderType.CLICKUP,
    internalStatus: 'QUEUED',
    title: 'Task',
    description: 'Body',
    triggerSource: TaskTriggerSource.WEBHOOK,
    correlationId: 'corr-1',
    projectIdentifier: 'list-1',
    taskUrl: 'https://app.clickup.com/t/task-1',
    originalProviderStatus: 'in review',
  };

  const makeTicket = (aiTriggerStatus = 'ready for ai') => ({
    id: 'ticket-uuid-1',
    project: {
      integrations: [{ provider: PMProvider.CLICKUP, ai_trigger_status: aiTriggerStatus }],
    },
  });

  let prisma: {
    ticket: { findUnique: jest.Mock };
    execution: { findFirst: jest.Mock };
  };
  let statusSkillMap: { resolveSkill: jest.Mock };
  let runner: { runForTicket: jest.Mock };
  let config: Pick<ConfigService, 'get'>;
  let service: DispatcherService;

  beforeEach(() => {
    prisma = {
      ticket: { findUnique: jest.fn().mockResolvedValue(makeTicket()) },
      execution: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    statusSkillMap = {
      resolveSkill: jest.fn().mockReturnValue(OpenHarnessSkill.CLICKUP_CODE_REVIEW),
    };
    runner = { runForTicket: jest.fn().mockResolvedValue('exec-1') };
    config = {
      get: jest.fn((key: string) =>
        key === 'openharness.workspaceDir'
          ? '/workspaces/dsf'
          : key === 'openharness.defaultSkill'
            ? OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT
            : undefined,
      ),
    };
    service = new DispatcherService(
      prisma as never,
      statusSkillMap as never,
      runner as never,
      config as ConfigService,
    );
  });

  it('dispatches mapped status to the mapped skill', async () => {
    const result = await service.dispatch(event);

    expect(result).toEqual({
      dispatched: true,
      executionId: 'exec-1',
      skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    });
    expect(runner.runForTicket).toHaveBeenCalledWith('ticket-uuid-1', {
      skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
      workspaceDir: '/workspaces/dsf',
    });
  });

  it('dispatches ready-for-QA mapped status to QA skill', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(OpenHarnessSkill.CLICKUP_QA);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'ready for qa',
    });

    expect(result).toEqual({
      dispatched: true,
      executionId: 'exec-1',
      skill: OpenHarnessSkill.CLICKUP_QA,
    });
    expect(runner.runForTicket).toHaveBeenCalledWith('ticket-uuid-1', {
      skill: OpenHarnessSkill.CLICKUP_QA,
      workspaceDir: '/workspaces/dsf',
    });
  });

  it('dispatches the per-project trigger status to the configured default skill', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(null);
    prisma.ticket.findUnique.mockResolvedValueOnce(makeTicket('Ready For AI'));

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: ' ready  for ai ',
    });

    expect(result.dispatched).toBe(true);
    expect(runner.runForTicket).toHaveBeenCalledWith('ticket-uuid-1', {
      skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      workspaceDir: '/workspaces/dsf',
    });
  });

  it('no-ops unmapped non-trigger status', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(null);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'backlog',
    });

    expect(result).toEqual({ dispatched: false, reason: 'no-mapping' });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('skips when an active execution already exists', async () => {
    prisma.execution.findFirst.mockResolvedValueOnce({
      id: 'exec-active',
      ticket_id: 'ticket-uuid-1',
      status: ExecutionStatus.IN_PROGRESS,
    });

    const result = await service.dispatch(event);

    expect(result).toEqual({
      dispatched: false,
      reason: 'active-execution',
      executionId: 'exec-active',
    });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('returns failed result when runner throws', async () => {
    runner.runForTicket.mockRejectedValueOnce(new Error('oh missing'));

    const result = await service.dispatch(event);

    expect(result).toEqual({
      dispatched: false,
      reason: 'error',
      error: 'oh missing',
      skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    });
  });
});
