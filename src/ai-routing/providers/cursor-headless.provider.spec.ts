/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CursorHeadlessProvider } from './cursor-headless.provider';
import { WorkspaceService } from './workspace.service';
import { PtyExecutionService } from '../services/pty-execution.service';
import { ExecutionTrackerService } from '../../execution/execution-tracker.service';
import { AIErrorCode } from '../interfaces';
import { AIProvider } from '@/prisma/client';
import { Subject, ReplaySubject } from 'rxjs';

describe('CursorHeadlessProvider', () => {
  let provider: CursorHeadlessProvider;
  let workspace: jest.Mocked<WorkspaceService>;
  let ptyService: jest.Mocked<PtyExecutionService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();

    workspace = {
      createWorkspace: jest.fn(),
      updateWorkspaceStatus: jest.fn(),
      extractChanges: jest.fn(),
    } as any;

    ptyService = {
      spawn: jest.fn(),
      spawnInContainer: jest.fn(),
      kill: jest.fn(),
      write: jest.fn(),
    } as any;

    config = {
      get: jest.fn().mockImplementation((key, defaultValue) => defaultValue),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CursorHeadlessProvider,
        { provide: ConfigService, useValue: config },
        { provide: WorkspaceService, useValue: workspace },
        { provide: PtyExecutionService, useValue: ptyService },
        { provide: 'PROM_METRIC_CURSOR_EXECUTIONS_TOTAL', useValue: { inc: jest.fn() } },
        {
          provide: 'PROM_METRIC_CURSOR_EXECUTION_DURATION_SECONDS',
          useValue: { observe: jest.fn() },
        },
        {
          provide: 'PROM_METRIC_CURSOR_ACTIVE_EXECUTIONS',
          useValue: { inc: jest.fn(), dec: jest.fn() },
        },
        {
          provide: ExecutionTrackerService,
          useValue: {
            emitProgress: jest.fn().mockResolvedValue(undefined),
            emitActivity: jest.fn().mockResolvedValue(undefined),
            emitImmediateLog: jest.fn(),
          },
        },
      ],
    }).compile();

    provider = module.get<CursorHeadlessProvider>(CursorHeadlessProvider);

    // Mock ptyService.spawnInContainer for checkCliAvailability during onModuleInit
    const versionOutput$ = new ReplaySubject<string>(1);
    const versionExit$ = new ReplaySubject<{ exitCode: number }>(1);
    ptyService.spawnInContainer.mockResolvedValue({
      pid: 999,
      output$: versionOutput$.asObservable(),
      exit$: versionExit$.asObservable(),
      containerId: 'container-999',
    } as any);

    const initPromise = provider.onModuleInit();
    versionOutput$.next('version 1.0.0');
    versionExit$.next({ exitCode: 0 });
    await initPromise;

    // @ts-expect-error
    provider.isCliAvailable = true;
  });

  describe('execute', () => {
    it('should execute cursor CLI using PTY service with environment variables', async () => {
      const input = {
        correlationId: 'test-corr',
        executionId: 'test-exec',
        ticketId: 'test-ticket',
        prompt: 'test prompt',
        repositoryUrl: 'test-repo',
      };

      workspace.createWorkspace.mockResolvedValue({ path: '/tmp/workspace' } as any);
      workspace.extractChanges.mockResolvedValue({ diff: 'test-diff', filesChanged: ['file1.ts'] });

      const output$ = new ReplaySubject<string>(1);
      const exit$ = new ReplaySubject<{ exitCode: number }>(1);
      ptyService.spawnInContainer.mockResolvedValue({
        pid: 123,
        output$: output$.asObservable(),
        exit$: exit$.asObservable(),
        containerId: 'container-123',
        resize: jest.fn(),
        write: jest.fn(),
        kill: jest.fn(),
      } as any);

      const promise = provider.execute(input);
      output$.next('output data');
      exit$.next({ exitCode: 0 });

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.codeDiff).toBe('test-diff');
    });

    it('should handle PTY exit with error', async () => {
      const input = {
        correlationId: 'test-corr',
        executionId: 'test-exec',
        ticketId: 'test-ticket',
        prompt: 'test prompt',
        repositoryUrl: 'test-repo',
      };

      workspace.createWorkspace.mockResolvedValue({ path: '/tmp/workspace' } as any);

      const output$ = new ReplaySubject<string>(1);
      const exit$ = new ReplaySubject<{ exitCode: number }>(1);
      ptyService.spawnInContainer.mockResolvedValue({
        pid: 123,
        output$: output$.asObservable(),
        exit$: exit$.asObservable(),
        containerId: 'container-123',
        resize: jest.fn(),
        write: jest.fn(),
        kill: jest.fn(),
      } as any);

      const promise = provider.execute(input);
      exit$.next({ exitCode: 1 });

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AIErrorCode.PROCESS_CRASH);
    });

    it.skip('should handle timeout correctly', async () => {
      jest.useFakeTimers();
      try {
        const input = {
          correlationId: 'test-corr',
          executionId: 'test-exec',
          ticketId: 'test-ticket',
          prompt: 'test prompt',
          repositoryUrl: 'test-repo',
          timeoutMs: 1000,
        };

        workspace.createWorkspace.mockResolvedValue({ path: '/tmp/workspace' } as any);

        const output$ = new Subject<string>();
        const exit$ = new Subject<{ exitCode: number }>();
        ptyService.spawn.mockReturnValue({
          pid: 123,
          output$: output$.asObservable(),
          exit$: exit$.asObservable(),
        });

        const promise = provider.execute(input);

        jest.advanceTimersByTime(1100);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(AIErrorCode.TIMEOUT);
        expect(ptyService.kill).toHaveBeenCalledWith(123, 'SIGTERM');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('executePrompt', () => {
    it('should execute a standalone prompt', async () => {
      const input = {
        workspacePath: '/tmp/workspace',
        prompt: 'explain this code',
      };

      const output$ = new ReplaySubject<string>(1);
      const exit$ = new ReplaySubject<{ exitCode: number }>(1);
      ptyService.spawnInContainer.mockResolvedValue({
        pid: 456,
        output$: output$.asObservable(),
        exit$: exit$.asObservable(),
        containerId: 'container-456',
        resize: jest.fn(),
        write: jest.fn(),
        kill: jest.fn(),
      } as any);

      const promise = provider.executePrompt(input);
      output$.next('This code does X');
      exit$.next({ exitCode: 0 });

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.response).toContain('This code does X');
    });
  });

  describe('checkHealth', () => {
    it('should return healthy status when CLI is available', async () => {
      const status = await provider.checkHealth();
      expect(status.isHealthy).toBe(true);
      expect(status.provider).toBe(AIProvider.CURSOR_HEADLESS);
    });

    it('should return unhealthy if circuit breaker is open', async () => {
      // @ts-ignore
      provider.circuitBreaker.recordFailure();
      // @ts-ignore
      provider.circuitBreaker.recordFailure();
      // @ts-ignore
      provider.circuitBreaker.recordFailure();
      // @ts-expect-error
      provider.circuitBreaker.recordFailure();
      // @ts-expect-error
      provider.circuitBreaker.recordFailure();

      const status = await provider.checkHealth();
      expect(status.isHealthy).toBe(false);
      expect(status.circuitState).toBe('OPEN');
    });
  });

  describe('cancel', () => {
    it('should kill active PTY process', async () => {
      const executionId = 'test-exec';
      // @ts-expect-error - access private property
      provider.activeExecutions.set(executionId, 123);

      await provider.cancel(executionId);

      expect(ptyService.kill).toHaveBeenCalledWith(123, 'SIGTERM');
    });
  });
});
