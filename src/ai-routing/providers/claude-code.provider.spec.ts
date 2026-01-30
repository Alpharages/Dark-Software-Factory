/**
 * Claude Code Provider Unit Tests
 * Story 19.1: Implement Claude Code CLI Provider
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeCodeProvider } from './claude-code.provider';
import { WorkspaceService } from './workspace.service';
import { PtyExecutionService } from '../services/pty-execution.service';
import { IAIExecutionInput } from '../interfaces';
import { Subject } from 'rxjs';

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  let ptyExecutionService: jest.Mocked<PtyExecutionService>;
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

    const mockOutputSubject = new Subject<string>();
    const mockExitSubject = new Subject<{ exitCode: number; signal?: number }>();

    const mockPtyExecutionService = {
      spawn: jest.fn().mockImplementation(() => {
        // Simulate output and exit
        setTimeout(() => {
          mockOutputSubject.next('Claude Code execution started\n');
          mockOutputSubject.next('Processing...\n');
          // Simulate successful exit
          mockExitSubject.next({ exitCode: 0 });
          mockExitSubject.complete();
          mockOutputSubject.complete();
        }, 10);

        return {
          pid: 12345,
          output$: mockOutputSubject.asObservable(),
          exit$: mockExitSubject.asObservable(),
        };
      }),
      write: jest.fn(),
      kill: jest.fn(),
      resize: jest.fn(),
    };

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
        { provide: PtyExecutionService, useValue: mockPtyExecutionService },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: mockMetrics },
      ],
    }).compile();

    provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    ptyExecutionService = module.get(PtyExecutionService);

    await provider.onModuleInit();
  });

  afterEach(async () => {
    await provider.onModuleDestroy();
  });

  describe('execute', () => {
    it('should use PtyExecutionService to spawn claude CLI', async () => {
      await provider.execute(mockInput);

      expect(ptyExecutionService.spawn).toHaveBeenCalled();
      const call = ptyExecutionService.spawn.mock.calls[0];
      const command = call[0];
      const args = call[1];
      const options = call[2];

      expect(command).toBe('claude');

      expect(args).toBeDefined();
      expect(args![0]).toBe('--model');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--no-session-persistence');

      // Verify prompt is passed in args
      expect(args!.join(' ')).toContain(mockInput.prompt);

      // Verify options
      expect(options).toBeDefined();
      expect(options!.cwd).toBe('/tmp/test-workspace');
      expect(options!.env).toBeDefined();
      expect(options!.env!.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    });

    it('should inject environment variables correctly', async () => {
      await provider.execute(mockInput);

      const call = ptyExecutionService.spawn.mock.calls[0];
      const options = call[2];
      expect(options).toBeDefined();
      expect(options!.env).toBeDefined();
      expect(options!.env!.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
      expect(options!.env!.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
    });
  });
});
