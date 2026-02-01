import { Test, TestingModule } from '@nestjs/testing';
import { PtyExecutionService, PtySpawnError } from './pty-execution.service';
import * as pty from 'node-pty';

// Mock node-pty
jest.mock('node-pty', () => {
  return {
    spawn: jest.fn(),
  };
});

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [PtyExecutionService],
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
      const expectedCmd = process.platform === 'darwin' || process.platform === 'linux' ? '/bin/sh' : command;
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
});
