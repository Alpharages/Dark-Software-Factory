/**
 * AI Execution Service Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider } from '@/prisma/client';
import { AIExecutionService } from './ai-execution.service';
import { ClaudeCodeProvider } from './providers';
import { ExecutionService } from '@/execution/execution.service';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { IAIExecutionInput, IAIExecutionResult, AIErrorCode } from './interfaces';

describe('AIExecutionService', () => {
  let service: AIExecutionService;
  let claudeProvider: jest.Mocked<ClaudeCodeProvider>;
  let executionService: jest.Mocked<ExecutionService>;

  let _costTrackerService: jest.Mocked<AICostTrackerService>;

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
    // Removed Cursor provider mock

    const mockClaudeProvider = {
      providerName: 'claude-code',
      isEnabled: true,
      execute: jest.fn(),
      isHealthy: jest.fn(),
    };

    const mockExecutionService = {
      getExecution: jest.fn().mockResolvedValue({
        status: 'QUEUED',
        // Story 23.2: Container cleanup tracking
        container_id: null,
        debug_mode: false,
      }),
      isTerminal: jest.fn().mockReturnValue(false),
      markInProgress: jest.fn(),
      completeExecution: jest.fn(),
      failExecution: jest.fn(),
      cancelExecution: jest.fn(),
    };

    const mockCostTrackerService = {
      checkBudgetAvailability: jest.fn().mockResolvedValue({ allowed: true }),
      calculateUSD: jest.fn().mockReturnValue({ toNumber: () => 0.001 }),
      estimateCost: jest.fn().mockReturnValue({ toNumber: () => 0.001 }),
      logCost: jest.fn().mockResolvedValue(undefined),
      getCostStats: jest.fn().mockResolvedValue({
        totalCost: 0,
        projectBudget: 100,
        projectSpend: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionService,
        { provide: ClaudeCodeProvider, useValue: mockClaudeProvider },
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: AICostTrackerService, useValue: mockCostTrackerService },
      ],
    }).compile();

    service = module.get<AIExecutionService>(AIExecutionService);
    claudeProvider = module.get(ClaudeCodeProvider);
    executionService = module.get(ExecutionService);
    _costTrackerService = module.get(AICostTrackerService);
  });

  describe('executeWithProvider', () => {
    it('should execute successfully with Claude provider', async () => {
      claudeProvider.execute.mockResolvedValue(mockSuccessResult);

      const result = await service.executeWithProvider(AIProvider.CLAUDE_CODE, mockInput);

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
      claudeProvider.execute.mockResolvedValue(mockFailedResult);

      const result = await service.executeWithProvider(AIProvider.CLAUDE_CODE, mockInput);

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
      claudeProvider.execute.mockRejectedValue(new Error('Unexpected failure'));

      await expect(service.executeWithProvider(AIProvider.CLAUDE_CODE, mockInput)).rejects.toThrow(
        'Unexpected failure',
      );

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
      claudeProvider.isHealthy.mockResolvedValue(true);

      const health = await service.getProviderHealth(AIProvider.CLAUDE_CODE);

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
      claudeProvider.isHealthy.mockResolvedValue(true);

      const health = await service.getAllProvidersHealth();

      expect(health).toHaveLength(1);
      expect(health.map((h) => h.provider)).toContain(AIProvider.CLAUDE_CODE);
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution and cleanup', async () => {
      await service.cancelExecution(
        AIProvider.CLAUDE_CODE,
        mockInput.executionId,
        mockInput.correlationId,
      );

      // expect(claudeProvider.cancel).toHaveBeenCalledWith(mockInput.executionId); // Not supported currently
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        mockInput.executionId,
        'Cancelled by user',
        mockInput.correlationId,
      );
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when provider is healthy', async () => {
      claudeProvider.isHealthy.mockResolvedValue(true);

      const available = await service.isProviderAvailable(AIProvider.CLAUDE_CODE);
      expect(available).toBe(true);
    });

    it('should return false when provider is unhealthy', async () => {
      claudeProvider.isHealthy.mockResolvedValue(false);

      const available = await service.isProviderAvailable(AIProvider.CLAUDE_CODE);
      expect(available).toBe(false);
    });

    it('should return false for unregistered provider', async () => {
      const available = await service.isProviderAvailable('UNKNOWN' as AIProvider);
      expect(available).toBe(false);
    });
  });
});
