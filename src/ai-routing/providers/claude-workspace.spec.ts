/**
 * Claude Workspace Management Tests
 * Story 19.3: Autonomous Workspace Management
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeCodeProvider } from './claude-code.provider';
import { WorkspaceService } from './workspace.service';
import { PtyExecutionService } from '../services/pty-execution.service';
import { ExecutionTrackerService } from '../../execution/execution-tracker.service';
import { IAIExecutionInput, AIErrorCode } from '../interfaces';
import { Subject } from 'rxjs';

describe('ClaudeCodeProvider Workspace', () => {
  let provider: ClaudeCodeProvider;
  let workspaceService: jest.Mocked<WorkspaceService>;

  let ptyExecutionService: any;

  const mockInput: IAIExecutionInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Do something',
    repositoryUrl: 'https://github.com/test/repo.git',
    baseBranch: 'main',
  };

  beforeEach(async () => {
    const mockOutputSubject = new Subject<string>();
    const mockExitSubject = new Subject<{ exitCode: number; signal?: number }>();

    const mockPtyExecutionService = {
      spawnInContainer: jest.fn().mockImplementation(() => {
        setTimeout(() => {
          mockExitSubject.next({ exitCode: 0 });
          mockExitSubject.complete();
          mockOutputSubject.complete();
        }, 10);
        return {
          pid: 12345,
          output$: mockOutputSubject.asObservable(),
          exit$: mockExitSubject.asObservable(),
          containerId: 'container-123',
        };
      }),
      spawn: jest.fn(),
      write: jest.fn(),
      kill: jest.fn(),
      resize: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'anthropic.apiKey') return 'dummy-key';
        return defaultValue;
      }),
    };

    const mockWorkspaceServiceImpl = {
      createWorkspace: jest.fn(),
      updateWorkspaceStatus: jest.fn(),
      extractChanges: jest.fn().mockResolvedValue({ diff: '', filesChanged: [] }),
      cleanupWorkspace: jest.fn(),
    };

    const mockMetrics = {
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
        { provide: PtyExecutionService, useValue: mockPtyExecutionService },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: mockMetrics },
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

    provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    workspaceService = module.get(WorkspaceService);
    ptyExecutionService = module.get(PtyExecutionService);
    await provider.onModuleInit();
  });

  afterEach(async () => {
    if (provider) {
      await provider.onModuleDestroy();
    }
  });

  it('should fail if workspace path is missing', async () => {
    // Mock workspace creation returning empty path
    workspaceService.createWorkspace.mockResolvedValue({
      id: 'ws-123',
      path: '', // Empty path!
      status: 'READY',
      ticketId: 'ticket-789',
      executionId: 'exec-456',
      repositoryUrl: '',
      branchName: '',
      createdAt: new Date(),
    });

    const result = await provider.execute(mockInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(AIErrorCode.UNKNOWN);
    expect(result.error?.message).toContain('Workspace path is missing');
  }, 10000);

  it('should request workspace with correct parameters ensuring persistence', async () => {
    // Mock successful workspace creation
    workspaceService.createWorkspace.mockResolvedValue({
      id: 'ws-123',
      path: '/tmp/persistent-workspace',
      status: 'READY',
      ticketId: 'ticket-789',
      executionId: 'exec-456',
      repositoryUrl: 'https://github.com/test/repo.git',
      branchName: 'feature/ticket-789',
      createdAt: new Date(),
    });

    // First execution
    await provider.execute(mockInput);

    expect(workspaceService.createWorkspace).toHaveBeenCalledWith(
      mockInput.executionId,
      mockInput.ticketId,
      mockInput.repositoryUrl,
      mockInput.baseBranch,
      expect.any(Function),
      'CLAUDE_CODE',
    );

    // Verify PTY spawned in the correct path
    expect(ptyExecutionService.spawnInContainer).toHaveBeenCalled();
    const spawnCalls = ptyExecutionService.spawnInContainer.mock.calls;
    expect(spawnCalls[0][2].workspacePath).toBe('/tmp/persistent-workspace');
  });
});
