/**
 * AI Execution Integration Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Tests the full AI execution flow with mocked Cursor CLI.
 * Run with: pnpm test:e2e -- --testPathPattern=ai-execution
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIProvider } from '@/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import {
  makeGaugeProvider,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
// WorkspaceService removed (handled by OpenSandbox TTL)
import { GitOperationsService } from '../src/ai-routing/providers/git-operations.service';
import { ClaudeCodeProvider } from '../src/ai-routing/providers';
import { ExecutionService } from '../src/execution/execution.service';
import { AICostTrackerService } from '../src/cost-tracking/ai-cost-tracker.service';
import { StorageManagerService } from '../src/storage/storage-manager.service';

describe('AI Execution (e2e)', () => {
  let app: INestApplication;
  let aiExecutionService: AIExecutionService;
  // WorkspaceService removed (handled by OpenSandbox TTL)

  // Mock services
  const mockExecutionService = {
    markInProgress: jest.fn().mockResolvedValue({}),
    completeExecution: jest.fn().mockResolvedValue({}),
    failExecution: jest.fn().mockResolvedValue({}),
    cancelExecution: jest.fn().mockResolvedValue({}),
  };

  const mockGitService = {
    clone: jest.fn().mockResolvedValue(undefined),
    configureUser: jest.fn().mockResolvedValue(undefined),
    checkoutBranch: jest.fn().mockResolvedValue(undefined),
    getDiff: jest.fn().mockResolvedValue(''),
    getChangedFiles: jest.fn().mockResolvedValue([]),
  };

  const mockClaudeProvider = {
    execute: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    checkHealth: jest.fn().mockResolvedValue({ isHealthy: true }),
    cancel: jest.fn(),
  };

  const mockPrismaService = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb) =>
      cb({
        execution: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          groupBy: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue(null),
          groupBy: jest.fn().mockResolvedValue([]),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
        },
        aIDecisionLog: {
          create: jest.fn().mockResolvedValue({ id: 'decision-log-1' }),
        },
        fileLock: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        qaResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        qAResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }),
    ),
  };

  const mockCostTracker = {
    logCost: jest.fn().mockResolvedValue({}),
  };

  const mockStorageManager = {
    ensureWorkspace: jest.fn().mockResolvedValue('/tmp/workspace'),
    cleanupWorkspace: jest.fn().mockResolvedValue(undefined),
    getWorkspaceSize: jest.fn().mockResolvedValue(0),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              ai: {
                providers: {
                  claudeCode: {
                    enabled: true,
                    maxConcurrent: 5,
                    timeout: 300000,
                  },
                },
              },
            }),
          ],
        }),
      ],
      providers: [
        AIExecutionService,
        // WorkspaceService removed (handled by OpenSandbox TTL)
        // CursorHeadlessProvider removed
        { provide: ClaudeCodeProvider, useValue: mockClaudeProvider },
        { provide: GitOperationsService, useValue: mockGitService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: AICostTrackerService, useValue: mockCostTracker },
        { provide: StorageManagerService, useValue: mockStorageManager },
        // Metrics providers
        makeGaugeProvider({
          name: 'cursor_workspaces_active',
          help: 'Test metric',
        }),
        makeCounterProvider({
          name: 'cursor_workspace_operations_total',
          help: 'Test metric',
          labelNames: ['operation', 'status'],
        }),
        makeCounterProvider({
          name: 'cursor_executions_total',
          help: 'Test metric',
          labelNames: ['status'],
        }),
        makeHistogramProvider({
          name: 'cursor_execution_duration_seconds',
          help: 'Test metric',
          labelNames: ['status'],
        }),
        makeGaugeProvider({
          name: 'cursor_active_executions',
          help: 'Test metric',
        }),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    aiExecutionService = app.get<AIExecutionService>(AIExecutionService);
    // WorkspaceService removed (handled by OpenSandbox TTL)
  });

  afterAll(async () => {
    // Workspace management handled by OpenSandbox SDK
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Provider Health', () => {
    it('should report Claude provider health', async () => {
      const health = await aiExecutionService.getProviderHealth(AIProvider.CLAUDE_CODE);

      expect(health).toBeDefined();
      expect(health?.provider).toBe(AIProvider.CLAUDE_CODE);
      expect(health?.circuitState).toBeDefined();
    });

    it('should return all providers health', async () => {
      const health = await aiExecutionService.getAllProvidersHealth();

      expect(health).toBeInstanceOf(Array);
      expect(health.length).toBeGreaterThan(0);
    });

    it('should check provider availability', async () => {
      const isAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CLAUDE_CODE);
      expect(typeof isAvailable).toBe('boolean');
    });
  });

  // Workspace management handled by OpenSandbox SDK (TTL-based)

  describe('Execution Cancellation', () => {
    it('should cancel execution gracefully', async () => {
      const executionId = 'cancel-test-exec';

      await expect(
        aiExecutionService.cancelExecution(
          AIProvider.CLAUDE_CODE,
          executionId,
          'test-correlation-id',
        ),
      ).resolves.not.toThrow();

      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith(
        executionId,
        'Cancelled by user',
        'test-correlation-id',
      );
    });
  });

  describe('Provider Registration', () => {
    it('should have Claude Code provider registered', async () => {
      const health = await aiExecutionService.getProviderHealth(AIProvider.CLAUDE_CODE);
      expect(health).not.toBeNull();
    });

    it('should return null for unregistered provider', async () => {
      const health = await aiExecutionService.getProviderHealth('UNKNOWN' as AIProvider);
      expect(health).toBeNull();
    });
  });
});
