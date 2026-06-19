import { ExecutionRepository } from '@/execution/execution.repository';
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

  beforeEach(() => {
    jest.useFakeTimers();
    realtimeService = {
      emitToProject: jest.fn(),
      emitToRole: jest.fn(),
    };
    executionRepository = {
      findById: jest.fn().mockResolvedValue({ ticket: { project_id: 'project-1' } }),
    };

    adapter = new OpenHarnessStreamAdapter(
      realtimeService as unknown as RealtimeService,
      executionRepository as unknown as ExecutionRepository,
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

  it('flushes buffered deltas before emitting assistant_complete', async () => {
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

    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.log',
      expect.objectContaining({ message: 'Final text' }),
    );
    expect(realtimeService.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.completed',
      expect.objectContaining({
        executionId: 'exec-1',
        ticketId: 'ticket-1',
        provider: 'OPENHARNESS',
        status: 'COMPLETED',
        projectId: 'project-1',
        payload: {
          filesChanged: ['src/a.ts'],
          durationSeconds: 3,
        },
      }),
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
});
