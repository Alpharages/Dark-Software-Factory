import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StartupChecksService } from './startup-checks.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';

describe('StartupChecksService', () => {
  let service: StartupChecksService;
  let prisma: { projectIntegration: { count: jest.Mock } };
  let loggerWarnSpy: jest.SpyInstance;

  const mockPrisma = {
    projectIntegration: {
      count: jest.fn(),
    },
  };

  const mockLogger = {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const buildModule = async (apiKey: string | undefined) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StartupChecksService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'CLICKUP_API_KEY') return apiKey;
              return undefined;
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    return module.get<StartupChecksService>(StartupChecksService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrisma;
    loggerWarnSpy = mockLogger.warn as jest.Mock;
  });

  it('should warn when no API key and no OAuth integrations found', async () => {
    prisma.projectIntegration.count.mockResolvedValue(0);
    service = await buildModule(undefined);

    await service.onApplicationBootstrap();

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CS1-7] WARNING: No CLICKUP_API_KEY set'),
      'StartupChecksService',
    );
  });

  it('should not warn when API key is present', async () => {
    prisma.projectIntegration.count.mockResolvedValue(0);
    service = await buildModule('test-legacy-key');

    await service.onApplicationBootstrap();

    expect(loggerWarnSpy).not.toHaveBeenCalled();
    expect(prisma.projectIntegration.count).not.toHaveBeenCalled();
  });

  it('should not warn when OAuth integrations exist even without API key', async () => {
    prisma.projectIntegration.count.mockResolvedValue(2);
    service = await buildModule(undefined);

    await service.onApplicationBootstrap();

    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });
});
