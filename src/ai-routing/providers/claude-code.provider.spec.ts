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
        // Simulate some output via the callback
        if (options.onStdoutLine) {
          options.onStdoutLine('pct:50:Halfway there');
          options.onStdoutLine('result:{"prUrl":"https://github.com/pr/1","qaStatus":"PASSED"}');
        }
        return {
          exitCode: 0,
          stdout: 'result:{"prUrl":"https://github.com/pr/1","qaStatus":"PASSED"}',
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

  describe('execute', () => {
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
      expect(result.qaStatus).toBe('PASSED');
      expect(result.codeDiff).toBeNull(); // NFR-WR4: raw stdout is no longer returned as codeDiff
    });

    it('should return success: false if QA state is FAILED', async () => {
      sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('result:{"qaStatus":"FAILED"}');
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
      expect(result.qaStatus).toBe('FAILED');
      expect(result.error?.message).toContain('QA self-healing exhausted retries');
      expect(result.error?.isRetryable).toBe(true);
    });

    it('should ignore non-structured lines gracefully', async () => {
      sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('Random log line');
          options.onStdoutLine('pct:80:Almost done');
          options.onStdoutLine('result:{"prUrl":"url"}');
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
      expect(result.error?.message).toBe('OOM Killed');
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
