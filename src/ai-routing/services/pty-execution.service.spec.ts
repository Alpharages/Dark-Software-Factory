import { Test, TestingModule } from '@nestjs/testing';
import { PtyExecutionService } from './pty-execution.service';
import * as pty from 'node-pty';

// Mock node-pty
jest.mock('node-pty');

describe('PtyExecutionService', () => {
  let service: PtyExecutionService;
  let mockPtyProcess: jest.Mocked<pty.IPty>;

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create a mock PTY process
    mockPtyProcess = {
      pid: 12345,
      cols: 80,
      rows: 30,
      process: 'bash',
      handleFlowControl: false,
      on: jest.fn(),
      resize: jest.fn(),
      write: jest.fn(),
      kill: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      clear: jest.fn(),
      onData: jest.fn(),
      onExit: jest.fn(),
    } as unknown as jest.Mocked<pty.IPty>;

    // Mock pty.spawn to return our mock process
    (pty.spawn as jest.Mock).mockReturnValue(mockPtyProcess);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PtyExecutionService],
    }).compile();

    service = module.get<PtyExecutionService>(PtyExecutionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('spawn', () => {
    it('should spawn a PTY process with the given command', () => {
      const command = 'bash';
      const args = ['-c', 'echo hello'];

      const result = service.spawn(command, args);

      expect(pty.spawn).toHaveBeenCalledWith(
        command,
        args,
        expect.objectContaining({
          name: 'xterm-color',
          cols: 80,
          rows: 30,
        }),
      );
      expect(result).toBe(mockPtyProcess);
    });

    it('should log the command being executed', () => {
      const command = 'npm';
      const args = ['test'];
      const logSpy = jest.spyOn(service['logger'], 'log');

      service.spawn(command, args);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Spawning PTY process: npm test'),
      );
    });

    it('should use default options when not provided', () => {
      const command = 'bash';

      service.spawn(command);

      expect(pty.spawn).toHaveBeenCalledWith(
        command,
        [],
        expect.objectContaining({
          cols: 80,
          rows: 30,
          cwd: process.cwd(),
          env: process.env,
        }),
      );
    });

    it('should use custom options when provided', () => {
      const command = 'bash';
      const customOptions = {
        cols: 120,
        rows: 40,
        cwd: '/custom/path',
      };

      service.spawn(command, [], customOptions);

      expect(pty.spawn).toHaveBeenCalledWith(
        command,
        [],
        expect.objectContaining({
          cols: 120,
          rows: 40,
          cwd: '/custom/path',
        }),
      );
    });
  });

  describe('spawnInContainer', () => {
    it('should spawn a PTY process in a container', () => {
      const command = 'bash';
      const args = ['-c', 'npm test'];
      const options = {
        containerId: 'test-container',
      };

      const result = service.spawnInContainer(command, args, options);

      expect(pty.spawn).toHaveBeenCalledWith(
        'docker',
        ['exec', '-it', 'test-container', command, ...args],
        expect.objectContaining({
          name: 'xterm-color',
        }),
      );
      expect(result).toBe(mockPtyProcess);
    });

    it('should log the container command being executed', () => {
      const command = 'npm';
      const args = ['test'];
      const options = {
        containerId: 'my-container',
      };
      const logSpy = jest.spyOn(service['logger'], 'log');

      service.spawnInContainer(command, args, options);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Spawning PTY process in container my-container: npm test',
        ),
      );
    });

    it('should include user option when provided', () => {
      const command = 'bash';
      const options = {
        containerId: 'test-container',
        user: 'testuser',
      };

      service.spawnInContainer(command, [], options);

      expect(pty.spawn).toHaveBeenCalledWith(
        'docker',
        ['exec', '-it', '-u', 'testuser', 'test-container', command],
        expect.any(Object),
      );
    });
  });

  describe('kill', () => {
    it('should kill a PTY process successfully', () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      service.kill(mockPtyProcess);

      expect(mockPtyProcess.kill).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('PTY process terminated successfully');
    });

    it('should log error and rethrow when kill fails', () => {
      const error = new Error('Kill failed');
      mockPtyProcess.kill.mockImplementation(() => {
        throw error;
      });
      const errorSpy = jest.spyOn(service['logger'], 'error');

      expect(() => service.kill(mockPtyProcess)).toThrow('Kill failed');
      expect(errorSpy).toHaveBeenCalledWith('Failed to kill PTY process', error);
    });
  });
});
