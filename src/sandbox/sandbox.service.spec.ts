import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { SandboxService } from './sandbox.service';
import { SandboxManager, Sandbox } from '@alibaba-group/opensandbox';
import { ExecutionGateway } from '@/execution/gateways/execution.gateway';
import { SANDBOX_METRICS } from '@/common/metrics/metrics.constants';

// Helper to generate metric tokens (consistent with other specs in this project)
const getMetricToken = (name: string): string => `PROM_METRIC_${name.toUpperCase()}`;

jest.mock('@alibaba-group/opensandbox', () => {
  return {
    SandboxManager: {
      create: jest.fn(),
    },
    Sandbox: {
      create: jest.fn(),
    },
  };
});

describe('SandboxService', () => {
  let service: SandboxService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockManager: any;
  let mockExecutionGateway: any;
  let mockExecutionsCounter: any;
  let mockDurationHistogram: any;
  let mockActiveSandboxesGauge: any;
  let mockQueueDepthGauge: any;

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

    mockExecutionGateway = {
      emitLog: jest.fn(),
    };

    mockExecutionsCounter = { inc: jest.fn() };
    mockDurationHistogram = { observe: jest.fn() };
    mockActiveSandboxesGauge = { set: jest.fn() };
    mockQueueDepthGauge = { set: jest.fn() };

    (SandboxManager.create as jest.Mock).mockReturnValue(mockManager);

    const sharedProviders = [
      SandboxService,
      { provide: ConfigService, useValue: mockConfigService },
      { provide: ExecutionGateway, useValue: mockExecutionGateway },
      {
        provide: getMetricToken(SANDBOX_METRICS.EXECUTIONS_TOTAL),
        useValue: mockExecutionsCounter,
      },
      {
        provide: getMetricToken(SANDBOX_METRICS.EXECUTION_DURATION_SECONDS),
        useValue: mockDurationHistogram,
      },
      {
        provide: getMetricToken(SANDBOX_METRICS.ACTIVE_SANDBOXES),
        useValue: mockActiveSandboxesGauge,
      },
      {
        provide: getMetricToken(SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH),
        useValue: mockQueueDepthGauge,
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: sharedProviders,
    }).compile();

    service = module.get<SandboxService>(SandboxService);
    (service as any).sharedProviders = sharedProviders; // Store for T10-guard
    // Suppress logger out in tests
    const loggerMock = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
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
    let mockSandbox: any;

    beforeEach(async () => {
      // Initialize the manager before testing runAgentCommand
      mockManager.listSandboxInfos.mockResolvedValueOnce({ items: [] });
      await service.onModuleInit();

      mockSandbox = {
        id: 'sbx-123',
        kill: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        commands: {
          run: jest.fn(),
        },
      };

      (Sandbox.create as jest.Mock).mockResolvedValue(mockSandbox);
    });

    const defaultOptions = {
      executionId: 'exec1',
      ticketId: 't1',
      image: 'i1',
      command: 'echo test',
      env: { NORMAL_VAR: 'val' },
      timeoutSeconds: 30,
      cpuLimit: '1',
      memoryLimit: '1Gi',
    };

    // F2: guard test — runAgentCommand() before onModuleInit() must throw
    it('T10-guard: should throw if manager is not initialized (guard check)', async () => {
      // Create a fresh service that has NOT had onModuleInit called
      const freshModule = await Test.createTestingModule({
        providers: (service as any).sharedProviders,
      }).compile();
      const freshService = freshModule.get<SandboxService>(SandboxService);
      // Suppress logger
      (freshService as any).logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      await expect(freshService.runAgentCommand(defaultOptions)).rejects.toThrow(
        'SandboxService.runAgentCommand() called before onModuleInit() completed',
      );
    });

    it('T11: should execute successfully and return mapped results', async () => {
      mockSandbox.commands.run.mockImplementation(async (cmd: string, opts: any, handlers: any) => {
        handlers.onStdout({ text: 'out ' });
        handlers.onStdout({ text: 'chunk' });
        handlers.onStderr({ text: 'err' });
        return { error: undefined }; // execution successful
      });

      const res = await service.runAgentCommand(defaultOptions);

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'i1',
          resource: { cpu: '1', memory: '1Gi' },
        }),
      );
      expect(res).toMatchObject({
        sandboxId: 'sbx-123',
        stdout: 'out chunk',
        stderr: 'err',
        exitCode: 0,
        timedOut: false,
      });
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockSandbox.kill).toHaveBeenCalled();
      expect(mockSandbox.close).toHaveBeenCalled();
    });

    it('T12: should detect timeout if error name is TimeoutError', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        error: { name: 'TimeoutError', value: 'execution timed out' },
      });

      const res = await service.runAgentCommand(defaultOptions);

      expect(res.exitCode).toBe(1);
      expect(res.timedOut).toBe(true);
    });

    it('T13: should handle non-zero exit code (error present but no timeout)', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        error: { name: 'CommandError', value: 'bash failed' },
      });

      const res = await service.runAgentCommand(defaultOptions);

      expect(res.exitCode).toBe(1);
      expect(res.timedOut).toBe(false);
    });

    it('T14: should throw if sandbox creation fails', async () => {
      (Sandbox.create as jest.Mock).mockRejectedValue(new Error('creation failed'));

      await expect(service.runAgentCommand(defaultOptions)).rejects.toThrow('creation failed');
      // F5: sandbox is null when create() throws — kill/close must NOT be called
      expect(mockSandbox.kill).not.toHaveBeenCalled();
      expect(mockSandbox.close).not.toHaveBeenCalled();
    });

    it('T15: should emit logs via ExecutionGateway during execution', async () => {
      mockSandbox.commands.run.mockImplementation(async (cmd: string, opts: any, handlers: any) => {
        handlers.onStdout({ text: 'hello' });
        handlers.onStderr({ text: 'boom' });
        return {};
      });

      await service.runAgentCommand(defaultOptions);

      expect(mockExecutionGateway.emitLog).toHaveBeenCalledWith('exec1', 't1', 'hello', 'stdout');
      expect(mockExecutionGateway.emitLog).toHaveBeenCalledWith('exec1', 't1', 'boom', 'stderr');
    });

    it('T16: should redact API keys in logger.debug', async () => {
      mockSandbox.commands.run.mockResolvedValue({});

      await service.runAgentCommand({
        ...defaultOptions,
        env: { OPENAI_API_KEY: 'sk-123', NORMAL_VAR: 'val' },
      });

      expect((service as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('"[REDACTED]"'),
      );
      expect((service as any).logger.debug).toHaveBeenCalledWith(expect.stringContaining('"val"'));
    });

    it('T17: should map networkPolicy properly', async () => {
      mockSandbox.commands.run.mockResolvedValue({});

      await service.runAgentCommand({
        ...defaultOptions,
        networkPolicy: {
          defaultAction: 'DENY',
          egressRules: [{ target: 'github.com' }],
        },
      });

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          networkPolicy: {
            defaultAction: 'deny',
            egress: [{ action: 'allow', target: 'github.com' }],
          },
        }),
      );
    });

    // F3: networkPolicy with no egressRules → egress: undefined must not crash
    it('T17b: should handle networkPolicy with no egressRules (egress: undefined)', async () => {
      mockSandbox.commands.run.mockResolvedValue({});

      await expect(
        service.runAgentCommand({
          ...defaultOptions,
          networkPolicy: {
            defaultAction: 'DENY',
            // egressRules intentionally omitted
          },
        }),
      ).resolves.not.toThrow();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          networkPolicy: {
            defaultAction: 'deny',
            egress: undefined,
          },
        }),
      );
    });

    it('T18: should call kill and close on successful execution', async () => {
      mockSandbox.commands.run.mockResolvedValue({});
      await service.runAgentCommand(defaultOptions);
      expect(mockSandbox.kill).toHaveBeenCalled();
      expect(mockSandbox.close).toHaveBeenCalled();
    });

    it('T19: should still return result if kill/close throws', async () => {
      mockSandbox.commands.run.mockResolvedValue({});
      mockSandbox.kill.mockRejectedValue(new Error('kill fail'));
      mockSandbox.close.mockRejectedValue(new Error('close fail'));

      const res = await service.runAgentCommand(defaultOptions);

      expect(res.sandboxId).toBe('sbx-123');
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('kill fail'),
      );
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('close fail'),
      );
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

  describe('Story OS-1.4: Metrics & Concurrency (T20–T27)', () => {
    let mockSandbox: any;

    beforeEach(async () => {
      mockManager.listSandboxInfos.mockResolvedValue({ items: [] });
      await service.onModuleInit();

      mockSandbox = {
        id: 'sbx-123',
        kill: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        commands: { run: jest.fn().mockResolvedValue({}) },
      };
      (Sandbox.create as jest.Mock).mockResolvedValue(mockSandbox);
    });

    it('T20: should increment executionsCounter on success', async () => {
      await service.runAgentCommand({ executionId: 'e1', image: 'i1', command: 'ls' } as any);
      expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
        provider: 'unknown',
        status: 'success',
      });
    });

    it('T21: should increment executionsCounter with "timeout" on Command timeout', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        error: { name: 'TimeoutError', value: 'timed out' },
      });
      await service.runAgentCommand({ executionId: 'e1' } as any);
      expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
        provider: 'unknown',
        status: 'timeout',
      });
    });

    it('T22: should increment executionsCounter with "failed" on catchable error', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('crash'));
      await expect(service.runAgentCommand({ executionId: 'e1' } as any)).rejects.toThrow();
      expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
        provider: 'unknown',
        status: 'failed',
      });
    });

    it('T23: should observe duration in durationHistogram', async () => {
      await service.runAgentCommand({ executionId: 'e1' } as any);
      expect(mockDurationHistogram.observe).toHaveBeenCalledWith(
        { provider: 'unknown' },
        expect.any(Number),
      );
    });

    it('T24: should acquire and release semaphore permit', async () => {
      const acquireSpy = jest.spyOn((service as any).semaphore, 'acquire');
      const releaseSpy = jest.spyOn((service as any).semaphore, 'release');

      await service.runAgentCommand({ executionId: 'e1' } as any);

      expect(acquireSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
    });

    it('T25: should update queueDepthGauge during runAgentCommand life-cycle', async () => {
      await service.runAgentCommand({ executionId: 'e1' } as any);
      // set() is called before acquire, after acquire, and in finally
      expect(mockQueueDepthGauge.set).toHaveBeenCalledTimes(3);
    });

    it('T26: should queue second request when concurrency limit is reached', async () => {
      // Mock maxConcurrent = 1
      mockConfigService.get.mockImplementation((key: string, def: any) => {
        if (key === 'opensandbox.maxConcurrent') return 1;
        return def;
      });
      await service.onModuleInit();

      // Block the first execution
      let releaseFirst: any;
      const firstExecutionStarted = new Promise((resolve) => {
        mockSandbox.commands.run.mockImplementationOnce(() => {
          resolve(true);
          return new Promise((res) => {
            releaseFirst = res;
          });
        });
      });
      // Second call should proceed once first releases
      mockSandbox.commands.run.mockResolvedValueOnce({});

      const firstCall = service.runAgentCommand({ executionId: 'e1' } as any);
      await firstExecutionStarted;

      // Second call should be queued
      let secondCallFinished = false;
      const secondCall = service.runAgentCommand({ executionId: 'e2' } as any).then(() => {
        secondCallFinished = true;
      });

      // Assert second call hasn't finished (it's queued)
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondCallFinished).toBe(false);

      // Release first, second should proceed
      releaseFirst({});
      await firstCall;
      await secondCall;
      expect(secondCallFinished).toBe(true);
    });

    it('T27: should release semaphore even if execution fails', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('crash'));
      const releaseSpy = jest.spyOn((service as any).semaphore, 'release');

      await expect(service.runAgentCommand({ executionId: 'e1' } as any)).rejects.toThrow();
      expect(releaseSpy).toHaveBeenCalled();
    });
  });

  describe('Story OS-1.4: Leak Prevention (T28–T31)', () => {
    beforeEach(async () => {
      mockManager.listSandboxInfos.mockResolvedValue({ items: [] });
      await service.onModuleInit();
      mockConfigService.get.mockImplementation((key: string, def: any) => {
        if (key === 'opensandbox.sandboxTimeoutS') return 60; // threshold = 90s
        return def;
      });
    });

    it('T28: checkForLeakedSandboxes should kill sandboxes older than threshold', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 100_000); // 100s old (> 90s)
      const youngDate = new Date(now - 10_000); // 10s old

      mockManager.listSandboxInfos.mockResolvedValue({
        items: [
          { id: 'sbx-old', createdAt: oldDate },
          { id: 'sbx-young', createdAt: youngDate },
        ],
      });

      await service.checkForLeakedSandboxes();

      expect(mockManager.killSandbox).toHaveBeenCalledWith('sbx-old');
      expect(mockManager.killSandbox).not.toHaveBeenCalledWith('sbx-young');
    });

    it('T29: should update activeSandboxesGauge count', async () => {
      mockManager.listSandboxInfos.mockResolvedValue({
        items: [
          { id: 's1', createdAt: new Date() },
          { id: 's2', createdAt: new Date() },
        ],
      });

      await service.checkForLeakedSandboxes();

      expect(mockActiveSandboxesGauge.set).toHaveBeenCalledWith(2);
    });

    it('T30: should handle errors during leak prevention without crashing', async () => {
      mockManager.listSandboxInfos.mockRejectedValue(new Error('SDK error'));
      await expect(service.checkForLeakedSandboxes()).resolves.not.toThrow();
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('leak prevention check failed'),
      );
    });

    it('T31: should re-update gauge after killing leaked sandboxes', async () => {
      const oldDate = new Date(Date.now() - 200_000);
      mockManager.listSandboxInfos
        .mockResolvedValueOnce({ items: [{ id: 'sbx-leak', createdAt: oldDate }] }) // first call
        .mockResolvedValueOnce({ items: [] }); // call after kill

      await service.checkForLeakedSandboxes();

      expect(mockActiveSandboxesGauge.set).toHaveBeenCalledWith(1);
      expect(mockActiveSandboxesGauge.set).toHaveBeenCalledWith(0);
    });
  });
});
