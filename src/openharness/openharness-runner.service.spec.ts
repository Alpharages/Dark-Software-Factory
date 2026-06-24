import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { PrismaService } from '@/database/prisma.service';
import { OpenHarnessRunnerService } from './openharness-runner.service';
import { OpenHarnessStreamAdapter } from './stream/openharness-stream.adapter';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as child_process from 'child_process';
import { AIProvider } from '@/prisma/client';
import { OpenHarnessRunGuardrailsService } from './run-guardrails.service';

jest.mock('child_process');

describe('OpenHarnessRunnerService', () => {
  let service: OpenHarnessRunnerService;
  let mockExecutionRepo: Record<string, jest.Mock>;
  let mockExecutionTracker: Record<string, jest.Mock>;
  let mockPrisma: any;
  let mockConfig: Record<string, jest.Mock>;
  let mockStreamAdapter: Record<string, jest.Mock>;
  let mockGuardrails: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockExecutionRepo = {
      create: jest.fn().mockResolvedValue({ id: 'exec-123' }),
      updateStatus: jest.fn().mockResolvedValue(true),
    };

    mockExecutionTracker = {
      markInProgress: jest.fn().mockResolvedValue(true),
      completeExecution: jest.fn().mockResolvedValue(true),
      failExecution: jest.fn().mockResolvedValue(true),
      timeoutExecution: jest.fn().mockResolvedValue(true),
    };

    mockPrisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({ clickup_task_id: '86test123' }),
      },
      execution: {
        update: jest.fn().mockResolvedValue(true),
      },
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key) => {
        const values: Record<string, unknown> = {
          'openharness.binaryPath': 'oh',
          'openharness.model': 'gpt-5.4',
          'openharness.maxTurns': 200,
          'openharness.runTimeoutMs': 1000 * 60 * 30,
          'openharness.mcpConfigPath': '/path/to/mcp.json',
          'openharness.mandatedMcpServers': ['gitnexus'],
          'openharness.mandatedToolsMode': 'warn',
          'openharness.formatEnabled': true,
          'openharness.formatCommand': 'pnpm exec prettier --write',
        };
        return values[key];
      }),
    };
    mockStreamAdapter = {
      handleEvent: jest.fn().mockResolvedValue(undefined),
    };
    mockGuardrails = {
      findMissingMandatedMcpServers: jest.fn().mockReturnValue([]),
      formatOwnFiles: jest.fn().mockResolvedValue({ formattedFiles: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenHarnessRunnerService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: ExecutionRepository, useValue: mockExecutionRepo },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OpenHarnessRunGuardrailsService, useValue: mockGuardrails },
        { provide: OpenHarnessStreamAdapter, useValue: mockStreamAdapter },
      ],
    }).compile();

    service = module.get<OpenHarnessRunnerService>(OpenHarnessRunnerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should run successfully and complete execution', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    // Simulate stdout
    mockChild.stdout.write(JSON.stringify({ type: 'progress', step: 'starting' }) + '\n');
    mockChild.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'COMPLETED',
        summary: 'done',
        files_changed: ['a.ts'],
      }) + '\n',
    );

    setTimeout(() => mockChild.emit('close', 0), 10);

    const execId = await runPromise;

    expect(execId).toBe('exec-123');
    expect(mockExecutionRepo.create).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      provider: AIProvider.OPENHARNESS,
      prompt: expect.any(String),
      maxRetries: 0,
    });
    expect(mockExecutionTracker.markInProgress).toHaveBeenCalledWith('exec-123', 'exec-123');
    expect(mockPrisma.execution.update).toHaveBeenCalled();
    expect(mockExecutionTracker.completeExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        codeOutput: 'done',
        filesChanged: ['a.ts'],
        confidenceScore: 1.0,
      },
      'exec-123',
    );
    expect(mockGuardrails.formatOwnFiles).toHaveBeenCalledWith(
      '/tmp',
      ['a.ts'],
      true,
      'pnpm exec prettier --write',
    );
    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.stringContaining('scripts/oh-run-skill.sh'),
      ['86test123', expect.stringContaining('exec-123.stream.json')],
      expect.objectContaining({
        env: expect.objectContaining({
          OH_RUN_WORKFLOW: 'test-skill',
          OH_RUN_STREAM_STDOUT: '1',
        }),
      }),
    );
  });

  it('fails before spawn when mandated MCP servers are missing in fail mode', async () => {
    mockGuardrails.findMissingMandatedMcpServers.mockReturnValue(['gitnexus']);
    mockConfig.get.mockImplementation((key) => {
      const values: Record<string, unknown> = {
        'openharness.binaryPath': 'oh',
        'openharness.model': 'gpt-5.4',
        'openharness.maxTurns': 200,
        'openharness.runTimeoutMs': 1000 * 60 * 30,
        'openharness.mcpConfigPath': '/path/to/mcp.json',
        'openharness.mandatedMcpServers': ['gitnexus'],
        'openharness.mandatedToolsMode': 'fail',
        'openharness.formatEnabled': true,
        'openharness.formatCommand': 'pnpm exec prettier --write',
      };
      return values[key];
    });

    const execId = await service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    expect(execId).toBe('exec-123');
    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-123' },
      data: {
        error_context: JSON.stringify({
          guardrails: { missingMandatedTools: ['gitnexus'], mandatedToolsMode: 'fail' },
        }),
      },
    });
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'Missing mandated MCP servers: gitnexus',
        isRetryable: false,
      },
      'exec-123',
    );
  });

  it('fails the run when post-run formatting fails', async () => {
    mockGuardrails.formatOwnFiles.mockRejectedValue(new Error('Formatter exited with code 1'));
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    mockChild.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'COMPLETED',
        summary: 'done',
        files_changed: ['a.ts'],
      }) + '\n',
    );
    setTimeout(() => mockChild.emit('close', 0), 10);

    await runPromise;

    expect(mockExecutionTracker.completeExecution).not.toHaveBeenCalled();
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'OpenHarness guardrail formatter failed: Formatter exited with code 1',
        isRetryable: false,
      },
      'exec-123',
    );
  });

  it('forwards live OpenHarness stream events to the realtime adapter', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    mockChild.stdout.write(
      JSON.stringify({ type: 'tool_started', tool_name: 'bmad', input: {} }) + '\n',
    );
    mockChild.stdout.write(
      JSON.stringify({
        type: 'assistant_delta',
        delta: 'streaming text',
      }) + '\n',
    );
    mockChild.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'COMPLETED',
        summary: 'done',
        files_changed: [],
      }) + '\n',
    );

    setTimeout(() => mockChild.emit('close', 0), 10);
    await runPromise;

    expect(mockStreamAdapter.handleEvent).toHaveBeenCalledWith('exec-123', 'ticket-1', {
      type: 'tool_started',
      tool_name: 'bmad',
      input: {},
    });
    expect(mockStreamAdapter.handleEvent).toHaveBeenCalledWith('exec-123', 'ticket-1', {
      type: 'assistant_delta',
      delta: 'streaming text',
    });
    expect(mockStreamAdapter.handleEvent).toHaveBeenCalledTimes(2);
  });

  it('should fail execution on non-zero exit', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    setTimeout(() => mockChild.emit('close', 1), 10);

    await runPromise;

    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'Process exited with code 1',
        errorCode: '1',
        isRetryable: false,
      },
      'exec-123',
    );
  });

  it('should fail (not complete) on clean exit with no parseable result — AC2c', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    // Only non-JSON noise on stdout — no `result` event — then a clean exit.
    mockChild.stdout.write('some non-json log line\n');
    setTimeout(() => mockChild.emit('close', 0), 10);

    await runPromise;

    expect(mockExecutionTracker.completeExecution).not.toHaveBeenCalled();
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'Clean exit but no parseable result event',
        errorCode: '0',
        isRetryable: false,
      },
      'exec-123',
    );
  });

  it('should fail on spawn error without an unhandled rejection — AC2/edge', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    setTimeout(() => mockChild.emit('error', new Error('spawn oh ENOENT')), 10);

    const execId = await runPromise;

    expect(execId).toBe('exec-123');
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'Spawn error: spawn oh ENOENT',
        isRetryable: false,
      },
      'exec-123',
    );
    expect(mockExecutionTracker.timeoutExecution).not.toHaveBeenCalled();
  });

  it('should kill the child and mark TIMEOUT when the run exceeds the budget — AC2b', async () => {
    jest.useFakeTimers();
    try {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new PassThrough();
      mockChild.stderr = new PassThrough();
      mockChild.kill = jest.fn();
      (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

      const runPromise = service.runForTicket('ticket-1', {
        skill: 'test-skill',
        workspaceDir: '/tmp',
      });

      // Advance past the 30-minute run budget; the child never exits on its own.
      await jest.advanceTimersByTimeAsync(1000 * 60 * 30 + 1);

      const execId = await runPromise;

      expect(execId).toBe('exec-123');
      expect(mockChild.kill).toHaveBeenCalled();
      expect(mockExecutionTracker.timeoutExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-123',
          timeoutSeconds: 1800,
        }),
        'exec-123',
      );
      expect(mockExecutionTracker.completeExecution).not.toHaveBeenCalled();

      // child.kill() emits 'close' in real life. The settle-guard must keep the
      // late close from attempting a second (illegal) terminal transition.
      mockChild.emit('close', null);
      await Promise.resolve();
      expect(mockExecutionTracker.timeoutExecution).toHaveBeenCalledTimes(1);
      expect(mockExecutionTracker.failExecution).not.toHaveBeenCalled();
      expect(mockExecutionTracker.completeExecution).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('persists selected_model up-front and creates the row with no auto-retry — L1/L3', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });
    setTimeout(() => mockChild.emit('close', 0), 10);
    await runPromise;

    expect(mockExecutionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-123' },
      data: { selected_model: expect.any(String) },
    });
  });
});
