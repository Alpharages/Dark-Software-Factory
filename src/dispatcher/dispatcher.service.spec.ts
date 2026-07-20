import { ConfigService } from '@nestjs/config';
import { AIProvider, DependencyBlockBehavior, ExecutionStatus, PMProvider } from '@/prisma/client';
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
      id: 'project-1',
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
  let dependencyGate: { check: jest.Mock; markBlocked: jest.Mock };
  let metrics: { incrementErrors: jest.Mock };
  let concurrencyGate: { acquire: jest.Mock };
  const releaseSlot = jest.fn();
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
      resolveSkill: jest.fn().mockResolvedValue(OpenHarnessSkill.CLICKUP_CODE_REVIEW),
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
    dependencyGate = {
      check: jest.fn().mockResolvedValue({
        blocked: false,
        unresolved: [],
        behavior: DependencyBlockBehavior.auto_resume,
      }),
      markBlocked: jest.fn().mockResolvedValue(undefined),
    };
    // Slot always granted: the gate's own semantics are covered in
    // execution-concurrency.gate.spec.ts. releaseSlot is module-scoped, so it
    // must be cleared explicitly — this suite has no global clearAllMocks.
    releaseSlot.mockClear();
    concurrencyGate = { acquire: jest.fn().mockResolvedValue(releaseSlot) };
    service = new DispatcherService(
      prisma as never,
      statusSkillMap as never,
      runner as never,
      config as ConfigService,
      approvalGate as never,
      dependencyGate as never,
      concurrencyGate as never,
      metrics as never,
    );
  });

  it('holds a per-project concurrency slot for the duration of the run (§3.5)', async () => {
    let heldDuringRun = false;
    runner.runForTicket.mockImplementation(() => {
      // The slot must still be held while the run is in flight — releasing early
      // would let the next ticket start and blow past the configured limit.
      heldDuringRun =
        concurrencyGate.acquire.mock.calls.length === 1 && !releaseSlot.mock.calls.length;
      return Promise.resolve('exec-1');
    });

    await service.dispatch(event);

    expect(concurrencyGate.acquire).toHaveBeenCalledWith('project-1');
    expect(heldDuringRun).toBe(true);
    expect(releaseSlot).toHaveBeenCalledTimes(1);
  });

  it('releases the concurrency slot even when the run throws', async () => {
    runner.runForTicket.mockRejectedValueOnce(new Error('boom'));

    const result = await service.dispatch(event);

    expect(result.dispatched).toBe(false);
    expect(releaseSlot).toHaveBeenCalledTimes(1);
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
    expect(statusSkillMap.resolveSkill).toHaveBeenCalledWith('in review', 'project-1');
  });

  it('dispatches ready-for-QA mapped status to QA skill', async () => {
    statusSkillMap.resolveSkill.mockResolvedValue(OpenHarnessSkill.CLICKUP_QA);

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
    statusSkillMap.resolveSkill.mockResolvedValue(null);
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
    statusSkillMap.resolveSkill.mockResolvedValue(null);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'backlog',
    });

    expect(result).toEqual({ dispatched: false, reason: 'no-mapping' });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('no-ops loop-terminal statuses distinctly from unmapped statuses', async () => {
    statusSkillMap.resolveSkill.mockResolvedValue(null);
    statusSkillMap.isLoopTerminal.mockReturnValue(true);

    const result = await service.dispatch({
      ...event,
      originalProviderStatus: 'passed',
    });

    expect(result).toEqual({ dispatched: false, reason: 'loop-complete' });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('opens the approval gate for loop-terminal statuses with a completed execution', async () => {
    statusSkillMap.resolveSkill.mockResolvedValue(null);
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
    statusSkillMap.resolveSkill.mockResolvedValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);

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
    statusSkillMap.resolveSkill.mockResolvedValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);
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
    statusSkillMap.resolveSkill.mockResolvedValue(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);
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

  it('skips dispatch when dependency gate reports unresolved blockers', async () => {
    dependencyGate.check.mockResolvedValueOnce({
      blocked: true,
      unresolved: ['blocker-1'],
      behavior: DependencyBlockBehavior.auto_resume,
    });

    const result = await service.dispatch(event);

    expect(result).toEqual({
      dispatched: false,
      reason: 'blocked',
      unresolved: ['blocker-1'],
      skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    });
    expect(dependencyGate.markBlocked).toHaveBeenCalledWith('ticket-uuid-1', {
      blocked: true,
      unresolved: ['blocker-1'],
      behavior: DependencyBlockBehavior.auto_resume,
    });
    expect(runner.runForTicket).not.toHaveBeenCalled();
  });

  it('returns error when dependency gate fails without throwing', async () => {
    dependencyGate.check.mockRejectedValueOnce(new Error('gate unavailable'));

    const result = await service.dispatch(event);

    expect(result).toEqual({
      dispatched: false,
      reason: 'error',
      error: 'gate unavailable',
      skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    });
    expect(metrics.incrementErrors).toHaveBeenCalledWith('dispatcher_dependency_gate_failed');
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

  it('never rethrows when opening the approval gate fails (fire-and-forget)', async () => {
    statusSkillMap.resolveSkill.mockResolvedValue(null);
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

    it('skips re-dispatch when dependency gate reports unresolved blockers', async () => {
      dependencyGate.check.mockResolvedValueOnce({
        blocked: true,
        unresolved: ['blocker-1'],
        behavior: DependencyBlockBehavior.hold,
      });

      const result = await service.redispatchImplement('ticket-uuid-1', 'corr-1');

      expect(result).toEqual({
        dispatched: false,
        reason: 'blocked',
        unresolved: ['blocker-1'],
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      });
      expect(runner.runForTicket).not.toHaveBeenCalled();
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

  describe('idempotency — concurrent duplicate events', () => {
    it('skips a second concurrent dispatch for the same task while one is in flight', async () => {
      // Hold the first run open so the two dispatches genuinely overlap. The DB
      // active-execution check cannot catch this race (no row exists yet); the
      // in-process per-ticket lock must.
      let releaseRun: (id: string) => void = () => {};
      runner.runForTicket.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            releaseRun = resolve;
          }),
      );

      const first = service.dispatch(event);
      // Let `first` acquire the per-ticket lock and reach the (held) runner call.
      await new Promise((r) => setImmediate(r));

      const second = await service.dispatch(event); // skipped while first is in flight

      expect(second).toEqual({ dispatched: false, reason: 'active-execution' });
      expect(runner.runForTicket).toHaveBeenCalledTimes(1);

      releaseRun('exec-1');
      await expect(first).resolves.toEqual({
        dispatched: true,
        executionId: 'exec-1',
        skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
      });
    });

    it('releases the in-flight lock so a later dispatch for the same task proceeds', async () => {
      await service.dispatch(event);
      const again = await service.dispatch(event);

      expect(again).toMatchObject({ dispatched: true });
      expect(runner.runForTicket).toHaveBeenCalledTimes(2);
    });
  });
});
