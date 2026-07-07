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

  it('getEpics 404s on an unknown project when a projectId filter is supplied', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(service.getEpics('unknown-project-id')).rejects.toThrow(NotFoundException);
  });

  it('getEpics returns distinct epics sorted numerically, derived from ticket.epic_num', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue({ id: 'project-1' });
    mockPrismaService.ticket.findMany.mockResolvedValue([
      { epic_num: '14' },
      { epic_num: '6' },
      { epic_num: '5' },
    ]);

    await expect(service.getEpics('project-1')).resolves.toEqual([
      { epicId: 'epic-5', epicTitle: 'Epic 5' },
      { epicId: 'epic-6', epicTitle: 'Epic 6' },
      { epicId: 'epic-14', epicTitle: 'Epic 14' },
    ]);
    expect(mockPrismaService.ticket.findMany).toHaveBeenCalledWith({
      where: { epic_num: { not: null }, project_id: 'project-1' },
      distinct: ['epic_num'],
      select: { epic_num: true },
    });
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

  it('generateShareLink 404s on an unknown project', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(service.generateShareLink({ projectId: UNKNOWN_PROJECT })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('scheduleReport 404s on an unknown project', async () => {
    mockPrismaService.project.findUnique.mockResolvedValue(null);

    await expect(
      service.scheduleReport({ projectId: UNKNOWN_PROJECT, email: 'a@b.com', frequency: 'weekly' }),
    ).rejects.toThrow(NotFoundException);
  });
});
