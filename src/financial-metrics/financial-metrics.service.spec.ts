import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { FinancialMetricsService } from './financial-metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';
import { SentryService } from '@/common/sentry/sentry.service';

describe('FinancialMetricsService — project-existence consistency (BUG-02)', () => {
  let service: FinancialMetricsService;

  const mockPrismaService = {
    project: {
      findUnique: jest.fn(),
    },
    aICostLog: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { cost_usd: null } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ticket: {
      aggregate: jest.fn().mockResolvedValue({ _count: { id: 0 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    execution: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockLoggerService = { debug: jest.fn(), error: jest.fn() };
  const mockSentryService = { captureException: jest.fn() };
  const mockJwtService = { sign: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialMetricsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: SentryService, useValue: mockSentryService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<FinancialMetricsService>(FinancialMetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const UNKNOWN_PROJECT = 'unknown-project-id';

  it('calculateRoi 404s on an unknown project', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(
      service.calculateRoi({ projectId: UNKNOWN_PROJECT, period: 'month' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('getCostPerFeature 404s on an unknown project when a projectId filter is supplied', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(
      service.getCostPerFeature({ epicId: 'epic-5', projectId: UNKNOWN_PROJECT }),
    ).rejects.toThrow(NotFoundException);
  });

  it('getCostPerFeature does not validate a project when no projectId filter is supplied', async () => {
    await expect(service.getCostPerFeature({ epicId: 'epic-5' })).resolves.toBeDefined();
    expect(mockPrismaService.project.findUnique).not.toHaveBeenCalled();
  });

  it('getModelEfficiency 404s on an unknown project', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(service.getModelEfficiency({ projectId: UNKNOWN_PROJECT })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getHistoricalRoi 404s on an unknown project', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(service.getHistoricalRoi({ projectId: UNKNOWN_PROJECT })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getBudgetTrends still 404s on an unknown project (pre-existing behavior preserved)', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(
      service.getBudgetTrends({ projectId: UNKNOWN_PROJECT, period: 'month' }),
    ).rejects.toThrow(NotFoundException);
  });
});
