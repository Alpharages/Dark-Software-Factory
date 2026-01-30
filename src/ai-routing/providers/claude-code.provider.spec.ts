/**
 * Claude Code Provider Unit Tests
 * Story 19.1: Implement Claude Code CLI Provider
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
// import { AIProvider } from '@/prisma/client';
import { ClaudeCodeProvider } from './claude-code.provider';
import { WorkspaceService } from './workspace.service';
import { IAIExecutionInput } from '../interfaces';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Mock child_process
jest.mock('child_process');

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  // let configService: jest.Mocked<ConfigService>;
  // let workspaceService: jest.Mocked<WorkspaceService>;
  let mockSpawn: jest.Mock;
  let mockMetrics: {
    inc: jest.Mock;
    observe: jest.Mock;
    set: jest.Mock;
    dec: jest.Mock;
  };

  const mockInput: IAIExecutionInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Add a hello function to utils.ts',
    repositoryUrl: 'https://github.com/test/repo.git',
    baseBranch: 'main',
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock spawn to return a process-like object
    mockSpawn = jest.fn().mockImplementation(() => {
      const mockProcess = new EventEmitter() as child_process.ChildProcess;
      mockProcess.stdout = new EventEmitter() as Readable;
      mockProcess.stderr = new EventEmitter() as Readable;
      mockProcess.kill = jest.fn();

      // Simulate successful execution on next tick
      process.nextTick(() => {
        mockProcess.stdout!.emit('data', Buffer.from('Claude Code execution started'));
        mockProcess.stdout!.emit('data', Buffer.from('Processing...'));
        mockProcess.emit('close', 0);
      });

      return mockProcess;
    });
    // Update the mock implementation
    (child_process.spawn as unknown as jest.Mock).mockImplementation(mockSpawn);

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'anthropic.apiKey': 'sk-ant-test-key',
          'anthropic.model': 'claude-sonnet-4-20250505',
          'anthropic.maxTokens': 8000,
          'anthropic.timeoutMs': 120000,
          'anthropic.baseURL': 'http://localhost:11434', // For testing env injection
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockWorkspaceServiceImpl = {
      createWorkspace: jest.fn().mockResolvedValue({
        id: 'ws-123',
        path: '/tmp/test-workspace',
        status: 'READY',
      }),
      updateWorkspaceStatus: jest.fn(),
      extractChanges: jest.fn().mockResolvedValue({
        diff: 'diff --git a/utils.ts b/utils.ts\n+function hello() {}',
        filesChanged: ['src/utils.ts'],
      }),
      cleanupWorkspace: jest.fn(),
    };

    mockMetrics = {
      inc: jest.fn(),
      observe: jest.fn(),
      set: jest.fn(),
      dec: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeCodeProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WorkspaceService, useValue: mockWorkspaceServiceImpl },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: mockMetrics },
      ],
    }).compile();

    provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    // configService = module.get(ConfigService);
    // workspaceService = module.get(WorkspaceService);

    await provider.onModuleInit();
  });

  afterEach(async () => {
    await provider.onModuleDestroy();
  });

  describe('execute', () => {
    it('should use spawn to invoke claude CLI', async () => {
      await provider.execute(mockInput);

      expect(mockSpawn).toHaveBeenCalled();
      const [command, args] = mockSpawn.mock.calls[0];

      expect(command).toBe('claude');
      expect(args).toContain('--print');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--no-session-persistence');
      expect(args[5]).toContain(mockInput.prompt); // Verify prompt is passed in args
    });

    it('should inject environment variables including ANTHROPIC_AUTH_TOKEN', async () => {
      await provider.execute(mockInput);

      const [, , options] = mockSpawn.mock.calls[0];
      expect(options.env).toBeDefined();
      expect(options.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
      // Assuming behavior for local/ollama if baseURL is set
      expect(options.env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
    });

    it('should set CWD to workspace path or project root', async () => {
      await provider.execute(mockInput);

      const [, , options] = mockSpawn.mock.calls[0];
      // Should effectively use the workspace path created
      expect(options.cwd).toBe('/tmp/test-workspace');
    });
  });
});
