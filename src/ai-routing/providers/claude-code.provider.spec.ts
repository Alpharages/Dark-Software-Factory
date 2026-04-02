/**
 * Claude Code Provider Unit Tests
 * Story WR-2.3: Agentic delivery workflow
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeCodeProvider } from './claude-code.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { AIProvider } from '@/prisma/client';
import { AIErrorCode } from '@/ai-routing/interfaces';

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  let sandboxService: jest.Mocked<SandboxService>;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;

  const mockPayload: IAIExecutionPayload = {
    ticketId: 'ticket-123',
    executionId: 'exec-456',
    aiProvider: AIProvider.CLAUDE_CODE,
    priority: 1,
    prompt: 'Implement feature X',
    repositoryUrl: 'https://github.com/test/repo',
    projectId: 'proj-789',
    complexityScore: 8,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockSandboxService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      runAgentCommand: jest.fn().mockImplementation(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('{"type":"progress","pct":50,"msg":"Halfway there"}');
          options.onStdoutLine(
            '{"type":"result","prUrl":"https://github.com/pr/1","qaStatus":"passed"}',
          );
        }
        return {
          exitCode: 0,
          stdout: '{"type":"result","prUrl":"https://github.com/pr/1","qaStatus":"passed"}',
          stderr: '',
          durationMs: 1500,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      }),
    };

    const mockExecutionTracker = {
      emitProgress: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeCodeProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'ai.providers.claudeCode.enabled': true,
                'anthropic.apiKey': 'sk-ant-test',
                'anthropic.model': 'claude-3-5',
                'github.token': 'gh-token',
                'opensandbox.agentImage': 'dsf-agents:latest',
                'opensandbox.sandboxTimeoutS': 3600,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        { provide: SandboxService, useValue: mockSandboxService },
        {
          provide: SandboxResourceProfileService,
          useValue: {
            getProfile: jest.fn().mockReturnValue({ cpuLimit: '2', memoryLimit: '4Gi' }),
          },
        },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
      ],
    }).compile();

    provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    sandboxService = module.get(SandboxService) as jest.Mocked<SandboxService>;
    executionTracker = module.get(ExecutionTrackerService) as jest.Mocked<ExecutionTrackerService>;
  });

  describe('isEnabled', () => {
    it('should return false when claudeCode.enabled config is false', async () => {
      const module = await Test.createTestingModule({
        providers: [
          ClaudeCodeProvider,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === 'ai.providers.claudeCode.enabled') return false;
                return defaultValue;
              }),
            },
          },
          {
            provide: SandboxService,
            useValue: { isHealthy: jest.fn(), runAgentCommand: jest.fn() },
          },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
          { provide: ExecutionTrackerService, useValue: { emitProgress: jest.fn() } },
        ],
      }).compile();
      expect(module.get<ClaudeCodeProvider>(ClaudeCodeProvider).isEnabled).toBe(false);
    });
  });

  describe('execute', () => {
    it('should omit ANTHROPIC_BASE_URL when config value is empty string', async () => {
      const module = await Test.createTestingModule({
        providers: [
          ClaudeCodeProvider,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                const config: Record<string, unknown> = {
                  'ai.providers.claudeCode.enabled': true,
                  'anthropic.apiKey': 'sk-test',
                  'anthropic.baseURL': '',
                  'anthropic.model': 'claude-3-5',
                  'github.token': 'gh-token',
                  'opensandbox.agentImage': 'dsf-agents:latest',
                  'opensandbox.sandboxTimeoutS': 3600,
                };
                return config[key] ?? defaultValue;
              }),
            },
          },
          {
            provide: SandboxService,
            useValue: {
              isHealthy: jest.fn(),
              runAgentCommand: jest.fn().mockResolvedValue({
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 100,
                timedOut: false,
                sandboxId: 'sbx',
              }),
            },
          },
          {
            provide: SandboxResourceProfileService,
            useValue: {
              getProfile: jest.fn().mockReturnValue({ cpuLimit: '1', memoryLimit: '2Gi' }),
            },
          },
          {
            provide: ExecutionTrackerService,
            useValue: { emitProgress: jest.fn().mockResolvedValue(undefined) },
          },
        ],
      }).compile();
      const p = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
      const sb = module.get(SandboxService) as jest.Mocked<SandboxService>;
      await p.execute(mockPayload);
      expect(sb.runAgentCommand.mock.calls[0][0].env['ANTHROPIC_BASE_URL']).toBeUndefined();
    });

    it('should run full agentic workflow and parse structured output', async () => {
      const result = await provider.execute(mockPayload);

      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'claude --dangerously-skip-permissions -p "/dsf-execution"',
          env: expect.objectContaining({
            REPO_URL: 'https://github.com/test/repo',
            TASK_DESCRIPTION: 'Implement feature X',
            GITHUB_TOKEN: 'gh-token',
            QA_MAX_RETRIES: '3',
          }),
        }),
      );

      // Verify progress emission
      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        'exec-456',
        'ticket-123',
        'proj-789',
        'Halfway there',
        50,
      );

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/pr/1');
      expect(result.qaStatus).toBe('passed');
      expect(result.codeDiff).toBeNull();
    });

    it('should successfully execute and capture progress milestones', async () => {
      const milestones = [
        { pct: 10, msg: 'Budget check passed' },
        { pct: 20, msg: 'Cloning repository' },
        { pct: 40, msg: 'Implementing changes' },
        { pct: 75, msg: 'Implementation complete' },
        { pct: 80, msg: 'Running QA' },
        { pct: 90, msg: 'Pushing to GitHub' },
        { pct: 95, msg: 'Opening PR' },
        { pct: 100, msg: 'Done' },
      ];

      (sandboxService.runAgentCommand as jest.Mock).mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          for (const m of milestones) {
            options.onStdoutLine(JSON.stringify({ type: 'progress', ...m }));
          }
          options.onStdoutLine(
            JSON.stringify({
              type: 'result',
              prUrl: 'https://github.com/pr/1',
              qaStatus: 'passed',
              qaRetryCount: 0,
            }),
          );
        }
        return {
          exitCode: 0,
          stdout: 'DONE',
          stderr: '',
          durationMs: 1500,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/pr/1');
      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ onStdoutLine: expect.any(Function) }),
      );

      // Verify all 8 milestones were emitted
      expect(executionTracker.emitProgress).toHaveBeenCalledTimes(8);
      milestones.forEach((m, idx) => {
        expect(executionTracker.emitProgress).toHaveBeenNthCalledWith(
          idx + 1,
          mockPayload.executionId,
          mockPayload.ticketId,
          mockPayload.projectId,
          m.msg,
          m.pct,
        );
      });
    });

    it('should emit QA retry message with specific self-healing information', async () => {
      (sandboxService.runAgentCommand as jest.Mock).mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine(JSON.stringify({ type: 'progress', pct: 80, msg: 'Running QA' }));
          options.onStdoutLine(
            JSON.stringify({ type: 'progress', pct: 82, msg: 'QA failed — retrying (1/3)' }),
          );
          options.onStdoutLine(
            JSON.stringify({
              type: 'result',
              prUrl: 'https://github.com/pr/1',
              qaStatus: 'self_healed',
              qaRetryCount: 1,
            }),
          );
        }
        return {
          exitCode: 0,
          stdout: 'DONE',
          stderr: '',
          durationMs: 1500,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(true);
      expect(result.qaStatus).toBe('self_healed');
      expect(result.qaRetryCount).toBe(1);

      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        mockPayload.executionId,
        mockPayload.ticketId,
        mockPayload.projectId,
        'Running QA',
        80,
      );
      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        mockPayload.executionId,
        mockPayload.ticketId,
        mockPayload.projectId,
        'QA failed — retrying (1/3)',
        82,
      );
    });

    it('should be resilient to non-JSON stdout lines interleaved with progress', async () => {
      (sandboxService.runAgentCommand as jest.Mock).mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('Cloning into /tmp/repo...');
          options.onStdoutLine('{"type":"progress","pct":20,"msg":"Cloning repository"}');
          options.onStdoutLine('Updating submodules...');
          options.onStdoutLine(
            '{"type":"result","prUrl":"https://github.com/pr/1","qaStatus":"passed"}',
          );
        }
        return {
          exitCode: 0,
          stdout: 'DONE',
          stderr: '',
          durationMs: 1500,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      });

      await provider.execute(mockPayload);
      expect(executionTracker.emitProgress).toHaveBeenCalledTimes(1);
      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'Cloning repository',
        20,
      );
    });

    it('should return success: false if QA state is failed', async () => {
      sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('{"type":"result","qaStatus":"failed"}');
        }
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 100,
          timedOut: false,
          sandboxId: 'sbx',
        };
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.qaStatus).toBe('failed');
      expect(result.error?.message).toContain('QA self-healing exhausted retries');
      expect(result.error?.isRetryable).toBe(true);
    });

    it('should return success: false with specific message when no result line emitted', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'some log output',
        stderr: '',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx',
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
      expect(result.error?.message).toContain('did not emit a final result line');
    });

    it('should ignore non-structured lines gracefully', async () => {
      sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('Random log line');
          options.onStdoutLine('{"type":"progress","pct":80,"msg":"Almost done"}');
          options.onStdoutLine('{"type":"result","prUrl":"url","qaStatus":"passed"}');
          options.onStdoutLine('Another random line');
        }
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 100,
          timedOut: false,
          sandboxId: 'sbx',
        };
      });

      const result = await provider.execute(mockPayload);

      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'Almost done',
        80,
      );
      expect(result.prUrl).toBe('url');
    });

    it('should handle sandbox crashes', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'OOM Killed',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx',
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
      expect(result.error?.message).toContain('did not emit a final result line');
    });

    it('should handle timeouts', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 124,
        stdout: '',
        stderr: '',
        durationMs: 3600000,
        timedOut: true,
        sandboxId: 'sbx',
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
      expect(result.error?.isRetryable).toBe(true);
    });
  });
});
