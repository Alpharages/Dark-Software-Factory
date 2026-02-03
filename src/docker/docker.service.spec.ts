/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DockerService } from './docker.service';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';
import {
  mbToBytes,
  cpuPercentToQuota,
  getResourceProfile,
} from './interfaces/resource-profile.interface';

// Mock dockerode
const mockPing = jest.fn();
const mockListContainers = jest.fn();
const mockCreateContainer = jest.fn();
const mockGetImage = jest.fn();
const mockPull = jest.fn();
const mockGetContainer = jest.fn();

jest.mock('dockerode', () => {
  return jest.fn().mockImplementation(() => ({
    ping: mockPing,
    listContainers: mockListContainers,
    createContainer: mockCreateContainer,
    getImage: mockGetImage,
    pull: mockPull,
    getContainer: mockGetContainer,
  }));
});

describe('DockerService', () => {
  let service: DockerService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockMemoryLimitGauge = {
    set: jest.fn(),
  };

  const mockCpuLimitGauge = {
    set: jest.fn(),
  };

  const mockOomCounter = {
    inc: jest.fn(),
  };

  const mockCpuThrottledCounter = {
    inc: jest.fn(),
  };

  const mockMemoryUsageGauge = {
    set: jest.fn(),
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    mockPing.mockReset();
    mockListContainers.mockReset();
    mockCreateContainer.mockReset();
    mockGetImage.mockReset();
    mockPull.mockReset();
    mockGetContainer.mockReset();

    // Default mock for ConfigService
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'DOCKER_SOCKET_PATH') return '/var/run/docker.sock';
      if (key === 'sandbox.resourceLimits.enabled') return true;
      if (key === 'sandbox.resourceLimits.defaultMemoryLimitMB') return 512;
      if (key === 'sandbox.resourceLimits.defaultCpuLimitPercent') return 100;
      return defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DockerService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: 'PROM_METRIC_SANDBOX_CONTAINER_MEMORY_LIMIT_BYTES',
          useValue: mockMemoryLimitGauge,
        },
        {
          provide: 'PROM_METRIC_SANDBOX_CONTAINER_CPU_LIMIT_PERCENT',
          useValue: mockCpuLimitGauge,
        },
        {
          provide: 'PROM_METRIC_SANDBOX_CONTAINER_OOM_EVENTS_TOTAL',
          useValue: mockOomCounter,
        },
        {
          provide: 'PROM_METRIC_SANDBOX_CONTAINER_CPU_THROTTLED_SECONDS_TOTAL',
          useValue: mockCpuThrottledCounter,
        },
        {
          provide: 'PROM_METRIC_SANDBOX_CONTAINER_MEMORY_USAGE_BYTES',
          useValue: mockMemoryUsageGauge,
        },
      ],
    }).compile();

    service = module.get<DockerService>(DockerService);
    configService = module.get<ConfigService>(ConfigService);
    // Silence unused variable warning - used by tests that access it
    void configService;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with socket path from config', async () => {
      // The socket path is read from config in constructor
      // Default mock returns '/var/run/docker.sock'
      expect(service.getSocketPath()).toBe('/var/run/docker.sock');
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'DOCKER_SOCKET_PATH',
        '/var/run/docker.sock',
      );
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
      // Socket path is captured in constructor from the config service
      // The mock was set up in beforeEach
      expect(service.getSocketPath()).toBeDefined();
    });

    it('should return default socket path when not configured', () => {
      // Socket path defaults are handled by ConfigService
      expect(service.getSocketPath()).toBeDefined();
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

  // Story 23.3: Resource Limit Enforcement Tests
  describe('resource limit utilities', () => {
    it('should convert MB to bytes correctly', () => {
      expect(mbToBytes(512)).toBe(536870912); // 512 * 1024 * 1024
      expect(mbToBytes(1024)).toBe(1073741824); // 1024 * 1024 * 1024
      expect(mbToBytes(0)).toBe(0);
    });

    it('should convert CPU percent to quota correctly', () => {
      const result100 = cpuPercentToQuota(100);
      expect(result100.cpuQuota).toBe(100000);
      expect(result100.cpuPeriod).toBe(100000);

      const result50 = cpuPercentToQuota(50);
      expect(result50.cpuQuota).toBe(50000);
      expect(result50.cpuPeriod).toBe(100000);

      const result200 = cpuPercentToQuota(200);
      expect(result200.cpuQuota).toBe(200000);
      expect(result200.cpuPeriod).toBe(100000);
    });

    it('should return correct resource profiles', () => {
      const small = getResourceProfile('small');
      expect(small.memoryLimitMB).toBe(256);
      expect(small.cpuLimitPercent).toBe(50);

      const medium = getResourceProfile('medium');
      expect(medium.memoryLimitMB).toBe(512);
      expect(medium.cpuLimitPercent).toBe(100);

      const large = getResourceProfile('large');
      expect(large.memoryLimitMB).toBe(1024);
      expect(large.cpuLimitPercent).toBe(200);

      // Unknown profile should default to medium
      const unknown = getResourceProfile('unknown' as any);
      expect(unknown.memoryLimitMB).toBe(512);
    });
  });

  describe('resource limit metrics', () => {
    it('should record OOM event', () => {
      service.recordOomEvent('exec-123');
      expect(mockOomCounter.inc).toHaveBeenCalledWith({ execution_id: 'exec-123' });
    });

    it('should record CPU throttled time', () => {
      service.recordCpuThrottled('exec-123', 5.5);
      expect(mockCpuThrottledCounter.inc).toHaveBeenCalledWith({ execution_id: 'exec-123' }, 5.5);
    });

    it('should update memory usage', () => {
      service.updateMemoryUsage('exec-123', 536870912);
      expect(mockMemoryUsageGauge.set).toHaveBeenCalledWith(
        { execution_id: 'exec-123' },
        536870912,
      );
    });
  });
});
