/**
 * AI Execution Service Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider } from '@/prisma/client';
import { AIExecutionService } from './ai-execution.service';
import { CursorHeadlessProvider, ClaudeCodeProvider } from './providers';
import { ExecutionService } from '../execution/execution.service';
import { IAIExecutionInput, IAIExecutionResult, AIErrorCode } from './interfaces';

describe('AIExecutionService', () => {
  let service: AIExecutionService;
  let cursorProvider: jest.Mocked<CursorHeadlessProvider>;
  let claudeProvider: jest.Mocked<ClaudeCodeProvider>;
  let executionService: jest.Mocked<ExecutionService>;

  const mockInput: IAIExecutionInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Test prompt',
    repositoryUrl: 'https://github.com/test/repo.git',
    baseBranch: 'main',
  };

  const mockSuccessResult: IAIExecutionResult = {
    success: true,
    codeDiff: 'diff --git a/file.ts b/file.ts\n...',
    filesChanged: ['src/file.ts'],
    confidenceScore: 0.85,
    durationMs: 30000,
    workspacePath: '/tmp/cursor-workspaces/ticket-789-1234567890',
  };

  const mockFailedResult: IAIExecutionResult = {
    success: false,
    codeDiff: null,
    filesChanged: [],
    confidenceScore: 0,
    durationMs: 5000,
    workspacePath: '/tmp/cursor-workspaces/ticket-789-1234567890',
    error: {
      code: AIErrorCode.TIMEOUT,
      message: 'Execution timed out',
      isRetryable: true,
    },
  };

  beforeEach(async () => {
    const mockCursorProvider = {
      provider: AIProvider.CURSOR_HEADLESS,
      maxConcurrent: 10,
      defaultTimeoutMs: 300000,
      execute: jest.fn(),
      checkHealth: jest.fn(),
      cancel: jest.fn(),
    };

    const mockClaudeProvider = {
      provider: AIProvider.CLAUDE_CODE,
      maxConcurrent: 20,
      defaultTimeoutMs: 120000,
      execute: jest.fn(),
      checkHealth: jest.fn(),
      cancel: jest.fn(),
    };

    const mockExecutionService = {
      getExecution: jest.fn().mockResolvedValue({ status: 'QUEUED' }),
      isTerminal: jest.fn().mockReturnValue(false),
      markInProgress: jest.fn(),
      completeExecution: jest.fn(),
      failExecution: jest.fn(),
      cancelExecution: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionService,
        { provide: CursorHeadlessProvider, useValue: mockCursorProvider },
        { provide: ClaudeCodeProvider, useValue: mockClaudeProvider },
        { provide: ExecutionService, useValue: mockExecutionService },
      ],
    }).compile();

    service = module.get<AIExecutionService>(AIExecutionService);
    cursorProvider = module.get(CursorHeadlessProvider);
    claudeProvider = module.get(ClaudeCodeProvider);
    executionService = module.get(ExecutionService);
  });

  describe('executeWithProvider', () => {
    it('should execute successfully with Cursor provider', async () => {
      cursorProvider.execute.mockResolvedValue(mockSuccessResult);

      const result = await service.executeWithProvider(AIProvider.CURSOR_HEADLESS, mockInput);

      expect(result.success).toBe(true);
      expect(result.filesChanged).toEqual(['src/file.ts']);
      expect(executionService.markInProgress).toHaveBeenCalledWith(
        mockInput.executionId,
        mockInput.correlationId,
      );
      expect(executionService.completeExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: mockInput.executionId,
          filesChanged: mockSuccessResult.filesChanged,
          confidenceScore: mockSuccessResult.confidenceScore,
        }),
        mockInput.correlationId,
      );
    });

    it('should handle failed execution', async () => {
      cursorProvider.execute.mockResolvedValue(mockFailedResult);

      const result = await service.executeWithProvider(AIProvider.CURSOR_HEADLESS, mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
      expect(executionService.failExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: mockInput.executionId,
          errorMessage: 'Execution timed out',
        }),
        mockInput.correlationId,
        true, // isRetryable
      );
    });

    it('should throw for unregistered provider', async () => {
      await expect(service.executeWithProvider('UNKNOWN' as AIProvider, mockInput)).rejects.toThrow(
        'Provider not registered',
      );
    });

    it('should handle unexpected errors', async () => {
      cursorProvider.execute.mockRejectedValue(new Error('Unexpected failure'));

      await expect(
        service.executeWithProvider(AIProvider.CURSOR_HEADLESS, mockInput),
      ).rejects.toThrow('Unexpected failure');

      expect(executionService.failExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: mockInput.executionId,
          errorMessage: 'Unexpected failure',
          errorCode: AIErrorCode.UNKNOWN,
        }),
        mockInput.correlationId,
        true,
      );
    });
  });

  describe('getProviderHealth', () => {
    it('should return health for registered provider', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health?.isHealthy).toBe(true);
      expect(health?.circuitState).toBe('CLOSED');
    });

    it('should return null for unregistered provider', async () => {
      const health = await service.getProviderHealth('UNKNOWN' as AIProvider);
      expect(health).toBeNull();
    });
  });

  describe('getAllProvidersHealth', () => {
    it('should return health for all registered providers', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      claudeProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      const health = await service.getAllProvidersHealth();

      expect(health).toHaveLength(2);
      expect(health.map((h) => h.provider)).toContain(AIProvider.CURSOR_HEADLESS);
      expect(health.map((h) => h.provider)).toContain(AIProvider.CLAUDE_CODE);
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution and cleanup', async () => {
      await service.cancelExecution(
        AIProvider.CURSOR_HEADLESS,
        mockInput.executionId,
        mockInput.correlationId,
      );

      expect(cursorProvider.cancel).toHaveBeenCalledWith(mockInput.executionId);
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        mockInput.executionId,
        'Cancelled by user',
        mockInput.correlationId,
      );
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when provider is healthy', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      });

      const available = await service.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
      expect(available).toBe(true);
    });

    it('should return false when circuit is open', async () => {
      cursorProvider.checkHealth.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: false,
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        consecutiveFailures: 5,
        circuitState: 'OPEN',
        activeExecutions: 0,
      });

      const available = await service.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
      expect(available).toBe(false);
    });

    it('should return false for unregistered provider', async () => {
      const available = await service.isProviderAvailable('UNKNOWN' as AIProvider);
      expect(available).toBe(false);
    });
  });
});
