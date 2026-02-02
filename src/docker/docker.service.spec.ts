/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DockerService } from './docker.service';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';

// Mock dockerode
const mockPing = jest.fn();
const mockListContainers = jest.fn();

const mockCreateContainer = jest.fn();

jest.mock('dockerode', () => {
  return jest.fn().mockImplementation(() => ({
    ping: mockPing,
    listContainers: mockListContainers,
    createContainer: mockCreateContainer,
  }));
});

describe('DockerService', () => {
  let service: DockerService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    mockPing.mockReset();
    mockPing.mockReset();
    mockListContainers.mockReset();
    mockCreateContainer.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DockerService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DockerService>(DockerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with socket path from config', async () => {
      mockConfigService.get.mockReturnValue('/custom/docker.sock');
      mockPing.mockResolvedValue(true);

      // Create new instance to trigger constructor
      const testService = new DockerService(configService);

      expect(mockConfigService.get).toHaveBeenCalledWith(
        'DOCKER_SOCKET_PATH',
        '/var/run/docker.sock',
      );
      expect(testService.getSocketPath()).toBe('/custom/docker.sock');
    });

    it('should use default socket path when not configured', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      const testService = new DockerService(configService);

      expect(testService.getSocketPath()).toBe('/var/run/docker.sock');
    });

    it('should handle connection success on module init', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      expect(mockPing).toHaveBeenCalled();
      expect(service.isConnected()).toBe(true);
    });

    it('should handle connection failure gracefully in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockRejectedValue(new Error('Connection refused'));

      // Should not throw in development mode
      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(service.isConnected()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it('should throw error in production when connection fails', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockRejectedValue(new Error('Connection refused'));

      await expect(service.onModuleInit()).rejects.toThrow('Docker connection failed');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle socket not found error with descriptive message', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      // Should not throw in development mode
      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(service.isConnected()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle permission denied error with descriptive message', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockRejectedValue(new Error('EACCES: permission denied'));

      // Should not throw in development mode
      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(service.isConnected()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('isHealthy', () => {
    it('should return true when Docker is reachable', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();
      mockPing.mockClear(); // Reset the init ping call

      mockPing.mockResolvedValue(true);
      const result = await service.isHealthy();

      expect(result).toBe(true);
      expect(mockPing).toHaveBeenCalled();
    });

    it('should return false when Docker is not reachable', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();
      mockPing.mockClear();

      mockPing.mockRejectedValue(new Error('Connection failed'));
      const result = await service.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false when Docker client is not initialized', async () => {
      // Don't initialize - service should handle gracefully
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return true after successful connection', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      expect(service.isConnected()).toBe(true);
    });

    it('should return false before connection is established', () => {
      // Before onModuleInit is called
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('listContainers', () => {
    it('should list running containers successfully', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      const mockContainers = [
        { Id: '1', Names: ['/container1'], State: 'running' },
        { Id: '2', Names: ['/container2'], State: 'running' },
      ];
      mockListContainers.mockResolvedValue(mockContainers);

      const result = await service.listContainers();

      expect(result).toEqual(mockContainers);
      expect(mockListContainers).toHaveBeenCalledWith({ all: false });
    });

    it('should list all containers when all=true', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      mockListContainers.mockResolvedValue([]);
      await service.listContainers(true);

      expect(mockListContainers).toHaveBeenCalledWith({ all: true });
    });

    it('should throw error when not connected', async () => {
      // Don't initialize - try to list containers
      await expect(service.listContainers()).rejects.toThrow('Docker client not connected');
    });

    it('should handle list containers errors', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      mockListContainers.mockRejectedValue(new Error('Docker daemon error'));

      await expect(service.listContainers()).rejects.toThrow('Docker daemon error');
    });
  });

  describe('getDocker', () => {
    it('should return Dockerode instance when connected', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);

      await service.onModuleInit();

      const docker = service.getDocker();
      expect(docker).toBeDefined();
      expect(docker.ping).toBeDefined();
      expect(docker.listContainers).toBeDefined();
    });

    it('should throw error when not connected', () => {
      expect(() => service.getDocker()).toThrow('Docker client not connected');
    });
  });

  describe('getSocketPath', () => {
    it('should return configured socket path', async () => {
      // Set up config before creating service (socket path is captured in constructor)
      mockConfigService.get.mockReturnValue('/custom/path/docker.sock');

      // Create new service instance with custom path
      const customService = new DockerService(configService);

      expect(customService.getSocketPath()).toBe('/custom/path/docker.sock');
    });

    it('should return default socket path when not configured', () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');

      const defaultService = new DockerService(configService);

      expect(defaultService.getSocketPath()).toBe('/var/run/docker.sock');
    });
  });
  describe('createContainer', () => {
    it('should create container with bind mounts', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);
      await service.onModuleInit();

      const mockContainer = { id: 'container-1' };
      mockCreateContainer.mockResolvedValue(mockContainer);

      const options = {
        Image: 'node:20',
        HostConfig: {
          Binds: ['/host/path:/container/path:rw'],
        },
      };

      const result = await service.createContainer(options);

      expect(result).toBe(mockContainer);
      expect(mockCreateContainer).toHaveBeenCalledWith(options);
    });

    it('should throw InfrastructureException on failure', async () => {
      mockConfigService.get.mockReturnValue('/var/run/docker.sock');
      mockPing.mockResolvedValue(true);
      await service.onModuleInit();

      mockCreateContainer.mockRejectedValue(new Error('Docker create failed'));

      await expect(service.createContainer({})).rejects.toThrow(InfrastructureException);
    });
  });

  describe('formatBindMount', () => {
    it('should format linux paths correctly', () => {
      const result = service.formatBindMount('/host', '/container', 'rw');
      expect(result).toBe('/host:/container:rw');
    });

    it('should default mode to rw', () => {
      const result = service.formatBindMount('/host', '/container');
      expect(result).toBe('/host:/container:rw');
    });

    it('should warn if path is not absolute', () => {
      // Create a spy on logger warn
      const loggerSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();

      const result = service.formatBindMount('./relative', '/container');

      expect(result).toBe('./relative:/container:rw');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('does not appear to be absolute'),
      );
    });
  });
});
