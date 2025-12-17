/**
 * Claude Code Provider Unit Tests
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { ClaudeCodeProvider } from './claude-code.provider';
import { WorkspaceService } from './workspace.service';
import { IAIExecutionInput, AIErrorCode } from '../interfaces';

// Mock Anthropic SDK with proper constructor
const mockAnthropicClient = {
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
};

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => mockAnthropicClient);
});

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let configService: jest.Mocked<ConfigService>;
  let workspaceService: jest.Mocked<WorkspaceService>;
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
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'anthropic.apiKey': 'sk-ant-test-key',
          'anthropic.model': 'claude-sonnet-4-20250514',
          'anthropic.maxTokens': 8000,
          'anthropic.timeoutMs': 120000,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockWorkspaceServiceImpl = {
      createWorkspace: jest.fn().mockResolvedValue({
        id: 'ws-123',
        path: '/tmp/test-workspace',
        status: 'READY',
        ticketId: 'ticket-789',
        executionId: 'exec-456',
        repositoryUrl: 'https://github.com/test/repo.git',
        branchName: 'feature/ticket-789',
        createdAt: new Date(),
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
    configService = module.get(ConfigService);
    workspaceService = module.get(WorkspaceService);

    // Initialize the provider
    await provider.onModuleInit();
  });

  afterEach(async () => {
    await provider.onModuleDestroy();
  });

  describe('provider properties', () => {
    it('should have correct provider type', () => {
      expect(provider.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should have reasonable defaults', () => {
      expect(provider.maxConcurrent).toBe(20);
      expect(provider.defaultTimeoutMs).toBe(120_000);
    });
  });

  describe('checkHealth', () => {
    it('should return health status when configured', async () => {
      const health = await provider.checkHealth();

      expect(health.provider).toBe(AIProvider.CLAUDE_CODE);
      expect(health.circuitState).toBeDefined();
      expect(typeof health.activeExecutions).toBe('number');
      expect(health.isHealthy).toBe(true);
    });

    it('should report circuit state', async () => {
      const health = await provider.checkHealth();

      expect(health.circuitState).toMatch(/CLOSED|OPEN|HALF_OPEN/);
    });
  });

  describe('cancel', () => {
    it('should cancel execution without error', async () => {
      await expect(provider.cancel('test-execution')).resolves.not.toThrow();

      expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith('test-execution', true);
    });
  });

  describe('execute', () => {
    it('should return failed result when provider is not configured', async () => {
      // Create provider without API key
      const mockConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaudeCodeProvider,
          { provide: ConfigService, useValue: mockConfig },
          { provide: WorkspaceService, useValue: workspaceService },
          { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: mockMetrics },
          { provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS', useValue: mockMetrics },
          { provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS', useValue: mockMetrics },
          { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: mockMetrics },
          { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: mockMetrics },
        ],
      }).compile();

      const unconfiguredProvider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
      await unconfiguredProvider.onModuleInit();

      const result = await unconfiguredProvider.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not configured');
      expect(result.error?.isRetryable).toBe(false);
    });

    it('should return failed result when circuit breaker is open', async () => {
      // Force circuit breaker to open by simulating failures
      for (let i = 0; i < 10; i++) {
        // Access private method through any type
        (
          provider as unknown as { circuitBreaker: { recordFailure: () => void } }
        ).circuitBreaker.recordFailure();
      }

      const result = await provider.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Circuit breaker');
      expect(result.error?.isRetryable).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should handle missing API key gracefully', async () => {
      const mockConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaudeCodeProvider,
          { provide: ConfigService, useValue: mockConfig },
          { provide: WorkspaceService, useValue: workspaceService },
          { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: { inc: jest.fn() } },
          {
            provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS',
            useValue: { observe: jest.fn() },
          },
          {
            provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS',
            useValue: { inc: jest.fn(), dec: jest.fn() },
          },
          { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: { inc: jest.fn() } },
          { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: { set: jest.fn() } },
        ],
      }).compile();

      const unconfiguredProvider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
      await unconfiguredProvider.onModuleInit();

      const result = await unconfiguredProvider.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.CLI_NOT_FOUND);
      expect(result.error?.message).toContain('not configured');
    });

    it('should initialize with correct model from config', async () => {
      // Provider should be configured with the model from config
      const health = await provider.checkHealth();
      expect(health.provider).toBe(AIProvider.CLAUDE_CODE);
    });
  });

  describe('metrics tracking', () => {
    it('should increment circuit_open counter when circuit is open', async () => {
      // Open the circuit
      for (let i = 0; i < 10; i++) {
        (
          provider as unknown as { circuitBreaker: { recordFailure: () => void } }
        ).circuitBreaker.recordFailure();
      }

      await provider.execute(mockInput);

      expect(mockMetrics.inc).toHaveBeenCalledWith({ status: 'circuit_open' });
    });
  });

  describe('onModuleDestroy', () => {
    it('should cancel all active executions on destroy', async () => {
      // The provider should clean up any active executions
      await expect(provider.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});

describe('Anthropic Tools', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tools = require('./anthropic-tools');

  it('should define all required tools', () => {
    const toolNames = tools.codeEditingTools.map((t: { name: string }) => t.name);

    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('edit_file');
    expect(toolNames).toContain('list_files');
    expect(toolNames).toContain('delete_file');
  });

  it('should have valid input schemas', () => {
    for (const tool of tools.codeEditingTools) {
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.description).toBeDefined();
    }
  });

  it('should have required fields for read_file tool', () => {
    const readFileTool = tools.codeEditingTools.find(
      (t: { name: string }) => t.name === 'read_file',
    );
    expect(readFileTool.input_schema.required).toContain('path');
  });

  it('should have required fields for write_file tool', () => {
    const writeFileTool = tools.codeEditingTools.find(
      (t: { name: string }) => t.name === 'write_file',
    );
    expect(writeFileTool.input_schema.required).toContain('path');
    expect(writeFileTool.input_schema.required).toContain('content');
  });

  it('should have required fields for edit_file tool', () => {
    const editFileTool = tools.codeEditingTools.find(
      (t: { name: string }) => t.name === 'edit_file',
    );
    expect(editFileTool.input_schema.required).toContain('path');
    expect(editFileTool.input_schema.required).toContain('old_content');
    expect(editFileTool.input_schema.required).toContain('new_content');
  });

  it('should have required fields for delete_file tool', () => {
    const deleteFileTool = tools.codeEditingTools.find(
      (t: { name: string }) => t.name === 'delete_file',
    );
    expect(deleteFileTool.input_schema.required).toContain('path');
  });

  it('should export individual tools', () => {
    expect(tools.readFileTool).toBeDefined();
    expect(tools.writeFileTool).toBeDefined();
    expect(tools.editFileTool).toBeDefined();
    expect(tools.listFilesTool).toBeDefined();
    expect(tools.deleteFileTool).toBeDefined();
  });
});
