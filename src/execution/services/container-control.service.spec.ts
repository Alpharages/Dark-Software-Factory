import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import { ContainerControlService } from './container-control.service';

// Mock Dockerode
jest.mock('dockerode');

describe('ContainerControlService', () => {
  let service: ContainerControlService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockContainer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDocker: any;

  beforeEach(async () => {
    mockContainer = {
      pause: jest.fn().mockResolvedValue(undefined),
      unpause: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      inspect: jest.fn().mockResolvedValue({
        State: { Running: true, Paused: false },
      }),
    };

    mockDocker = {
      getContainer: jest.fn().mockReturnValue(mockContainer),
    };

    (Docker as jest.MockedClass<typeof Docker>).mockImplementation(() => mockDocker);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerControlService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('/var/run/docker.sock'),
          },
        },
      ],
    }).compile();

    service = module.get<ContainerControlService>(ContainerControlService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pauseContainer', () => {
    it('should pause container successfully', async () => {
      const result = await service.pauseContainer('container-123');

      expect(result).toBe(true);
      expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
      expect(mockContainer.pause).toHaveBeenCalled();
    });

    it('should return false when container does not exist', async () => {
      mockContainer.pause.mockRejectedValue(new Error('No such container'));

      const result = await service.pauseContainer('non-existent');

      expect(result).toBe(false);
    });

    it('should return false when pause fails', async () => {
      mockContainer.pause.mockRejectedValue(new Error('Container already paused'));

      const result = await service.pauseContainer('container-123');

      expect(result).toBe(false);
    });
  });

  describe('resumeContainer', () => {
    it('should resume container successfully', async () => {
      const result = await service.resumeContainer('container-123');

      expect(result).toBe(true);
      expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
      expect(mockContainer.unpause).toHaveBeenCalled();
    });

    it('should return false when container does not exist', async () => {
      mockContainer.unpause.mockRejectedValue(new Error('No such container'));

      const result = await service.resumeContainer('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('emergencyKillContainer', () => {
    it('should kill container with SIGKILL', async () => {
      const result = await service.emergencyKillContainer('container-123');

      expect(result).toBe(true);
      expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
      expect(mockContainer.kill).toHaveBeenCalledWith({ signal: 'SIGKILL' });
    });

    it('should return false when kill fails', async () => {
      mockContainer.kill.mockRejectedValue(new Error('Container not running'));

      const result = await service.emergencyKillContainer('container-123');

      expect(result).toBe(false);
    });
  });

  describe('gracefulStopContainer', () => {
    it('should stop container with default timeout', async () => {
      const result = await service.gracefulStopContainer('container-123');

      expect(result).toBe(true);
      expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 30 });
    });

    it('should stop container with custom timeout', async () => {
      const result = await service.gracefulStopContainer('container-123', 60);

      expect(result).toBe(true);
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 60 });
    });

    it('should return false when stop fails', async () => {
      mockContainer.stop.mockRejectedValue(new Error('Container not running'));

      const result = await service.gracefulStopContainer('container-123');

      expect(result).toBe(false);
    });
  });

  describe('getContainerStatus', () => {
    it('should return running status for active container', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true, Paused: false },
      });

      const result = await service.getContainerStatus('container-123');

      expect(result).toEqual({ exists: true, running: true });
    });

    it('should return not running for paused container', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true, Paused: true },
      });

      const result = await service.getContainerStatus('container-123');

      expect(result).toEqual({ exists: true, running: false });
    });

    it('should return not exists for non-existent container', async () => {
      mockDocker.getContainer.mockReturnValue({
        inspect: jest.fn().mockRejectedValue(new Error('No such container')),
      });

      const result = await service.getContainerStatus('non-existent');

      expect(result).toEqual({ exists: false, running: false });
    });
  });
});
