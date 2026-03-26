/**
 * Gemini Provider Unit Tests
 * Story OS-4.2: Gemini CLI Provider
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { AIProvider } from '@/prisma/client';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { AIErrorCode } from '../interfaces/ai-provider.interface';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let sandboxService: jest.Mocked<SandboxService>;
  let resourceProfileService: jest.Mocked<SandboxResourceProfileService>;

  const mockPayload: IAIExecutionPayload = {
    ticketId: 'ticket-123',
    executionId: 'exec-456',
    aiProvider: AIProvider.GEMINI,
    priority: 1,
    prompt: 'Fix the bug in main.ts',
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
        stdout: 'Successfully fixed bug',
        stderr: '',
        durationMs: 1500,
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
          'ai.providers.gemini.enabled': true,
          'gemini.apiKey': 'gemini-test-key',
          'gemini.baseURL': 'http://localhost:11434',
          'gemini.model': 'gemini-2.5-pro',
          'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
          'opensandbox.sandboxTimeoutS': 3600,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SandboxService, useValue: mockSandboxService },
        { provide: SandboxResourceProfileService, useValue: mockResourceProfileService },
      ],
    }).compile();

    provider = module.get<GeminiProvider>(GeminiProvider);
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
      const mockConfigFalse = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'ai.providers.gemini.enabled') return false;
          const config: Record<string, unknown> = {
            'gemini.apiKey': 'gemini-test-key',
            'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
            'opensandbox.sandboxTimeoutS': 3600,
          };
          return config[key] ?? defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GeminiProvider,
          { provide: ConfigService, useValue: mockConfigFalse },
          {
            provide: SandboxService,
            useValue: { isHealthy: jest.fn(), runAgentCommand: jest.fn() },
          },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
        ],
      }).compile();
      const disabledProvider = module.get<GeminiProvider>(GeminiProvider);
      expect(disabledProvider.isEnabled).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should check API key and delegate to sandbox service', async () => {
      const result = await provider.isHealthy();
      expect(sandboxService.isHealthy).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      const mockConfigNoKey = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'gemini.apiKey') return '';
          return defaultValue;
        }),
      };
      const mockSandboxNoKey = { isHealthy: jest.fn().mockResolvedValue(true) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GeminiProvider,
          { provide: ConfigService, useValue: mockConfigNoKey },
          { provide: SandboxService, useValue: mockSandboxNoKey },
          { provide: SandboxResourceProfileService, useValue: { getProfile: jest.fn() } },
        ],
      }).compile();
      const noKeyProvider = module.get<GeminiProvider>(GeminiProvider);
      const result = await noKeyProvider.isHealthy();
      expect(result).toBe(false);
      expect(mockSandboxNoKey.isHealthy).not.toHaveBeenCalled();
    });

    it('should return false when sandbox service is unhealthy', async () => {
      sandboxService.isHealthy.mockResolvedValueOnce(false);
      const result = await provider.isHealthy();
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should use SandboxService to run gemini command', async () => {
      const result = await provider.execute(mockPayload);

      expect(resourceProfileService.getProfile).toHaveBeenCalledWith(8);
      expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-456',
          image: 'opensandbox/code-interpreter:v1.0.2',
          command: 'gemini "$GEMINI_PROMPT"',
          timeoutSeconds: 3600,
          cpuLimit: '2',
          memoryLimit: '4Gi',
          ticketId: 'ticket-123',
          metadata: {
            providerName: ProviderName.GEMINI,
            executionId: 'exec-456',
            ticketId: 'ticket-123',
          },
        }),
      );

      // Verify env vars
      const callArgs = sandboxService.runAgentCommand.mock.calls[0][0];
      expect(callArgs.env).toBeDefined();
      expect(callArgs.env['GEMINI_API_KEY']).toBe('gemini-test-key');
      expect(callArgs.env['GEMINI_BASE_URL']).toBe('http://localhost:11434');
      expect(callArgs.env['GEMINI_MODEL']).toBe('gemini-2.5-pro');
      expect(callArgs.env['IS_SANDBOX']).toBe('1');
      expect(callArgs.env['GEMINI_PROMPT']).toBe('Fix the bug in main.ts');

      expect(result.success).toBe(true);
      expect(result.codeDiff).toBe('Successfully fixed bug');
      expect(result.durationMs).toBe(1500);
    });

    it('should handle timeout errors correctly', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 124,
        stdout: '',
        stderr: 'Command timed out',
        durationMs: 3600000,
        timedOut: true,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
      expect(result.error?.isRetryable).toBe(true);
    });

    it('should handle process crash errors correctly', async () => {
      sandboxService.runAgentCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Segmentation fault',
        durationMs: 500,
        timedOut: false,
        sandboxId: 'sbx-123',
      });

      const result = await provider.execute(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
      expect(result.error?.isRetryable).toBe(false);
    });

    it('should default complexity score to 5 if not provided', async () => {
      await provider.execute({ ...mockPayload, complexityScore: undefined });
      expect(resourceProfileService.getProfile).toHaveBeenCalledWith(5);
    });

    it('should pass prompt via GEMINI_PROMPT env var and use fixed command string', async () => {
      const promptWithSpecialChars = 'Fix "bug" in main.ts and run $(echo dangerous)';
      await provider.execute({ ...mockPayload, prompt: promptWithSpecialChars });
      const callArgs = sandboxService.runAgentCommand.mock.calls[0][0];
      expect(callArgs.command).toBe('gemini "$GEMINI_PROMPT"');
      expect(callArgs.env['GEMINI_PROMPT']).toBe(promptWithSpecialChars);
    });

    it('should omit GEMINI_BASE_URL from env when config value is empty string', async () => {
      const mockConfigNoBaseURL = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          const config: Record<string, unknown> = {
            'ai.providers.gemini.enabled': true,
            'gemini.apiKey': 'gemini-test-key',
            'gemini.baseURL': '',
            'gemini.model': 'gemini-2.5-pro',
            'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
            'opensandbox.sandboxTimeoutS': 3600,
          };
          return config[key] ?? defaultValue;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GeminiProvider,
          { provide: ConfigService, useValue: mockConfigNoBaseURL },
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
        ],
      }).compile();
      const p = module.get<GeminiProvider>(GeminiProvider);
      await p.execute(mockPayload);
      const sb = module.get(SandboxService) as jest.Mocked<SandboxService>;
      const callArgs = sb.runAgentCommand.mock.calls[0][0];
      expect(callArgs.env['GEMINI_BASE_URL']).toBeUndefined();
    });
  });
});
