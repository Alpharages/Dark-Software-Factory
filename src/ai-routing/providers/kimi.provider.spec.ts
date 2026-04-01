import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KimiProvider } from './kimi.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { AIProvider } from '@/prisma/client';
import { AIErrorCode } from '../interfaces/ai-provider.interface';

describe('KimiProvider', () => {
  let provider: KimiProvider;
  let sandboxService: jest.Mocked<SandboxService>;
  let _resourceProfileService: jest.Mocked<SandboxResourceProfileService>;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;

  const mockPayload: IAIExecutionPayload = {
    ticketId: 'ticket-123',
    executionId: 'exec-456',
    aiProvider: AIProvider.KIMI,
    priority: 1,
    prompt: 'Analyze this code',
    repositoryUrl: 'https://github.com/test/repo',
    projectId: 'proj-789',
    complexityScore: 3,
  };

  const mockResultLine = {
    type: 'result',
    prUrl: 'https://github.com/test/repo/pull/2',
    commitSha: 'sha789',
    branchName: 'dsf/ticket-123/exec-456',
    qaStatus: 'passed',
    qaRetryCount: 1,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockSandboxService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      runAgentCommand: jest.fn().mockImplementation(async (options) => {
        if (options.onStdoutLine) {
          options.onStdoutLine(JSON.stringify({ type: 'progress', pct: 40, msg: 'Analyzing...' }));
          options.onStdoutLine(JSON.stringify(mockResultLine));
        }
        return {
          exitCode: 0,
          stdout: `Logs...\n${JSON.stringify(mockResultLine)}`,
          stderr: '',
          durationMs: 800,
          timedOut: false,
          sandboxId: 'sbx-789',
        };
      }),
    };

    const mockResourceProfileService = {
      getProfile: jest.fn().mockReturnValue({
        cpuLimit: '1',
        memoryLimit: '2Gi',
        networkPolicy: { defaultAction: 'ALLOW' },
      }),
    };

    const mockExecutionTracker = {
      emitProgress: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'ai.providers.kimi.enabled': true,
          'kimi.apiKey': 'kimi-test-key',
          'kimi.baseURL': 'https://api.moonshot.cn/v1',
          'kimi.model': 'kimi-k2',
          'opensandbox.agentImage': 'dsf-agents:latest',
          'opensandbox.sandboxTimeoutS': 3600,
          'github.token': 'gh-token-abc',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KimiProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SandboxService, useValue: mockSandboxService },
        { provide: SandboxResourceProfileService, useValue: mockResourceProfileService },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
      ],
    }).compile();

    provider = module.get<KimiProvider>(KimiProvider);
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
          if (key === 'ai.providers.kimi.enabled') return false;
          return defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KimiProvider,
          { provide: ConfigService, useValue: mockConfigDisabled },
          { provide: SandboxService, useValue: { isHealthy: jest.fn() } },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
          { provide: ExecutionTrackerService, useValue: {} },
        ],
      }).compile();
      const p = module.get<KimiProvider>(KimiProvider);
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
          if (key === 'kimi.apiKey') return '';
          return defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KimiProvider,
          { provide: ConfigService, useValue: mockConfigNoKey },
          { provide: SandboxService, useValue: { isHealthy: jest.fn() } },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
          { provide: ExecutionTrackerService, useValue: {} },
        ],
      }).compile();
      const p = module.get<KimiProvider>(KimiProvider);
      expect(await p.isHealthy()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should run kimi command with agentic workflow and emit progress', async () => {
      const result = await provider.execute(mockPayload);

      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'kimi /dsf-execution',
          image: 'dsf-agents:latest',
          env: expect.objectContaining({
            KIMI_API_KEY: 'kimi-test-key',
            KIMI_MODEL: 'kimi-k2',
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
        'Analyzing...',
        40,
      );

      expect(result.success).toBe(true);
      expect(result.codeDiff).toBeNull();
      expect(result.prUrl).toBe(mockResultLine.prUrl);
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
          sandboxId: 'sbx-789',
        };
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(true);
      expect(result.commitSha).toBe(mockResultLine.commitSha);
    });

    it('should fallback to parsing stdout if onStdoutLine missed the result', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `${JSON.stringify(mockResultLine)}\n`,
        stderr: '',
        durationMs: 400,
        timedOut: false,
        sandboxId: 'sbx-789',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(true);
      expect(result.commitSha).toBe(mockResultLine.commitSha);
    });

    it('should handle failure if result line is missing', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'No result line here',
        stderr: '',
        durationMs: 400,
        timedOut: false,
        sandboxId: 'sbx-789',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Agent did not emit a final result line');
    });

    it('should handle failure if QA failed even if process exited cleanly', async () => {
      const failedResult = { ...mockResultLine, qaStatus: 'failed', prUrl: null };
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(failedResult),
        stderr: '',
        durationMs: 400,
        timedOut: false,
        sandboxId: 'sbx-789',
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
        sandboxId: 'sbx-789',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
    });

    it('should handle process crash', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Crash',
        durationMs: 200,
        timedOut: false,
        sandboxId: 'sbx-789',
      });

      const result = await provider.execute(mockPayload);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
      expect(result.error?.isRetryable).toBe(false);
    });
  });
});
