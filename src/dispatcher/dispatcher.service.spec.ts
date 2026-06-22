import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus, PMProvider } from '@/prisma/client';
import { OpenHarnessSkill, openHarnessSkillPrompt } from '@/openharness/skills.enum';
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
    execution: { findFirst: jest.Mock; count: jest.Mock };
  };
  let statusSkillMap: {
    resolveSkill: jest.Mock;
    isLoopTerminal: jest.Mock;
    loopMaxIterations: number;
  };
  let runner: { runForTicket: jest.Mock };
  let config: Pick<ConfigService, 'get'>;
  let approvalGate: { openGate: jest.Mock };
  let metrics: { incrementErrors: jest.Mock };
  let service: DispatcherService;

  beforeEach(() => {
    prisma = {
      ticket: { findUnique: jest.fn().mockResolvedValue(makeTicket()) },
      execution: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    statusSkillMap = {
      resolveSkill: jest.fn().mockReturnValue(OpenHarnessSkill.CLICKUP_CODE_REVIEW),
      isLoopTerminal: jest.fn().mockReturnValue(false),
      loopMaxIterations: 5,
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
    metrics = { incrementErrors: jest.fn() };
    approvalGate = { openGate: jest.fn().mockResolvedValue({}) };
    service = new DispatcherService(
      prisma as never,
      statusSkillMap as never,
      runner as never,
      config as ConfigService,
      approvalGate as never,
      metrics as never,
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
    expect(prisma.execution.count).not.toHaveBeenCalled();
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

  it('no-ops loop-terminal statuses distinctly from unmapped statuses', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(null);
    statusSkillMap.isLoopTerminal.mockReturnValue(true);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'passed',
    });

    expect(result).toEqual({ dispatched: false, reason: 'loop-complete' });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('opens the approval gate for loop-terminal statuses with a completed execution', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(null);
    statusSkillMap.isLoopTerminal.mockReturnValue(true);
    prisma.execution.findFirst.mockResolvedValueOnce({ id: 'exec-done' });

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'passed',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'awaiting-approval',
      executionId: 'exec-done',
    });
    expect(approvalGate.openGate).toHaveBeenCalledWith('exec-done', 'corr-1');
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('dispatches failed QA back to implement', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'failed',
    });

    expect(result).toEqual({
      dispatched: true,
      executionId: 'exec-1',
      skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    });
    expect(prisma.execution.count).toHaveBeenCalledWith({
      where: {
        ticket_id: 'ticket-uuid-1',
        ai_provider: AIProvider.OPENHARNESS,
        prompt: openHarnessSkillPrompt(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT),
      },
    });
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

  it('allows re-dispatch after prior execution is terminal', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);
    prisma.execution.findFirst.mockResolvedValueOnce(null);
    prisma.execution.count.mockResolvedValueOnce(1);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'changes_requested',
    });

    expect(result.dispatched).toBe(true);
    expect(runner.runForTicket).toHaveBeenCalledTimes(1);
  });

  it('suppresses implement loopback when loop cap is reached', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);
    prisma.execution.count.mockResolvedValueOnce(5);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'changes_requested',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'loop-cap-exceeded',
      skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    });
    expect(runner.runForTicket).not.toHaveBeenCalled();
    // AC7: the cap trip is recorded as a durable, non-fatal signal.
    expect(metrics.incrementErrors).toHaveBeenCalledWith('dispatcher_loop_cap_exceeded');
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

  it('never rethrows when opening the approval gate fails (fire-and-forget)', async () => {
    statusSkillMap.resolveSkill.mockReturnValue(null);
    statusSkillMap.isLoopTerminal.mockReturnValue(true);
    prisma.execution.findFirst.mockResolvedValueOnce({ id: 'exec-done' });
    approvalGate.openGate.mockRejectedValueOnce(new Error('gate boom'));

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'passed',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'error',
      error: 'gate boom',
      executionId: 'exec-done',
    });
    expect(metrics.incrementErrors).toHaveBeenCalledWith('dispatcher_open_gate_failed');
  });

  describe('redispatchImplement', () => {
    it('re-dispatches implement through the guarded path', async () => {
      const result = await service.redispatchImplement('ticket-uuid-1', 'corr-1');

      expect(result).toEqual({
        dispatched: true,
        executionId: 'exec-1',
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      });
      expect(runner.runForTicket).toHaveBeenCalledWith('ticket-uuid-1', {
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
        workspaceDir: '/workspaces/dsf',
      });
    });

    it('skips re-dispatch when an active execution exists', async () => {
      prisma.execution.findFirst.mockResolvedValueOnce({ id: 'exec-active' });

      const result = await service.redispatchImplement('ticket-uuid-1', 'corr-1');

      expect(result).toEqual({
        dispatched: false,
        reason: 'active-execution',
        executionId: 'exec-active',
      });
      expect(runner.runForTicket).not.toHaveBeenCalled();
    });

    it('honours the loop cap on re-dispatch', async () => {
      prisma.execution.count.mockResolvedValueOnce(5);

      const result = await service.redispatchImplement('ticket-uuid-1', 'corr-1');

      expect(result).toEqual({
        dispatched: false,
        reason: 'loop-cap-exceeded',
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      });
      expect(runner.runForTicket).not.toHaveBeenCalled();
      expect(metrics.incrementErrors).toHaveBeenCalledWith('dispatcher_loop_cap_exceeded');
    });

    it('returns a failed result when the runner throws', async () => {
      runner.runForTicket.mockRejectedValueOnce(new Error('oh down'));

      const result = await service.redispatchImplement('ticket-uuid-1', 'corr-1');

      expect(result).toEqual({
        dispatched: false,
        reason: 'error',
        error: 'oh down',
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      });
    });
  });
});
