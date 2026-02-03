import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PtyExecutionService } from './pty-execution.service';
import { DockerService } from '@/docker/docker.service';
import { WorkspaceService } from '@/docker/workspace.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import * as pty from 'node-pty';

// Mock node-pty
jest.mock('node-pty', () => {
  return {
    spawn: jest.fn(),
  };
});

// Mock DockerService
const mockDockerService = {
  isConnected: jest.fn(),
  runContainer: jest.fn(),
  killContainer: jest.fn(),
  waitForContainer: jest.fn(),
  getDocker: jest.fn(),
};

// Mock WorkspaceService
const mockWorkspaceService = {
  createWorkspace: jest.fn(),
};

// Mock ExecutionTrackerService
const mockExecutionTrackerService = {
  assignContainer: jest.fn().mockResolvedValue(undefined),
};

// Mock ConfigService
const mockConfigService = {
  get: jest.fn(),
};

describe('PtyExecutionService', () => {
  let service: PtyExecutionService;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    (pty.spawn as jest.Mock).mockImplementation(() => {
      return {
        pid: Math.floor(Math.random() * 10000) + 1,
        onData: jest.fn(),
        onExit: jest.fn(),
        write: jest.fn(),
        resize: jest.fn(),
        kill: jest.fn(),
      };
    });

    mockConfigService.get.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === 'ENABLE_CONTAINER_EXECUTION') return false;
      if (key === 'DOCKER_CONTAINER_TIMEOUT_MS') return 300000;
      return defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtyExecutionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DockerService, useValue: mockDockerService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: ExecutionTrackerService, useValue: mockExecutionTrackerService },
      ],
    }).compile();

    service = module.get<PtyExecutionService>(PtyExecutionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('spawn', () => {
    it('should spawn a pty process with correct options', () => {
      const command = 'ls';
      const args = ['-la'];
      const options = { cwd: '/tmp' };

      const result = service.spawn(command, args, options);

      // On macOS/Linux, commands are wrapped in /bin/sh to bypass Gatekeeper
      // On Windows, commands are spawned directly
      const expectedCmd =
        process.platform === 'darwin' || process.platform === 'linux' ? '/bin/sh' : command;
      expect(pty.spawn).toHaveBeenCalledWith(
        expectedCmd,
        expect.any(Array),
        expect.objectContaining({
          cwd: '/tmp',
        }),
      );
      expect(result.pid).toBeDefined();
      expect(typeof result.pid).toBe('number');
      expect(result.output$).toBeDefined();
      expect(result.exit$).toBeDefined();
    });

    it('should handle data output', (done) => {
      const { output$ } = service.spawn('echo', ['hello']);

      // Get the mock instance that was just created
      const mockInstance = (pty.spawn as jest.Mock).mock.results[0].value;

      output$.subscribe((data) => {
        expect(data).toBe('hello world');
        done();
      });

      // Simulate data event on the specific instance
      const onDataCallback = mockInstance.onData.mock.calls[0][0];
      onDataCallback('hello world');
    });

    it('should handle exit event', (done) => {
      const { exit$ } = service.spawn('exit', []);
      const mockInstance = (pty.spawn as jest.Mock).mock.results[0].value;

      exit$.subscribe((exit) => {
        expect(exit).toEqual({ exitCode: 0, signal: undefined });
        done();
      });

      // Simulate exit event
      const onExitCallback = mockInstance.onExit.mock.calls[0][0];
      onExitCallback({ exitCode: 0 });
    });

    it('should handle spawn errors gracefully', (done) => {
      // Make pty.spawn throw an error to simulate posix_spawnp failure
      (pty.spawn as jest.Mock).mockImplementationOnce(() => {
        throw new Error('posix_spawnp failed');
      });

      const { output$, exit$, pid } = service.spawn('nonexistent-command', []);

      // Should return -1 pid for failed pre-spawn check in test env
      // OR handle the error gracefully if pty.spawn throws
      expect(pid).toBeDefined();

      let completed = false;
      output$.subscribe({
        next: () => {},
        error: (err) => {
          // Error may be PtySpawnError or regular Error depending on fallback behavior
          expect(err).toBeDefined();
          if (!completed) {
            completed = true;
            done();
          }
        },
        complete: () => {
          if (!completed) {
            completed = true;
            done();
          }
        },
      });

      exit$.subscribe({
        next: (exit) => {
          // Should get error exit code (126 or 127 depending on failure mode)
          expect([126, 127, 0]).toContain(exit.exitCode);
          if (!completed) {
            completed = true;
            done();
          }
        },
      });
    }, 10000); // Increase timeout for fallback child_process spawn
  });

  describe('interact', () => {
    it('should write to process stdin', () => {
      const { pid } = service.spawn('cat');
      const mockInstance = (pty.spawn as jest.Mock).mock.results[0].value;

      service.write(pid, 'hello input');
      expect(mockInstance.write).toHaveBeenCalledWith('hello input');
    });

    it('should resize process', () => {
      const { pid } = service.spawn('top');
      const mockInstance = (pty.spawn as jest.Mock).mock.results[0].value;

      service.resize(pid, 100, 40);
      expect(mockInstance.resize).toHaveBeenCalledWith(100, 40);
    });

    it('should kill process', () => {
      const { pid } = service.spawn('sleep', ['100']);
      const mockInstance = (pty.spawn as jest.Mock).mock.results[0].value;

      service.kill(pid);
      expect(mockInstance.kill).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should kill all processes on destroy', () => {
      service.spawn('p1');
      const mockInstance1 = (pty.spawn as jest.Mock).mock.results[0].value;

      service.spawn('p2');
      const mockInstance2 = (pty.spawn as jest.Mock).mock.results[1].value;

      service.onModuleDestroy();

      expect(mockInstance1.kill).toHaveBeenCalled();
      expect(mockInstance2.kill).toHaveBeenCalled();
    });
  });

  describe('container execution', () => {
    it('should check if container execution is enabled', () => {
      expect(service.isContainerExecutionEnabled()).toBe(false);

      service.setContainerExecutionEnabled(true);
      expect(service.isContainerExecutionEnabled()).toBe(true);
    });

    it('should throw error when spawning in container without DockerService', async () => {
      const serviceWithoutDocker = new PtyExecutionService(
        mockConfigService as unknown as ConfigService,
        undefined,
        mockWorkspaceService as unknown as WorkspaceService,
      );

      await expect(
        serviceWithoutDocker.spawnInContainer('echo', ['hello'], { executionId: 'exec-123' }),
      ).rejects.toThrow('DockerService is required for container execution');
    });

    it('should throw error when spawning in container without WorkspaceService', async () => {
      const serviceWithoutWorkspace = new PtyExecutionService(
        mockConfigService as unknown as ConfigService,
        mockDockerService as unknown as DockerService,
        undefined,
      );

      await expect(
        serviceWithoutWorkspace.spawnInContainer('echo', ['hello'], { executionId: 'exec-123' }),
      ).rejects.toThrow('WorkspaceService is required for container execution');
    });

    it('should throw error when Docker is not connected', async () => {
      mockDockerService.isConnected.mockReturnValue(false);

      await expect(
        service.spawnInContainer('echo', ['hello'], { executionId: 'exec-123' }),
      ).rejects.toThrow('Docker is not connected');
    });

    it('should successfully spawn in container when Docker is connected', async () => {
      const executionId = 'exec-123';
      const workspacePath = '/tmp/workspaces/exec-123';
      const containerId = 'container-abc123';

      mockDockerService.isConnected.mockReturnValue(true);
      mockWorkspaceService.createWorkspace.mockResolvedValue(workspacePath);

      // Create a mock stream
      const mockStream = {
        on: jest.fn(),
        write: jest.fn(),
        destroy: jest.fn(),
        destroyed: false,
      };

      mockDockerService.runContainer.mockResolvedValue({
        container: { id: containerId },
        stream: mockStream,
      });

      mockDockerService.waitForContainer.mockResolvedValue({ StatusCode: 0 });

      // Mock getDocker for resize
      const mockContainerInstance = {
        resize: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockResolvedValue({
          State: { Running: true },
          Config: { Tty: true },
        }),
      };
      mockDockerService.getDocker.mockReturnValue({
        getContainer: jest.fn().mockReturnValue(mockContainerInstance),
      });

      const result = await service.spawnInContainer('echo', ['hello'], {
        executionId,
        cols: 120,
        rows: 40,
      });

      // Verify result structure
      expect(result.pid).toBeLessThan(0); // Container executions use negative pseudo-PIDs
      expect(result.containerId).toBe(containerId);
      expect(result.output$).toBeDefined();
      expect(result.exit$).toBeDefined();
      expect(typeof result.resize).toBe('function');
      expect(typeof result.write).toBe('function');
      expect(typeof result.kill).toBe('function');

      // Verify Docker service calls
      expect(mockWorkspaceService.createWorkspace).toHaveBeenCalledWith(executionId);
      expect(mockDockerService.runContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'dsf-agent-base',
          command: ['echo', 'hello'],
          binds: [`${workspacePath}:/home/agent/workspace:rw`],
          workingDir: '/home/agent/workspace',
          user: 'agent',
          tty: true,
          autoRemove: true,
        }),
      );

      // Test resize functionality
      await result.resize(100, 50);
      expect(mockContainerInstance.resize).toHaveBeenCalledWith({ h: 50, w: 100 });

      // Test write functionality
      result.write('test input');
      expect(mockStream.write).toHaveBeenCalledWith('test input');

      // Test kill functionality
      result.kill('SIGTERM');
      expect(mockDockerService.killContainer).toHaveBeenCalledWith(containerId, 'SIGTERM');
    });

    it('should handle container stream data events', async () => {
      const executionId = 'exec-456';
      const workspacePath = '/tmp/workspaces/exec-456';
      const containerId = 'container-def456';

      mockDockerService.isConnected.mockReturnValue(true);
      mockWorkspaceService.createWorkspace.mockResolvedValue(workspacePath);

      // Create a mock stream that captures event handlers
      type EventHandler = (data: Buffer | Error) => void;
      const eventHandlers: Record<string, EventHandler[]> = {};
      const mockStream = {
        on: jest.fn((event: string, handler: EventHandler) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        write: jest.fn(),
        destroy: jest.fn(),
        destroyed: false,
      };

      mockDockerService.runContainer.mockResolvedValue({
        container: { id: containerId },
        stream: mockStream,
      });

      mockDockerService.waitForContainer.mockResolvedValue({ StatusCode: 0 });

      const result = await service.spawnInContainer('echo', ['hello'], { executionId });

      // Collect output
      const outputs: string[] = [];
      result.output$.subscribe((data) => outputs.push(data));

      // Simulate stream data
      const dataHandler = eventHandlers['data']?.[0];
      expect(dataHandler).toBeDefined();
      dataHandler(Buffer.from('Hello from container'));

      expect(outputs).toContain('Hello from container');

      // Test is complete - don't wait for exit to avoid timeout
    }, 10000);

    it('should handle container stream errors', async () => {
      const executionId = 'exec-789';
      const workspacePath = '/tmp/workspaces/exec-789';
      const containerId = 'container-ghi789';

      mockDockerService.isConnected.mockReturnValue(true);
      mockWorkspaceService.createWorkspace.mockResolvedValue(workspacePath);

      type EventHandler = (data: Buffer | Error) => void;
      const eventHandlers: Record<string, EventHandler[]> = {};
      const mockStream = {
        on: jest.fn((event: string, handler: EventHandler) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        write: jest.fn(),
        destroy: jest.fn(),
        destroyed: false,
      };

      mockDockerService.runContainer.mockResolvedValue({
        container: { id: containerId },
        stream: mockStream,
      });

      const result = await service.spawnInContainer('echo', ['hello'], { executionId });

      // Subscribe to output to trigger error handling
      let errorReceived = false;
      result.output$.subscribe({
        error: () => {
          errorReceived = true;
        },
      });

      // Simulate stream error
      const errorHandler = eventHandlers['error']?.[0];
      expect(errorHandler).toBeDefined();
      errorHandler(new Error('Docker stream error'));

      expect(errorReceived).toBe(true);
    });

    // Story 23.3: Resource Limit Enforcement Tests
    describe('resource profile selection', () => {
      it('should select small profile for complexity <= 3', () => {
        expect(PtyExecutionService.selectResourceProfile(0)).toBe('small');
        expect(PtyExecutionService.selectResourceProfile(1)).toBe('small');
        expect(PtyExecutionService.selectResourceProfile(3)).toBe('small');
      });

      it('should select medium profile for complexity 4-7', () => {
        expect(PtyExecutionService.selectResourceProfile(4)).toBe('medium');
        expect(PtyExecutionService.selectResourceProfile(5)).toBe('medium');
        expect(PtyExecutionService.selectResourceProfile(7)).toBe('medium');
      });

      it('should select large profile for complexity > 7', () => {
        expect(PtyExecutionService.selectResourceProfile(8)).toBe('large');
        expect(PtyExecutionService.selectResourceProfile(10)).toBe('large');
        expect(PtyExecutionService.selectResourceProfile(15)).toBe('large');
      });
    });

    it('should pass resource profile to runContainer', async () => {
      const executionId = 'exec-resource';
      const workspacePath = '/tmp/workspaces/exec-resource';
      const containerId = 'container-resource';

      mockDockerService.isConnected.mockReturnValue(true);
      mockWorkspaceService.createWorkspace.mockResolvedValue(workspacePath);

      const mockStream = {
        on: jest.fn(),
        write: jest.fn(),
        destroy: jest.fn(),
        destroyed: false,
      };

      mockDockerService.runContainer.mockResolvedValue({
        container: { id: containerId },
        stream: mockStream,
      });

      mockDockerService.waitForContainer.mockResolvedValue({ StatusCode: 0 });

      await service.spawnInContainer('echo', ['hello'], {
        executionId,
        resourceProfile: 'large',
        memoryLimit: 1073741824, // 1GB in bytes
        cpuLimit: 2, // 2 CPUs
      });

      // Verify resource limits are passed to runContainer
      expect(mockDockerService.runContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'dsf-agent-base',
          resourceProfile: 'large',
          memoryLimit: 1073741824,
          cpuLimit: 2,
        }),
      );
    });

    it('should spawn with automatic profile selection', async () => {
      const executionId = 'exec-profile';
      const workspacePath = '/tmp/workspaces/exec-profile';
      const containerId = 'container-profile';

      mockDockerService.isConnected.mockReturnValue(true);
      mockWorkspaceService.createWorkspace.mockResolvedValue(workspacePath);

      const mockStream = {
        on: jest.fn(),
        write: jest.fn(),
        destroy: jest.fn(),
        destroyed: false,
      };

      mockDockerService.runContainer.mockResolvedValue({
        container: { id: containerId },
        stream: mockStream,
      });

      mockDockerService.waitForContainer.mockResolvedValue({ StatusCode: 0 });

      await service.spawnWithProfile('echo', ['hello'], 8, {
        executionId,
      });

      // Complexity 8 should select 'large' profile
      expect(mockDockerService.runContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceProfile: 'large',
        }),
      );
    });
  });
});
