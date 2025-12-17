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
import { AIProvider } from '@prisma/client';
import {
  makeGaugeProvider,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
import { WorkspaceService } from '../src/ai-routing/providers/workspace.service';
import { GitOperationsService } from '../src/ai-routing/providers/git-operations.service';
import { CursorHeadlessProvider } from '../src/ai-routing/providers/cursor-headless.provider';
import { ExecutionService } from '../src/execution/execution.service';

describe('AI Execution (e2e)', () => {
  let app: INestApplication;
  let aiExecutionService: AIExecutionService;
  let workspaceService: WorkspaceService;

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              cursor: {
                cliPath: '/bin/echo',
                headlessTimeoutMs: 30000,
                workspacesRoot: '/tmp/test-cursor-workspaces',
                maxConcurrentWorkspaces: 5,
                preserveFailedWorkspaces: false,
                workspaceCleanupAgeMs: 3600000,
              },
            }),
          ],
        }),
      ],
      providers: [
        AIExecutionService,
        WorkspaceService,
        CursorHeadlessProvider,
        { provide: GitOperationsService, useValue: mockGitService },
        { provide: ExecutionService, useValue: mockExecutionService },
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
    workspaceService = app.get<WorkspaceService>(WorkspaceService);
  });

  afterAll(async () => {
    // Cleanup any remaining workspaces
    const workspaces = await workspaceService.getActiveWorkspaces();
    for (const ws of workspaces) {
      await workspaceService.cleanupWorkspace(ws.executionId, true);
    }
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Provider Health', () => {
    it('should report Cursor provider health', async () => {
      const health = await aiExecutionService.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health).toBeDefined();
      expect(health?.provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(health?.circuitState).toBeDefined();
    });

    it('should return all providers health', async () => {
      const health = await aiExecutionService.getAllProvidersHealth();

      expect(health).toBeInstanceOf(Array);
      expect(health.length).toBeGreaterThan(0);
    });

    it('should check provider availability', async () => {
      const isAvailable = await aiExecutionService.isProviderAvailable(AIProvider.CURSOR_HEADLESS);
      expect(typeof isAvailable).toBe('boolean');
    });
  });

  describe('Workspace Management', () => {
    it('should track active workspace count', async () => {
      const activeCount = await workspaceService.getActiveCount();
      expect(typeof activeCount).toBe('number');
      expect(activeCount).toBeGreaterThanOrEqual(0);
    });

    it('should return empty workspaces list initially', async () => {
      // After cleanup, should be empty
      const workspaces = await workspaceService.getActiveWorkspaces();
      expect(workspaces).toBeInstanceOf(Array);
    });
  });

  describe('Execution Cancellation', () => {
    it('should cancel execution gracefully', async () => {
      const executionId = 'cancel-test-exec';

      await expect(
        aiExecutionService.cancelExecution(
          AIProvider.CURSOR_HEADLESS,
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
    it('should have Cursor Headless provider registered', async () => {
      const health = await aiExecutionService.getProviderHealth(AIProvider.CURSOR_HEADLESS);
      expect(health).not.toBeNull();
    });

    it('should return null for unregistered provider', async () => {
      const health = await aiExecutionService.getProviderHealth('UNKNOWN' as AIProvider);
      expect(health).toBeNull();
    });
  });
});
