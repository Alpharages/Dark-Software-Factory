import { Test, TestingModule } from '@nestjs/testing';
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

  const buildModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StartupChecksService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
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

  it('should warn when no OAuth integrations found', async () => {
    prisma.projectIntegration.count.mockResolvedValue(0);
    service = await buildModule();

    await service.onApplicationBootstrap();

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No ProjectIntegration OAuth records found'),
      'StartupChecksService',
    );
  });

  it('should not warn when OAuth integrations exist', async () => {
    prisma.projectIntegration.count.mockResolvedValue(2);
    service = await buildModule();

    await service.onApplicationBootstrap();

    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });
});
