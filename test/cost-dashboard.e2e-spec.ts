import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/database/prisma.service';
import { AIProvider } from '@/prisma/client';
import { Prisma } from '@/prisma/client';
import { CostDashboardController } from '../src/cost-tracking/cost-dashboard.controller';
import { CostDashboardService } from '../src/cost-tracking/cost-dashboard.service';
import { LoggerService } from '../src/common/logger';
import { SentryService } from '../src/common/sentry';
import { MetricsService } from '../src/common/metrics';
import { JwtAuthGuard } from '../src/common/guards/auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('Cost Dashboard (e2e)', () => {
  let app: INestApplication;

  const mockCostLogs = [
    {
      id: 'log-1',
      timestamp: new Date(),
      ai_provider: AIProvider.CURSOR_HEADLESS,
      model_name: 'gpt-4o',
      operation_type: 'code_generation',
      tokens_input: 1000,
      tokens_output: 500,
      cost_usd: new Prisma.Decimal('0.015'),
      ticket_id: 'DSF-123',
      execution: {
        id: 'exec-1',
        status: 'COMPLETED',
        ai_provider: AIProvider.CURSOR_HEADLESS,
        selected_model: 'gpt-4o',
      },
    },
  ];

  const mockPrismaService = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    aICostLog: {
      groupBy: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CostDashboardController],
      providers: [
        CostDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), error: jest.fn(), debug: jest.fn() },
        },
        { provide: SentryService, useValue: { captureException: jest.fn() } },
        { provide: MetricsService, useValue: { increment: jest.fn(), record: jest.fn() } },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock-token'), verify: jest.fn() },
        },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const adminToken = 'mock-token';

  describe('Endpoints Logic', () => {
    it('GET /api/costs/summary/:period should return aggregated data', async () => {
      const providerData = [
        { ai_provider: 'CURSOR_HEADLESS', _sum: { cost_usd: '1.5' }, _count: 10 },
      ];
      const modelData = [{ model_name: 'gpt-4o', _sum: { cost_usd: '1.5' }, _count: 10 }];
      const totalData = {
        _sum: { cost_usd: '1.5', tokens_input: 100, tokens_output: 50 },
        _count: 10,
      };

      mockPrismaService.aICostLog.groupBy
        .mockResolvedValueOnce(providerData)
        .mockResolvedValueOnce(modelData);
      mockPrismaService.aICostLog.aggregate.mockResolvedValue(totalData);

      const res = await request(app.getHttpServer())
        .get('/api/costs/summary/week')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.period).toBe('week');
      expect(res.body.totalCostUsd).toBe('1.5');
      expect(res.body.byProvider).toHaveLength(1);
    });

    it('GET /api/costs/ticket/:ticketId should return ticket breakdown', async () => {
      mockPrismaService.aICostLog.findMany.mockResolvedValue(mockCostLogs);

      const res = await request(app.getHttpServer())
        .get('/api/costs/ticket/DSF-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.ticketId).toBe('DSF-123');
      expect(res.body.costLogs).toHaveLength(1);
      expect(res.body.costLogs[0].modelName).toBe('gpt-4o');
    });

    it('GET /api/costs/breakdown should return paginated data', async () => {
      const breakdownData = [{ model_name: 'gpt-4o', _sum: { cost_usd: '10.0' }, _count: 5 }];
      mockPrismaService.aICostLog.groupBy
        .mockResolvedValueOnce(breakdownData)
        .mockResolvedValueOnce([{ _count: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/api/costs/breakdown?groupBy=model&page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.groupBy).toBe('model');
      expect(res.body.data[0].groupKey).toBe('gpt-4o');
      expect(res.body.meta.page).toBe(1);
    });
  });
});
