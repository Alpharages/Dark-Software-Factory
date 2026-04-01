import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CodexProvider } from './codex.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { AIProvider } from '@/prisma/client';
import { AIErrorCode } from '../interfaces/ai-provider.interface';

describe('CodexProvider', () => {
  let provider: CodexProvider;
  let sandboxService: jest.Mocked<SandboxService>;
  let _resourceProfileService: jest.Mocked<SandboxResourceProfileService>;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;

  const mockPayload: IAIExecutionPayload = {
    ticketId: 'ticket-123',
    executionId: 'exec-456',
    aiProvider: AIProvider.CODEX,
    priority: 1,
    prompt: 'Implement a linked list',
    repositoryUrl: 'https://github.com/test/repo',
    projectId: 'proj-789',
    complexityScore: 8,
  };

  const mockResultLine = {
    type: 'result',
    prUrl: 'https://github.com/test/repo/pull/1',
    commitSha: 'sha123',
    branchName: 'dsf/ticket-123/exec-456',
    qaStatus: 'passed',
    qaRetryCount: 0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockSandboxService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      runAgentCommand: jest.fn().mockImplementation(async (options) => {
        // Simulate progress updates if callback is provided
        if (options.onStdoutLine) {
          options.onStdoutLine(JSON.stringify({ type: 'progress', pct: 50, msg: 'Testing...' }));
          options.onStdoutLine(JSON.stringify(mockResultLine));
        }
        return {
          exitCode: 0,
          stdout: `Some logs...\n${JSON.stringify(mockResultLine)}`,
          stderr: '',
          durationMs: 1200,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      }),
    };

    const mockResourceProfileService = {
      getProfile: jest.fn().mockReturnValue({
        cpuLimit: '2',
        memoryLimit: '4Gi',
        networkPolicy: { defaultAction: 'ALLOW' },
      }),
    };

    const mockExecutionTracker = {
      emitProgress: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'ai.providers.codex.enabled': true,
          'codex.apiKey': 'sk-codex-test-key',
          'codex.baseURL': 'https://api.openai.com/v1',
          'codex.model': 'codex-1',
          'opensandbox.agentImage': 'dsf-agents:latest',
          'opensandbox.sandboxTimeoutS': 3600,
          'github.token': 'gh-token-abc',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodexProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SandboxService, useValue: mockSandboxService },
        { provide: SandboxResourceProfileService, useValue: mockResourceProfileService },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
      ],
    }).compile();

    provider = module.get<CodexProvider>(CodexProvider);
    sandboxService = module.get(SandboxService) as jest.Mocked<SandboxService>;
    _resourceProfileService = module.get(
      SandboxResourceProfileService,
    ) as jest.Mocked<SandboxResourceProfileService>;
    executionTracker = module.get(ExecutionTrackerService) as jest.Mocked<ExecutionTrackerService>;
  });

  describe('isEnabled', () => {
    it('should return true when config is true', () => {
      expect(provider.isEnabled).toBe(true);
    });

    it('should return false when config is false', async () => {
      const mockConfigDisabled = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'ai.providers.codex.enabled') return false;
          return defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CodexProvider,
          { provide: ConfigService, useValue: mockConfigDisabled },
          { provide: SandboxService, useValue: { isHealthy: jest.fn() } },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
          { provide: ExecutionTrackerService, useValue: {} },
        ],
      }).compile();
      const p = module.get<CodexProvider>(CodexProvider);
      expect(p.isEnabled).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return true when API key is set and sandbox is healthy', async () => {
      const result = await provider.isHealthy();
      expect(result).toBe(true);
    });

    it('should return false when sandbox is unhealthy', async () => {
      sandboxService.isHealthy.mockResolvedValueOnce(false);
      expect(await provider.isHealthy()).toBe(false);
    });

    it('should return false when API key is missing', async () => {
      const mockConfigNoKey = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'codex.apiKey') return '';
          return defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CodexProvider,
          { provide: ConfigService, useValue: mockConfigNoKey },
          { provide: SandboxService, useValue: { isHealthy: jest.fn() } },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
          { provide: ExecutionTrackerService, useValue: {} },
        ],
      }).compile();
      const p = module.get<CodexProvider>(CodexProvider);
      expect(await p.isHealthy()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should run codex command with agentic workflow and emit progress', async () => {
      const result = await provider.execute(mockPayload);

      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'codex execute dsf-execution',
          image: 'dsf-agents:latest',
          env: expect.objectContaining({
            OPENAI_API_KEY: 'sk-codex-test-key',
            CODEX_MODEL: 'codex-1',
            IS_SANDBOX: '1',
            REPO_URL: mockPayload.repositoryUrl,
            FEATURE_BRANCH: 'dsf/ticket-123/exec-456',
            TASK_DESCRIPTION: mockPayload.prompt,
            GITHUB_TOKEN: 'gh-token-abc',
            QA_MAX_RETRIES: '3',
          }),
          onStdoutLine: expect.any(Function),
        }),
      );

      expect(executionTracker.emitProgress).toHaveBeenCalledWith(
        mockPayload.executionId,
        mockPayload.ticketId,
        mockPayload.projectId,
        'Testing...',
        50,
      );

      expect(result.success).toBe(true);
      expect(result.codeDiff).toBeNull();
      expect(result.prUrl).toBe(mockResultLine.prUrl);
      expect(result.commitSha).toBe(mockResultLine.commitSha);
      expect(result.qaStatus).toBe('passed');
    });

    it('should silently skip non-JSON stdout lines without crashing', async () => {
      sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine('this is plain text, not json');
          options.onStdoutLine('{ invalid json }');
          options.onStdoutLine(JSON.stringify(mockResultLine));
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify(mockResultLine),
          stderr: '',
          durationMs: 100,
          timedOut: false,
          sandboxId: 'sbx-123',
        };
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(true);
      expect(result.commitSha).toBe(mockResultLine.commitSha);
    });

    it('should fallback to parsing stdout if onStdoutLine missed the result', async () => {
      // Mock runAgentCommand WITHOUT calling onStdoutLine for the result
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Random logs\n${JSON.stringify(mockResultLine)}\n`,
        stderr: '',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(true);
      expect(result.commitSha).toBe(mockResultLine.commitSha);
    });

    it('should return failure if result line is missing and exit code is 0', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'No JSON here',
        stderr: '',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Agent did not emit a final result line');
    });

    it('should return failure if QA failed even if process exited cleanly', async () => {
      const failedResult = { ...mockResultLine, qaStatus: 'failed', prUrl: null };
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(failedResult),
        stderr: '',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.qaStatus).toBe('failed');
      expect(result.error?.message).toContain('Agent completed with QA failures');
    });

    it('should handle timeout', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 124,
        stdout: '',
        stderr: 'Timeout',
        durationMs: 3600000,
        timedOut: true,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
    });

    it('should handle process crash', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Process crashed',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
      expect(result.error?.isRetryable).toBe(false);
    });
  });
});
