import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionActivityRepository } from '@/execution/repositories/execution-activity.repository';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { LogLevel } from '@/execution/gateways/execution.gateway';
import { RealtimeService } from '@/realtime/realtime.service';
import { OpenHarnessStreamAdapter } from './openharness-stream.adapter';

describe('OpenHarnessStreamAdapter', () => {
  let adapter: OpenHarnessStreamAdapter;
  let realtimeService: {
    emitToProject: jest.Mock;
    emitToRole: jest.Mock;
  };
  let executionRepository: {
    findById: jest.Mock;
  };
  let activityRepository: {
    save: jest.Mock;
  };
  let executionTracker: {
    emitProgress: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    realtimeService = {
      emitToProject: jest.fn(),
      emitToRole: jest.fn(),
    };
    executionRepository = {
      findById: jest.fn().mockResolvedValue({ ticket: { project_id: 'project-1' } }),
    };
    activityRepository = {
      save: jest.fn().mockResolvedValue({}),
    };
    executionTracker = {
      emitProgress: jest.fn().mockResolvedValue(undefined),
    };

    adapter = new OpenHarnessStreamAdapter(
      realtimeService as unknown as RealtimeService,
      executionRepository as unknown as ExecutionRepository,
      activityRepository as unknown as ExecutionActivityRepository,
      executionTracker as unknown as ExecutionTrackerService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('maps tool_started to execution-activity through the project room', async () => {
    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'tool_started',
      tool_name: 'bmad',
      input: { workflow: 'clickup-dev-implement' },
    });

    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution-activity',
      expect.objectContaining({
        executionId: 'exec-1',
        ticketId: 'ticket-1',
        activity: 'Tool started: bmad',
        category: 'AI_CODING',
        icon: 'tool',
        projectId: 'project-1',
        rawContent: expect.stringContaining('tool_started'),
      }),
    );
  });

  it('falls back to admin and manager role rooms for activity without a projectId', async () => {
    executionRepository.findById.mockResolvedValue({ ticket: { project_id: null } });

    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'tool_started',
      name: 'shell',
    });

    expect(realtimeService.emitToProject).not.toHaveBeenCalled();
    expect(realtimeService.emitToRole).toHaveBeenCalledWith(
      'ADMIN',
      'execution-activity',
      expect.objectContaining({ projectId: null }),
    );
    expect(realtimeService.emitToRole).toHaveBeenCalledWith(
      'MANAGER',
      'execution-activity',
      expect.objectContaining({ projectId: null }),
    );
  });

  it('coalesces assistant_delta events into one throttled execution.log emission', async () => {
    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_delta',
      delta: 'First',
    });
    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_delta',
      text: 'Second',
    });

    expect(realtimeService.emitToProject).not.toHaveBeenCalledWith(
      'project-1',
      'execution.log',
      expect.anything(),
    );

    await jest.advanceTimersByTimeAsync(100);

    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.log',
      expect.objectContaining({
        executionId: 'exec-1',
        ticketId: 'ticket-1',
        level: LogLevel.INFO,
        message: 'First\nSecond',
        source: 'stdout',
        projectId: 'project-1',
      }),
    );
  });

  it('flushes buffered deltas and emits the summary as a final log marker on assistant_complete', async () => {
    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_delta',
      delta: 'Final text',
    });

    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_complete',
      summary: 'done',
      files_changed: ['src/a.ts'],
      duration_seconds: 3,
    });

    // The buffered delta is flushed first...
    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.log',
      expect.objectContaining({ message: 'Final text' }),
    );
    // ...then the assistant's final message is emitted as a terminal log marker.
    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.log',
      expect.objectContaining({ message: 'done' }),
    );
  });

  it('never emits execution.completed — the runner owns the run-terminal event', async () => {
    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_complete',
      summary: 'done',
      files_changed: ['src/a.ts'],
      duration_seconds: 3,
    });

    expect(realtimeService.emitToProject).not.toHaveBeenCalledWith(
      'project-1',
      'execution.completed',
      expect.anything(),
    );
    expect(realtimeService.emitToRole).not.toHaveBeenCalledWith(
      'ADMIN',
      'execution.completed',
      expect.anything(),
    );
    expect(realtimeService.emitToRole).not.toHaveBeenCalledWith(
      'MANAGER',
      'execution.completed',
      expect.anything(),
    );
  });

  it('falls back to admin and developer role rooms for logs without a projectId', async () => {
    executionRepository.findById.mockResolvedValue(null);

    await adapter.handleEvent('exec-1', 'ticket-1', {
      type: 'assistant_delta',
      delta: 'Log text',
    });
    await jest.advanceTimersByTimeAsync(100);

    expect(realtimeService.emitToRole).toHaveBeenCalledWith(
      'ADMIN',
      'execution.log',
      expect.objectContaining({ projectId: null }),
    );
    expect(realtimeService.emitToRole).toHaveBeenCalledWith(
      'DEVELOPER',
      'execution.log',
      expect.objectContaining({ projectId: null }),
    );
  });

  it('logs and skips unknown events without throwing', async () => {
    const warnSpy = jest.spyOn(adapter['logger'], 'warn').mockImplementation();

    await expect(
      adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'something_else',
        payload: 'ignored',
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unknown OpenHarness stream event'),
    );
    expect(realtimeService.emitToProject).not.toHaveBeenCalled();
    expect(realtimeService.emitToRole).not.toHaveBeenCalled();
  });

  // ── Claude Code (`claude -p`) event vocabulary ──────────────────────────
  describe('Claude Code event mapping', () => {
    it('maps a Claude assistant tool_use block to an AI activity and persists it', async () => {
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/x.ts' } }],
        },
      });

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution-activity',
        expect.objectContaining({
          activity: 'Running Edit',
          detail: 'src/x.ts',
          category: 'FILE_OP',
        }),
      );
      // Persisted with the SAME timestamp emitted over the socket (reload dedupe).
      const emitted = realtimeService.emitToProject.mock.calls.find(
        (c) => c[1] === 'execution-activity',
      )?.[2];
      expect(activityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-1',
          activity: 'Running Edit',
          category: 'FILE_OP',
          timestamp: new Date(emitted.timestamp),
        }),
      );
    });

    it('maps a Claude assistant text block to an AI_THINKING activity', async () => {
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Planning the change' }] },
      });

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution-activity',
        expect.objectContaining({ activity: 'Planning the change', category: 'AI_THINKING' }),
      );
    });

    it('flags a Claude tool_result error as an ERROR activity', async () => {
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'boom' }],
        },
      });

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution-activity',
        expect.objectContaining({ activity: 'Tool error', category: 'ERROR', detail: 'boom' }),
      );
    });

    it('surfaces the Claude system init event as a SETUP activity', async () => {
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet',
      });

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution-activity',
        expect.objectContaining({
          activity: 'AI session started',
          category: 'SETUP',
          detail: 'Model: claude-sonnet',
        }),
      );
    });

    it('advances the progress bar (step + monotonic percent) off each activity', async () => {
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Step one' }] },
      });
      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Step two' }] },
      });

      const calls = executionTracker.emitProgress.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // (executionId, ticketId, projectId, currentStep, percentComplete)
      expect(calls[0][3]).toBe('Step one');
      expect(calls[1][3]).toBe('Step two');
      // Monotonic, never hits 100% mid-run.
      expect(calls[1][4]).toBeGreaterThan(calls[0][4]);
      expect(calls[1][4]).toBeLessThan(100);
    });

    it('keeps the live stream alive even if persistence fails', async () => {
      activityRepository.save.mockRejectedValueOnce(new Error('db down'));

      await adapter.handleEvent('exec-1', 'ticket-1', {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'still streaming' }] },
      });

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution-activity',
        expect.objectContaining({ activity: 'still streaming' }),
      );
    });
  });

  // EXEC-4: agent-internal identifiers annotated with model-only instructions
  // must never reach a user-facing activity.
  describe('redactInternal', () => {
    const redact = (v: unknown) => (adapter as any).redactInternal(v);

    it('strips an id token and its "do not mention to user" annotation', () => {
      expect(
        redact('Using agentId: 7f3a-99 (internal ID - do not mention to user) to proceed'),
      ).toBe('Using to proceed');
    });

    it('strips a standalone internal-id parenthetical', () => {
      expect(redact('Delegating work (internal ID, do not reveal)')).toBe('Delegating work');
    });

    it('leaves ordinary text untouched', () => {
      expect(redact('Running tests in server/ai (unit + integration)')).toBe(
        'Running tests in server/ai (unit + integration)',
      );
    });

    it('passes null/undefined through unchanged', () => {
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });
  });
});
