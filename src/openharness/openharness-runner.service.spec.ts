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
import { ProjectWorkspaceService } from './project-workspace.service';
import { EventBusService } from '@/common/event-bus.service';
import { SkillModelMapService } from './skill-model-map.service';
import { AiAccountSelectorService } from '@/ai-accounts/account-selector.service';
import { AiAccountsService } from '@/ai-accounts/ai-accounts.service';
import { NoEligibleAccountError } from '@/ai-accounts/errors/no-eligible-account.error';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { EncryptionService } from '@/common/encryption/encryption.service';

jest.mock('child_process');

describe('OpenHarnessRunnerService', () => {
  let service: OpenHarnessRunnerService;
  let mockExecutionRepo: Record<string, jest.Mock>;
  let mockExecutionTracker: Record<string, jest.Mock>;
  let mockPrisma: any;
  let mockConfig: Record<string, jest.Mock>;
  let mockStreamAdapter: Record<string, jest.Mock>;
  let mockGuardrails: Record<string, jest.Mock>;
  let mockProjectWorkspace: Record<string, jest.Mock>;
  let mockEventBus: Record<string, jest.Mock>;
  let mockSkillModelMap: Record<string, jest.Mock>;
  let mockAccountSelector: Record<string, jest.Mock>;
  let mockAiAccounts: Record<string, jest.Mock>;
  let mockCostTracker: Record<string, jest.Mock>;

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
      emitProgress: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({ clickup_task_id: '86test123' }),
      },
      execution: {
        update: jest.fn().mockResolvedValue(true),
        findUnique: jest.fn().mockResolvedValue({
          started_at: new Date('2026-07-02T10:00:00.000Z'),
          completed_at: new Date('2026-07-02T10:00:12.000Z'),
          failed_at: null,
          selected_model: 'gpt-5.4',
          selected_account_id: 'acct-openai',
          ticket: { project_id: 'project-1' },
        }),
      },
      qAResult: {
        upsert: jest.fn().mockResolvedValue({ id: 'qa-1' }),
      },
      ticketDependency: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ lore_server_url: null, lore_api_key: null }),
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
          LORE_SERVER_URL: 'https://global-lore.example.com',
          LORE_API_KEY: 'lore_global_key',
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
    // Default: no per-project repo resolved — run in the given workspaceDir,
    // matching the runner's pre-delivery behaviour (no code-ready emission).
    mockProjectWorkspace = {
      resolveWorkspaceDir: jest
        .fn()
        .mockImplementation(async (_ticketId: string, fallbackDir: string) => ({
          dir: fallbackDir,
          project: null,
        })),
    };
    mockEventBus = { emit: jest.fn() };
    mockSkillModelMap = {
      resolveModel: jest
        .fn()
        .mockResolvedValue({ model: 'gpt-5.4', provider: 'openai', runtime: 'oh' }),
    };
    mockAccountSelector = {
      selectAccount: jest.fn().mockResolvedValue({ id: 'acct-openai' }),
      recordUsage: jest.fn().mockResolvedValue(undefined),
      quarantine: jest.fn().mockResolvedValue(undefined),
    };
    mockAiAccounts = {
      getDecryptedCredentials: jest.fn().mockResolvedValue({ token: 'sk-selected' }),
    };
    mockCostTracker = {
      logCost: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenHarnessRunnerService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: ExecutionRepository, useValue: mockExecutionRepo },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OpenHarnessRunGuardrailsService, useValue: mockGuardrails },
        { provide: ProjectWorkspaceService, useValue: mockProjectWorkspace },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: SkillModelMapService, useValue: mockSkillModelMap },
        { provide: AiAccountSelectorService, useValue: mockAccountSelector },
        { provide: AiAccountsService, useValue: mockAiAccounts },
        { provide: AICostTrackerService, useValue: mockCostTracker },
        {
          provide: EncryptionService,
          useValue: { decrypt: jest.fn((v: string) => v), encrypt: jest.fn((v: string) => v) },
        },
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
    expect(mockConfig.get).not.toHaveBeenCalledWith('openharness.model');
    expect(mockConfig.get).not.toHaveBeenCalledWith('openharness.runtime');
    expect(mockConfig.get).not.toHaveBeenCalledWith('openharness.claudeModel');
    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.stringContaining('scripts/oh-run-skill.sh'),
      ['86test123', expect.stringContaining('exec-123.stream.json')],
      expect.objectContaining({
        env: expect.objectContaining({
          OH_RUN_WORKFLOW: 'test-skill',
          OH_RUN_STREAM_STDOUT: '1',
          OPENAI_API_KEY: 'sk-selected',
        }),
      }),
    );
    expect(mockAccountSelector.recordUsage).toHaveBeenCalledWith('acct-openai', {
      requests: 1,
      tokens: 0,
    });
    expect(mockCostTracker.logCost).toHaveBeenCalledTimes(1);
    expect(mockCostTracker.logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-123',
        ticketId: 'ticket-1',
        provider: AIProvider.OPENHARNESS,
        model: 'gpt-5.4',
        selectedAccountId: 'acct-openai',
        projectId: 'project-1',
        skill: 'test-skill',
        durationMs: 12000,
        inputTokens: null,
        outputTokens: null,
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
    expect(mockAccountSelector.recordUsage).toHaveBeenCalledWith('acct-openai', {
      requests: 1,
      tokens: 0,
    });
  });

  it('quarantines a rate-limited account and fails over to the next one mid-run', async () => {
    const child1 = new EventEmitter() as any;
    child1.stdout = new PassThrough();
    child1.stderr = new PassThrough();
    child1.kill = jest.fn();
    const child2 = new EventEmitter() as any;
    child2.stdout = new PassThrough();
    child2.stderr = new PassThrough();
    child2.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValueOnce(child1).mockReturnValueOnce(child2);
    mockAccountSelector.selectAccount
      .mockResolvedValueOnce({ id: 'acct-1' })
      .mockResolvedValueOnce({ id: 'acct-2' });

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    child1.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'FAILED',
        error_message: 'Claude AI usage limit reached|1751400000',
      }) + '\n',
    );
    setTimeout(() => child1.emit('close', 1), 10);
    // Drive the second attempt to success once the failover has spawned it.
    const driveSecond = setInterval(() => {
      if ((child_process.spawn as jest.Mock).mock.calls.length === 2) {
        clearInterval(driveSecond);
        child2.stdout.write(
          JSON.stringify({
            type: 'result',
            status: 'COMPLETED',
            summary: 'done',
            files_changed: ['a.ts'],
          }) + '\n',
        );
        child2.emit('close', 0);
      }
    }, 5);

    await runPromise;

    expect(mockAccountSelector.quarantine).toHaveBeenCalledWith('acct-1', expect.any(Number));
    expect(child_process.spawn).toHaveBeenCalledTimes(2);
    expect(mockExecutionTracker.failExecution).not.toHaveBeenCalled();
    expect(mockExecutionTracker.completeExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'exec-123', codeOutput: 'done' }),
      'exec-123',
    );
    expect(mockAccountSelector.recordUsage).toHaveBeenCalledWith('acct-2', {
      requests: 1,
      tokens: 0,
    });
  });

  it('fails with the original rate-limit error when no other account is eligible', async () => {
    const child1 = new EventEmitter() as any;
    child1.stdout = new PassThrough();
    child1.stderr = new PassThrough();
    child1.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValueOnce(child1);
    mockAccountSelector.selectAccount
      .mockResolvedValueOnce({ id: 'acct-1' })
      .mockRejectedValueOnce(new NoEligibleAccountError('openai', 'oh'));

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'test-skill',
      workspaceDir: '/tmp',
    });

    child1.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'FAILED',
        error_message: 'rate_limit_error: Number of requests exceeded',
      }) + '\n',
    );
    setTimeout(() => child1.emit('close', 1), 10);

    await runPromise;

    expect(mockAccountSelector.quarantine).toHaveBeenCalledWith('acct-1', expect.any(Number));
    expect(child_process.spawn).toHaveBeenCalledTimes(1);
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-123',
        errorMessage: 'rate_limit_error: Number of requests exceeded',
      }),
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

  // QA-2026-07-13 §2.1d: the live failure — the agent claimed "implemented
  // end-to-end", captured nothing, and the run still read COMPLETED. It must not
  // report success; instead it parks in PAUSED-awaiting-input and emits the
  // needs-input event so the ask reaches the PM tool.
  it('parks an implement run that reports success but captured no files as awaiting-input', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'clickup-dev-implement',
      workspaceDir: '/tmp',
    });

    mockChild.stdout.write(
      JSON.stringify({
        type: 'result',
        status: 'COMPLETED',
        summary: 'Implemented CU-86exz3qzx end-to-end',
        files_changed: [],
      }) + '\n',
    );
    setTimeout(() => mockChild.emit('close', 0), 10);
    await runPromise;

    expect(mockExecutionTracker.completeExecution).not.toHaveBeenCalled();
    expect(mockExecutionTracker.failExecution).not.toHaveBeenCalled();
    expect(mockPrisma.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: 'PAUSED',
          error_context: expect.stringContaining('"awaitingInput":true'),
        }),
      }),
    );
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'openharness.needs-input',
      expect.objectContaining({ executionId: 'exec-123' }),
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
      expect(mockAccountSelector.recordUsage).toHaveBeenCalledTimes(1);
      expect(mockAccountSelector.recordUsage).toHaveBeenCalledWith('acct-openai', {
        requests: 1,
        tokens: 0,
      });
      expect(mockCostTracker.logCost).toHaveBeenCalledTimes(1);
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
      data: { selected_model: expect.any(String), selected_account_id: 'acct-openai' },
    });
  });

  it('resolves model/runtime from the skill→model map and drives wrapper/env/selected_model (A3 AC3)', async () => {
    mockSkillModelMap.resolveModel.mockResolvedValue({
      model: 'opus',
      provider: 'claude',
      runtime: 'claude',
    });
    mockAccountSelector.selectAccount.mockResolvedValue({ id: 'acct-claude' });
    mockAiAccounts.getDecryptedCredentials.mockResolvedValue({
      email: 'claude@example.com',
      password: 'secret',
    });
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'clickup-code-review',
      workspaceDir: '/tmp',
    });
    // Claude result event carrying a usage block — tokens must flow to recordUsage.
    mockChild.stdout.write(
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: 'done',
        usage: { input_tokens: 100, output_tokens: 50 },
      }) + '\n',
    );
    setTimeout(() => mockChild.emit('close', 0), 10);
    await runPromise;

    expect(mockSkillModelMap.resolveModel).toHaveBeenCalledWith('clickup-code-review');
    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-123' },
      data: { selected_model: 'opus', selected_account_id: 'acct-claude' },
    });
    expect(mockAccountSelector.selectAccount).toHaveBeenCalledWith({
      provider: 'claude',
      runtime: 'claude',
      model: 'opus',
    });
    // Account selection is driven by a per-account CLAUDE_CONFIG_DIR — the only
    // headless way to bind the run to a specific Claude subscription session.
    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.stringContaining('scripts/claude-run-skill.sh'),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_RUN_MODEL: 'opus',
          OH_RUN_MODEL: '',
          CLAUDE_CONFIG_DIR: expect.stringContaining('acct-claude'),
        }),
      }),
    );
    // AC7: the decrypted email/password must never reach the child env.
    const spawnEnv = (child_process.spawn as jest.Mock).mock.calls[0][2].env as Record<
      string,
      unknown
    >;
    expect(spawnEnv).not.toHaveProperty('CLAUDE_ACCOUNT_EMAIL');
    expect(spawnEnv).not.toHaveProperty('CLAUDE_ACCOUNT_PASSWORD');
    expect(mockAccountSelector.recordUsage).toHaveBeenCalledWith('acct-claude', {
      requests: 1,
      tokens: 150,
    });
    expect(mockCostTracker.logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: 'clickup-code-review',
        inputTokens: 100,
        outputTokens: 50,
      }),
    );
  });

  it('falls back to the oh wrapper/env when the map resolves an oh runtime (AC4)', async () => {
    mockSkillModelMap.resolveModel.mockResolvedValue({
      model: 'gpt-5.4',
      provider: 'openai',
      runtime: 'oh',
    });
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = jest.fn();
    (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

    const runPromise = service.runForTicket('ticket-1', {
      skill: 'clickup-dev-implement',
      workspaceDir: '/tmp',
    });
    setTimeout(() => mockChild.emit('close', 0), 10);
    await runPromise;

    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.stringContaining('scripts/oh-run-skill.sh'),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ OH_RUN_MODEL: 'gpt-5.4', CLAUDE_RUN_MODEL: '' }),
      }),
    );
  });

  it('fails explicitly without spawning when no eligible account exists', async () => {
    mockAccountSelector.selectAccount.mockRejectedValue(new NoEligibleAccountError('openai', 'oh'));

    const execId = await service.runForTicket('ticket-1', {
      skill: 'clickup-dev-implement',
      workspaceDir: '/tmp',
    });

    expect(execId).toBe('exec-123');
    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(mockExecutionTracker.failExecution).toHaveBeenCalledWith(
      {
        executionId: 'exec-123',
        errorMessage: 'No eligible AI account for provider "openai" and runtime "oh".',
        isRetryable: false,
      },
      'exec-123',
    );
    expect(mockAiAccounts.getDecryptedCredentials).not.toHaveBeenCalled();
  });

  // EXEC-CRIT-5 / QA-2026-07-13 §2.1d: the changed-file list must come from git —
  // committed diff AND working tree — never from the stream parser, which the
  // claude runtime never populates. Route the mock by git subcommand: the earlier
  // fix passed its tests only because they mocked an always-committed diff.
  const gitMock = (handler: (args: string[]) => string) => {
    (child_process.execFileSync as jest.Mock).mockImplementation((_cmd, args) =>
      handler(args as string[]),
    );
  };
  const gitSub = (args: string[]) =>
    args.find((a) => ['status', 'diff', 'add', 'commit'].includes(a)) ?? '';

  describe('redactSecrets', () => {
    const redact = (text: string, secrets: string[]) =>
      (service as any).redactSecrets(text, secrets);

    it('replaces every occurrence of each secret and keeps JSON valid', () => {
      const line = '{"header":"Bearer lore_acme_SECRET","note":"lore_acme_SECRET again"}';
      const out = redact(line, ['lore_acme_SECRET', '']);
      expect(out).not.toContain('lore_acme_SECRET');
      expect(out).toContain('[REDACTED]');
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('leaves lines without any secret untouched', () => {
      expect(redact('{"type":"progress"}', ['lore_x_KEY'])).toBe('{"type":"progress"}');
    });
  });

  describe('resolveChangedFiles', () => {
    const call = (base: string | undefined, parserFiles: string[]) =>
      (service as any).resolveChangedFiles('/tmp/wt', base, parserFiles);

    it('captures the working tree when the agent never committed (§2.1d regression)', () => {
      gitMock(
        (args) =>
          gitSub(args) === 'status'
            ? 'A  hooks/use-ai-consent.ts\0?? components/ui/AiConsentCard.tsx\0'
            : '', // no commit → empty committed diff, the exact live-failure shape
      );
      expect(call('main', [])).toEqual([
        'hooks/use-ai-consent.ts',
        'components/ui/AiConsentCard.tsx',
      ]);
    });

    it('unions committed and uncommitted work without duplicating a file', () => {
      gitMock((args) =>
        gitSub(args) === 'status'
          ? ' M server/routers.ts\0?? tests/ai-router.test.ts\0'
          : 'server/ai/categorize.ts\nserver/routers.ts\n',
      );
      expect(call('main', ['stale.ts']).sort()).toEqual([
        'server/ai/categorize.ts',
        'server/routers.ts',
        'tests/ai-router.test.ts',
      ]);
    });

    it('counts a rename once, ignoring the source path field', () => {
      gitMock((args) => (gitSub(args) === 'status' ? 'R  new/path.ts\0old/path.ts\0' : ''));
      expect(call('main', [])).toEqual(['new/path.ts']);
    });

    it('falls back to origin/<branch> when the local base ref is missing', () => {
      gitMock((args) => {
        if (gitSub(args) === 'status') return '';
        if (args.includes('main...HEAD'))
          throw new Error("fatal: ambiguous argument 'main...HEAD'");
        return 'server/routers.ts\n';
      });
      expect(call('main', ['stale.ts'])).toEqual(['server/routers.ts']);
    });

    it('falls back to the parser list only when git can answer nothing at all', () => {
      gitMock(() => {
        throw new Error('fatal: bad revision');
      });
      expect(call('main', ['from-stream.ts'])).toEqual(['from-stream.ts']);
    });

    it('still reads the working tree for a non-isolated run (no base branch)', () => {
      gitMock((args) => (gitSub(args) === 'status' ? ' M in-place.ts\0' : ''));
      expect(call(undefined, ['from-stream.ts'])).toEqual(['in-place.ts']);
    });
  });

  // §2.1d: the agent's work must survive worktree teardown — the runner commits
  // it onto the ticket branch rather than trusting the agent to have done so.
  describe('commitPendingWork', () => {
    const call = () =>
      (service as any).commitPendingWork(
        '/tmp/wt',
        'exec-123',
        '86exz3qzx',
        'clickup-dev-implement',
      );

    it('stages and commits work the agent left uncommitted', () => {
      gitMock((args) => (gitSub(args) === 'diff' ? 'app/settings.tsx\n' : ''));
      call();
      const commit = (child_process.execFileSync as jest.Mock).mock.calls.find(
        ([, args]) => gitSub(args as string[]) === 'commit',
      );
      expect(commit).toBeDefined();
      expect(commit[1]).toEqual(expect.arrayContaining(['user.email=bot@dsf.local']));
      expect(commit[1].join(' ')).toContain('CU-86exz3qzx');
    });

    it('does not commit when the agent already committed everything', () => {
      gitMock(() => '');
      call();
      expect(
        (child_process.execFileSync as jest.Mock).mock.calls.some(
          ([, args]) => gitSub(args as string[]) === 'commit',
        ),
      ).toBe(false);
    });

    it('never throws when git fails — the captured diff still stands', () => {
      gitMock(() => {
        throw new Error('git index locked');
      });
      expect(() => call()).not.toThrow();
    });
  });

  // EXEC-3: a completed QA run must persist a verdict onto the execution's
  // QAResult so the QA tab / approval gate have data.
  describe('persistQaVerdict', () => {
    it('upserts a passing verdict with the summary for human review', async () => {
      await (service as any).persistQaVerdict('exec-123', 'All tests green; coverage 92%');

      expect(mockPrisma.qAResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { execution_id: 'exec-123' },
          create: expect.objectContaining({
            execution_id: 'exec-123',
            overall_passed: true,
            code_review_issues: { summary: 'All tests green; coverage 92%' },
          }),
        }),
      );
    });

    it('never throws when the QA write fails — the run outcome stands', async () => {
      mockPrisma.qAResult.upsert.mockRejectedValueOnce(new Error('db down'));
      await expect(
        (service as any).persistQaVerdict('exec-123', 'summary'),
      ).resolves.toBeUndefined();
    });
  });

  describe('resolveLoreEnv — per-project memory isolation', () => {
    it('inherits the global Lore key when the project has none', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        lore_server_url: null,
        lore_api_key: null,
      });
      const env = await (service as any).resolveLoreEnv('project-1');
      expect(env).toEqual({
        LORE_SERVER_URL: 'https://global-lore.example.com',
        LORE_API_KEY: 'lore_global_key',
      });
    });

    it('injects the project-specific decrypted key so memory stays isolated', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        lore_server_url: 'https://tenant-lore.example.com',
        lore_api_key: 'lore_acme_secret', // decrypt mock is identity
      });
      const env = await (service as any).resolveLoreEnv('project-1');
      expect(env).toEqual({
        LORE_SERVER_URL: 'https://tenant-lore.example.com',
        LORE_API_KEY: 'lore_acme_secret',
      });
    });

    it('runs with an empty key rather than leaking to the shared key when decrypt fails', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        lore_server_url: 'https://tenant-lore.example.com',
        lore_api_key: 'corrupt',
      });
      ((service as any).encryption.decrypt as jest.Mock).mockImplementationOnce(() => {
        throw new Error('bad key');
      });
      const env = await (service as any).resolveLoreEnv('project-1');
      expect(env.LORE_API_KEY).toBe('');
      expect(env.LORE_SERVER_URL).toBe('https://tenant-lore.example.com');
    });
  });

  describe('resolveUnmergedBlockerBranches', () => {
    // Route git by subcommand: a branch is "unmerged" iff it exists locally AND
    // `merge-base --is-ancestor` fails (non-zero) against the default branch.
    const wire = (existing: Set<string>, mergedIntoMain: Set<string>) => {
      gitMock((args) => {
        if (args.includes('rev-parse') && args.includes('--verify')) {
          const ref = args[args.length - 1]; // refs/heads/ohp/<id>
          const branch = ref.replace('refs/heads/', '');
          if (!existing.has(branch)) throw new Error('unknown revision');
          return '';
        }
        if (args.includes('merge-base') && args.includes('--is-ancestor')) {
          const branch = args[args.indexOf('--is-ancestor') + 1];
          if (mergedIntoMain.has(branch)) return ''; // exit 0 = already in main
          throw new Error('not an ancestor'); // exit non-zero = unmerged
        }
        return '';
      });
    };
    const call = () =>
      (service as any).resolveUnmergedBlockerBranches('/repo', 'ticket-1', 'main') as Promise<
        string[]
      >;

    it('chains only blockers whose branch exists and is not yet in main', async () => {
      mockPrisma.ticketDependency.findMany.mockResolvedValue([
        { depends_on: 'unmerged' }, // exists, not in main → chain
        { depends_on: 'merged' }, // exists, already in main → skip
        { depends_on: 'ghost' }, // no local branch → skip
      ]);
      wire(new Set(['ohp/unmerged', 'ohp/merged']), new Set(['ohp/merged']));

      await expect(call()).resolves.toEqual(['ohp/unmerged']);
    });

    it('returns nothing when the ticket has no blockers', async () => {
      mockPrisma.ticketDependency.findMany.mockResolvedValue([]);
      wire(new Set(), new Set());
      await expect(call()).resolves.toEqual([]);
    });
  });
});
