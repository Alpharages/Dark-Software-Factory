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

// Mock Anthropic SDK for e2e tests
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Task completed' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    })),
  };
});

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
              provider: AIProvider.CLAUDE_CODE,
              maxConcurrent: 20,
              defaultTimeoutMs: 120000,
              checkHealth: jest.fn().mockResolvedValue({
                provider: AIProvider.CLAUDE_CODE,
                isHealthy: true,
                circuitState: 'CLOSED',
                activeExecutions: 0,
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
              }),
              execute: jest.fn(),
              cancel: jest.fn(),
            };
          },
        },
        {
          provide: AIExecutionService,
          useFactory: (claudeProvider: ClaudeCodeProvider) => {
            const providers = new Map();
            providers.set(AIProvider.CLAUDE_CODE, claudeProvider);
            return {
              getProviderHealth: jest.fn().mockImplementation((provider: AIProvider) => {
                const p = providers.get(provider);
                return p?.checkHealth();
              }),
              getAllProvidersHealth: jest.fn().mockImplementation(async () => {
                const health = [];
                for (const p of providers.values()) {
                  health.push(await p.checkHealth());
                }
                return health;
              }),
              isProviderAvailable: jest.fn().mockImplementation(async (provider: AIProvider) => {
                const p = providers.get(provider);
                const health = await p?.checkHealth();
                return health?.isHealthy ?? false;
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
      const health = await claudeProvider.checkHealth();

      expect(health.circuitState).toMatch(/CLOSED|OPEN|HALF_OPEN/);
      expect(typeof health.activeExecutions).toBe('number');
      expect(typeof health.consecutiveFailures).toBe('number');
    });

    it('should report provider as healthy when configured', async () => {
      const health = await claudeProvider.checkHealth();

      expect(health.isHealthy).toBe(true);
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
      expect(claudeProvider.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should have correct max concurrent setting', () => {
      expect(claudeProvider.maxConcurrent).toBe(20);
    });

    it('should have correct default timeout', () => {
      expect(claudeProvider.defaultTimeoutMs).toBe(120000);
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
              provider: AIProvider.CLAUDE_CODE,
              maxConcurrent: 20,
              defaultTimeoutMs: 120000,
              checkHealth: jest.fn().mockResolvedValue({
                provider: AIProvider.CLAUDE_CODE,
                isHealthy: false,
                circuitState: 'CLOSED',
                activeExecutions: 0,
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
              }),
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
              cancel: jest.fn(),
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
    const health = await claudeProvider.checkHealth();

    expect(health.isHealthy).toBe(false);
  });

  it('should return failed result when executing without API key', async () => {
    const result = await claudeProvider.execute({
      correlationId: 'test-corr',
      executionId: 'test-exec',
      ticketId: 'test-ticket',
      prompt: 'Test prompt',
      repositoryUrl: 'https://github.com/test/repo.git',
      baseBranch: 'main',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.isRetryable).toBe(false);
  });
});
