import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CodexProvider } from './codex.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { AIProvider } from '@/prisma/client';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { AIErrorCode } from '../interfaces/ai-provider.interface';

describe('CodexProvider', () => {
  let provider: CodexProvider;
  let sandboxService: jest.Mocked<SandboxService>;
  let resourceProfileService: jest.Mocked<SandboxResourceProfileService>;

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockSandboxService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      runAgentCommand: jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'Linked list implemented',
        stderr: '',
        durationMs: 1200,
        timedOut: false,
        sandboxId: 'sbx-123',
      }),
    };

    const mockResourceProfileService = {
      getProfile: jest.fn().mockReturnValue({
        cpuLimit: '2',
        memoryLimit: '4Gi',
        networkPolicy: { defaultAction: 'ALLOW' },
      }),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'ai.providers.codex.enabled': true,
          'codex.apiKey': 'sk-codex-test-key',
          'codex.baseURL': 'https://api.openai.com/v1',
          'codex.model': 'codex-1',
          'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
          'opensandbox.sandboxTimeoutS': 3600,
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
      ],
    }).compile();

    provider = module.get<CodexProvider>(CodexProvider);
    sandboxService = module.get(SandboxService) as jest.Mocked<SandboxService>;
    resourceProfileService = module.get(
      SandboxResourceProfileService,
    ) as jest.Mocked<SandboxResourceProfileService>;
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

    it('should return false when API key is missing', async () => {
      const mockConfigNoKey = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'codex.apiKey') return '';
          return defaultValue;
        }),
      };
      const sandboxMock = { isHealthy: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CodexProvider,
          { provide: ConfigService, useValue: mockConfigNoKey },
          { provide: SandboxService, useValue: sandboxMock },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
        ],
      }).compile();
      const p = module.get<CodexProvider>(CodexProvider);
      expect(await p.isHealthy()).toBe(false);
      expect(sandboxMock.isHealthy).not.toHaveBeenCalled();
    });

    it('should return false when sandbox is unhealthy', async () => {
      sandboxService.isHealthy.mockResolvedValueOnce(false);
      expect(await provider.isHealthy()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should run codex command in sandbox with correct env and resource limits', async () => {
      const result = await provider.execute(mockPayload);

      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'codex "$CODEX_PROMPT"',
          metadata: expect.objectContaining({
            providerName: ProviderName.CODEX,
            executionId: mockPayload.executionId,
            ticketId: mockPayload.ticketId,
          }),
        }),
      );

      const callArgs = sandboxService.runAgentCommand.mock.calls[0][0];
      expect(callArgs.env['OPENAI_API_KEY']).toBe('sk-codex-test-key');
      expect(callArgs.env['OPENAI_BASE_URL']).toBe('https://api.openai.com/v1');
      expect(callArgs.env['CODEX_MODEL']).toBe('codex-1');
      expect(callArgs.env['CODEX_PROMPT']).toBe(mockPayload.prompt);
      expect(callArgs.env['IS_SANDBOX']).toBeUndefined();

      expect(resourceProfileService.getProfile).toHaveBeenCalledWith(mockPayload.complexityScore);
      expect(callArgs.cpuLimit).toBe('2');
      expect(callArgs.memoryLimit).toBe('4Gi');

      expect(result.success).toBe(true);
      expect(result.codeDiff).toBe('Linked list implemented');
    });

    it('should omit OPENAI_BASE_URL when baseURL config is empty', async () => {
      const mockConfigNoBase = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          const config: Record<string, unknown> = {
            'ai.providers.codex.enabled': true,
            'codex.apiKey': 'sk-codex-test-key',
            'codex.baseURL': '',
            'codex.model': 'codex-1',
            'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
            'opensandbox.sandboxTimeoutS': 3600,
          };
          return config[key] ?? defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CodexProvider,
          { provide: ConfigService, useValue: mockConfigNoBase },
          {
            provide: SandboxService,
            useValue: { isHealthy: jest.fn(), runAgentCommand: sandboxService.runAgentCommand },
          },
          { provide: SandboxResourceProfileService, useValue: resourceProfileService },
        ],
      }).compile();
      const p = module.get<CodexProvider>(CodexProvider);
      await p.execute(mockPayload);

      const callArgs = sandboxService.runAgentCommand.mock.calls[0][0];
      expect(callArgs.env['OPENAI_BASE_URL']).toBeUndefined();
    });

    it('should default complexityScore to 5 when undefined', async () => {
      await provider.execute({ ...mockPayload, complexityScore: undefined });
      expect(resourceProfileService.getProfile).toHaveBeenCalledWith(5);
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
      expect(result.error?.isRetryable).toBe(true);
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
