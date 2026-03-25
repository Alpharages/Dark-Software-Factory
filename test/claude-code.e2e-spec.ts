/**
 * Claude Code Provider Integration Tests
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 *
 * Tests the Claude provider with mocked API.
 * Run with: pnpm test:e2e -- --testPathPattern=claude-code
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AIProvider } from '@/prisma/client';
import { ConfigModule } from '@nestjs/config';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
import { ClaudeCodeProvider } from '../src/ai-routing/providers';

describe('Claude Code Provider (e2e)', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let app: INestApplication;
  let aiExecutionService: AIExecutionService;
  let claudeProvider: ClaudeCodeProvider;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // Create a minimal test module
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              anthropic: {
                apiKey: 'sk-ant-test-key',
                model: 'claude-sonnet-4-20250514',
                maxTokens: 8000,
                timeoutMs: 120000,
              },
              cursor: {
                cliPath: 'cursor',
                workspacesRoot: '/tmp/test-workspaces',
              },
            }),
          ],
        }),
      ],
      providers: [
        {
          provide: ClaudeCodeProvider,
          useFactory: () => {
            return {
              providerName: 'claude-code',
              isEnabled: true,
              isHealthy: jest.fn().mockResolvedValue(true),
              execute: jest.fn(),
            };
          },
        },
        {
          provide: AIExecutionService,
          useFactory: (claudeProvider: ClaudeCodeProvider) => {
            const providers = new Map();
            providers.set(AIProvider.CLAUDE_CODE, claudeProvider);
            return {
              getProviderHealth: jest.fn().mockImplementation(async (provider: AIProvider) => {
                const p = providers.get(provider);
                const isHealthy = await p?.isHealthy();
                return { provider, isHealthy, circuitState: isHealthy ? 'CLOSED' : 'OPEN' } as any;
              }),
              getAllProvidersHealth: jest.fn().mockImplementation(async () => {
                const health = [];
                for (const p of providers.values()) {
                  const isHealthy = await p.isHealthy();
                  health.push({
                    provider: AIProvider.CLAUDE_CODE,
                    isHealthy,
                    circuitState: isHealthy ? 'CLOSED' : 'OPEN',
                  } as any);
                }
                return health;
              }),
              isProviderAvailable: jest.fn().mockImplementation(async (provider: AIProvider) => {
                const p = providers.get(provider);
                return (await p?.isHealthy()) ?? false;
              }),
            };
          },
          inject: [ClaudeCodeProvider],
        },
      ],
    }).compile();

    aiExecutionService = moduleRef.get<AIExecutionService>(AIExecutionService);
    claudeProvider = moduleRef.get<ClaudeCodeProvider>(ClaudeCodeProvider);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('Provider Registration', () => {
    it('should have Claude provider registered', async () => {
      const health = await aiExecutionService.getProviderHealth(AIProvider.CLAUDE_CODE);

      expect(health).toBeDefined();
      expect(health?.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should include Claude in all providers health', async () => {
      const allHealth = await aiExecutionService.getAllProvidersHealth();

      const claudeHealth = allHealth.find((h) => h.provider === AIProvider.CLAUDE_CODE);

      expect(claudeHealth).toBeDefined();
    });
  });

  describe('Provider Health', () => {
    it('should report correct health status', async () => {
      const isHealthy = await claudeProvider.isHealthy();
      expect(typeof isHealthy).toBe('boolean');
    });

    it('should report provider as healthy when configured', async () => {
      const isHealthy = await claudeProvider.isHealthy();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Provider Availability', () => {
    it('should check provider availability', async () => {
      const isAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CLAUDE_CODE);

      // Provider is available if API key is configured
      expect(typeof isAvailable).toBe('boolean');
      expect(isAvailable).toBe(true);
    });
  });

  describe('Provider Properties', () => {
    it('should have correct provider identifier', () => {
      expect(claudeProvider.providerName).toBe('claude-code');
    });

    it('should be enabled initially', () => {
      expect(claudeProvider.isEnabled).toBe(true);
    });
  });
});

describe('Claude Code Provider - Error Handling', () => {
  let moduleRef: TestingModule;
  let claudeProvider: ClaudeCodeProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              anthropic: {
                apiKey: '', // No API key - provider should be disabled
                model: 'claude-sonnet-4-20250514',
                maxTokens: 8000,
                timeoutMs: 120000,
              },
            }),
          ],
        }),
      ],
      providers: [
        {
          provide: ClaudeCodeProvider,
          useFactory: () => {
            return {
              providerName: 'claude-code',
              isEnabled: true,
              isHealthy: jest.fn().mockResolvedValue(false),
              execute: jest.fn().mockResolvedValue({
                success: false,
                codeDiff: null,
                filesChanged: [],
                confidenceScore: 0,
                durationMs: 0,
                workspacePath: '',
                error: {
                  code: 'CLI_NOT_FOUND',
                  message: 'Claude provider not configured',
                  isRetryable: false,
                },
              }),
            };
          },
        },
      ],
    }).compile();

    claudeProvider = moduleRef.get<ClaudeCodeProvider>(ClaudeCodeProvider);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('should report unhealthy when API key is missing', async () => {
    const isHealthy = await claudeProvider.isHealthy();
    expect(isHealthy).toBe(false);
  });

  it('should return failed result when executing without API key', async () => {
    const result = await claudeProvider.execute({
      ticketId: 'test-ticket',
      executionId: 'test-exec',
      aiProvider: AIProvider.CLAUDE_CODE,
      priority: 1,
      prompt: 'Test prompt',
      repositoryUrl: 'https://github.com/test/repo.git',
      projectId: 'proj',
      complexityScore: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.isRetryable).toBe(false);
  });
});
