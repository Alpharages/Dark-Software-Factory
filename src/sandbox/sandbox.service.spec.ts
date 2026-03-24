import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { SandboxService } from './sandbox.service';
import { SandboxManager } from '@alibaba-group/opensandbox';

jest.mock('@alibaba-group/opensandbox', () => {
  return {
    SandboxManager: {
      create: jest.fn(),
    },
  };
});

describe('SandboxService', () => {
  let service: SandboxService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockManager: any;

  const originalEnv = process.env;

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...originalEnv };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'opensandbox.domain') return 'localhost:8080';
        if (key === 'opensandbox.apiKey') return 'key';
        if (key === 'opensandbox.protocol') return 'http';
        if (key === 'opensandbox.requestTimeoutMs') return 60000;
        return defaultValue;
      }),
    } as any;

    mockManager = {
      listSandboxInfos: jest.fn(),
      getSandboxInfo: jest.fn(),
      killSandbox: jest.fn(),
    };

    (SandboxManager.create as jest.Mock).mockReturnValue(mockManager);

    const module: TestingModule = await Test.createTestingModule({
      providers: [SandboxService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<SandboxService>(SandboxService);
    // Suppress logger out in tests
    const loggerMock = { log: jest.fn(), warn: jest.fn() };
    (service as any).logger = loggerMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should initialize SandboxManager and log success on healthy server', async () => {
      mockManager.listSandboxInfos.mockResolvedValueOnce({ items: [] });
      await service.onModuleInit();

      expect(SandboxManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionConfig: {
            domain: 'localhost:8080',
            apiKey: 'key',
            protocol: 'http',
            requestTimeoutSeconds: 60,
          },
        }),
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'OpenSandbox connected successfully at localhost:8080',
      );
    });

    it('should warn but not throw in non-production environments if server is down', async () => {
      process.env.NODE_ENV = 'development';
      mockManager.listSandboxInfos.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SandboxService: OpenSandbox server unreachable'),
      );
    });

    it('should warn but not throw in test environments if server is down', async () => {
      process.env.NODE_ENV = 'test';
      mockManager.listSandboxInfos.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SandboxService: OpenSandbox server unreachable'),
      );
    });

    it('should throw in production if server is down', async () => {
      process.env.NODE_ENV = 'production';
      mockManager.listSandboxInfos.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.onModuleInit()).rejects.toThrow(
        /SandboxService: OpenSandbox server unreachable/,
      );
    });

    it('should time out and throw/warn if server hangs for >10s', async () => {
      jest.useFakeTimers();

      // Simulate hanging by returning an unresolved promise
      mockManager.listSandboxInfos.mockReturnValueOnce(new Promise(() => {}));

      process.env.NODE_ENV = 'production';

      const initPromise = service.onModuleInit();

      // Advance timers by just over 10s
      jest.advanceTimersByTime(11_000);

      await expect(initPromise).rejects.toThrow(/health ping timed out/);

      jest.useRealTimers();
    });
  });

  describe('isHealthy', () => {
    beforeEach(async () => {
      // Init normally for the rest of the tests to populate this.manager
      mockManager.listSandboxInfos.mockResolvedValueOnce({ items: [] });
      await service.onModuleInit();
      mockManager.listSandboxInfos.mockClear();
    });

    it('should return true if server responds', async () => {
      mockManager.listSandboxInfos.mockResolvedValue({ items: [] });
      expect(await service.isHealthy()).toBe(true);
    });

    it('should return false but not throw if server fails', async () => {
      mockManager.listSandboxInfos.mockRejectedValue(new Error('fail'));
      expect(await service.isHealthy()).toBe(false);
    });
  });

  describe('delegation methods', () => {
    beforeEach(async () => {
      mockManager.listSandboxInfos.mockResolvedValueOnce({ items: [] });
      await service.onModuleInit();
    });

    it('getSandboxInfo should call manager.getSandboxInfo', async () => {
      mockManager.getSandboxInfo.mockResolvedValueOnce({ id: 's1' });
      const res = await service.getSandboxInfo('s1');
      expect(mockManager.getSandboxInfo).toHaveBeenCalledWith('s1');
      expect(res).toEqual({ id: 's1' });
    });

    it('killSandbox should call manager.killSandbox', async () => {
      mockManager.killSandbox.mockResolvedValueOnce();
      await service.killSandbox('s1');
      expect(mockManager.killSandbox).toHaveBeenCalledWith('s1');
    });

    it('listActiveSandboxes should extract items from the paginated response', async () => {
      mockManager.listSandboxInfos.mockResolvedValueOnce({ items: [{ id: 's1' }, { id: 's2' }] });
      const list = await service.listActiveSandboxes();
      expect(mockManager.listSandboxInfos).toHaveBeenCalled(); // Should not pass args
      expect(list).toEqual([{ id: 's1' }, { id: 's2' }]);
    });
  });

  describe('runAgentCommand', () => {
    it('should throw OS-1.3 not yet implemented', async () => {
      await expect(
        service.runAgentCommand({
          executionId: 'exec1',
          image: 'i1',
          command: 'cmd',
          env: {},
          timeoutSeconds: 30,
          cpuLimit: '1',
          memoryLimit: '1Gi',
        }),
      ).rejects.toThrow('[OS-1.3]');
    });
  });

  describe('configuration', () => {
    it('should default agentImage to opensandbox/code-interpreter:v1.0.2 when unset', () => {
      const originalEnv = process.env.OPENSANDBOX_AGENT_IMAGE;
      delete process.env.OPENSANDBOX_AGENT_IMAGE;
      const config = configuration();
      expect(config.opensandbox.agentImage).toBe('opensandbox/code-interpreter:v1.0.2');
      process.env.OPENSANDBOX_AGENT_IMAGE = originalEnv;
    });
  });
});
