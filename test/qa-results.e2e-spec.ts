/**
 * QA Results API E2E Tests
 * Story 3.6: QA Results Storage & Retrieval
 * Tests API endpoints with authentication and authorization
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/constants/roles.enum';
import { PrismaService } from '@/database/prisma.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';

describe('QA Results API (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockQaResult = {
    id: 'qa-result-e2e-1',
    execution_id: 'exec-e2e-1',
    linting_passed: true,
    linting_errors: null,
    tests_passed: true,
    test_results: { total: 10, passed: 10, failed: 0 },
    test_coverage: 85.5,
    code_review_passed: true,
    code_review_issues: null,
    overall_passed: true,
    created_at: new Date('2025-12-01T10:00:00Z'),
    updated_at: new Date('2025-12-01T10:05:00Z'),
    execution: {
      id: 'exec-e2e-1',
      ticket_id: 'ticket-e2e-1',
      ai_provider: 'CLAUDE_CODE',
      status: 'COMPLETED',
      ticket: {
        id: 'ticket-e2e-1',
        title: 'E2E Test Ticket',
        project_id: 'project-e2e-1',
        clickup_task_id: 'clickup-e2e-1',
      },
    },
  };

  const mockPrismaService = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    qAResult: {
      findFirst: jest.fn().mockResolvedValue(mockQaResult),
      findMany: jest.fn().mockResolvedValue([mockQaResult]),
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({
        _count: { id: 1 },
        _avg: { test_coverage: 85.5 },
      }),
      update: jest.fn().mockResolvedValue(mockQaResult),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    execution: {
      findUnique: jest.fn().mockResolvedValue({ id: 'exec-e2e-1' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'exec-e2e-1' }]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ticket: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ticket-e2e-1' }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    workspace: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    project: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    providerHealth: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };

  const createToken = (role: Role): string => {
    return jwtService.sign({
      sub: `user-${role}`,
      email: `${role}@test.com`,
      name: `Test ${role}`,
      role,
    });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RabbitMQService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        getConnection: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
        getChannel: jest.fn().mockReturnValue({
          assertQueue: jest.fn().mockResolvedValue({}),
          assertExchange: jest.fn().mockResolvedValue({}),
          bindQueue: jest.fn().mockResolvedValue({}),
          consume: jest.fn().mockResolvedValue({ consumerTag: 'test' }),
          prefetch: jest.fn(),
          cancel: jest.fn().mockResolvedValue({}),
          close: jest.fn().mockResolvedValue({}),
          checkQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
        }),
        publishToQueue: jest.fn().mockResolvedValue(true),
      })
      .overrideProvider(RabbitMQPublisherService)
      .useValue({
        publish: jest.fn(),
        publishToQueue: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/qa-results/:executionId', () => {
    it('should return 401 without authentication', () => {
      return request(app.getHttpServer()).get('/api/v1/qa-results/exec-e2e-1').expect(401);
    });

    it('should return QA result for authenticated QA user', async () => {
      const token = createToken(Role.QA);

      const response = await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('execution_id');
      expect(response.body).toHaveProperty('overall_passed');
    });

    it('should return QA result for PM role', async () => {
      const token = createToken(Role.PM);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should return QA result for ADMIN role', async () => {
      const token = createToken(Role.ADMIN);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should return 404 when result not found', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValueOnce(null);
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/non-existent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/qa-results', () => {
    it('should return paginated results', async () => {
      const token = createToken(Role.QA);

      const response = await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pageInfo');
      expect(response.body.pageInfo).toHaveProperty('total');
      expect(response.body.pageInfo).toHaveProperty('page');
      expect(response.body.pageInfo).toHaveProperty('hasNextPage');
    });

    it('should filter by projectId', async () => {
      const token = createToken(Role.PM);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .query({ projectId: 'project-e2e-1' })
        .expect(200);

      expect(mockPrismaService.execution.findMany).toHaveBeenCalled();
    });

    it('should filter by status=passed', async () => {
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .query({ status: 'passed' })
        .expect(200);
    });

    it('should filter by date range', async () => {
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .query({
          startDate: '2025-12-01',
          endDate: '2025-12-31',
        })
        .expect(200);
    });
  });

  describe('GET /api/v1/qa-results/metrics/:projectId', () => {
    it('should return metrics for QA role', async () => {
      const token = createToken(Role.QA);

      const response = await request(app.getHttpServer())
        .get('/api/v1/qa-results/metrics/project-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('projectId');
      expect(response.body).toHaveProperty('totalExecutions');
      expect(response.body).toHaveProperty('passRate');
    });

    it('should return metrics for MANAGER role', async () => {
      const token = createToken(Role.MANAGER);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/metrics/project-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should accept date range parameters', async () => {
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/metrics/project-e2e-1')
        .set('Authorization', `Bearer ${token}`)
        .query({
          startDate: '2025-12-01T00:00:00Z',
          endDate: '2025-12-31T23:59:59Z',
        })
        .expect(200);
    });
  });

  describe('POST /api/v1/quality-gate/:executionId/override', () => {
    it('should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .send({ reason: 'test', approvedBy: 'user-1' })
        .expect(401);
    });

    it('should allow QA role to override', async () => {
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Critical hotfix required',
          approvedBy: 'manager-1',
        })
        .expect(201);
    });

    it('should allow MANAGER role to override', async () => {
      const token = createToken(Role.MANAGER);

      await request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Emergency deployment',
          approvedBy: 'admin-1',
        })
        .expect(201);
    });

    it('should allow ADMIN role to override', async () => {
      const token = createToken(Role.ADMIN);

      await request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Security patch',
          approvedBy: 'admin-1',
        })
        .expect(201);
    });

    it('should validate request body', async () => {
      const token = createToken(Role.ADMIN);

      await request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should create audit log on override', async () => {
      const token = createToken(Role.QA);

      await request(app.getHttpServer())
        .post('/api/v1/quality-gate/exec-e2e-1/override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Audit test',
          approvedBy: 'manager-1',
        })
        .expect(201);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('Authorization matrix', () => {
    it('should allow QA role access to all QA result endpoints', async () => {
      const token = createToken(Role.QA);

      // Test GET /qa-results/:executionId
      await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-1')
        .set('Authorization', `Bearer ${token}`)
        .expect((res: request.Response) => {
          expect([200, 404]).toContain(res.status);
        });

      // Test GET /qa-results
      await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Test GET /qa-results/metrics/:projectId
      await request(app.getHttpServer())
        .get('/api/v1/qa-results/metrics/project-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should allow PM role access to result and query endpoints', async () => {
      const token = createToken(Role.PM);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-1')
        .set('Authorization', `Bearer ${token}`)
        .expect((res: request.Response) => {
          expect([200, 404]).toContain(res.status);
        });

      await request(app.getHttpServer())
        .get('/api/v1/qa-results')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should allow TL role access to result and query endpoints', async () => {
      const token = createToken(Role.TL);

      await request(app.getHttpServer())
        .get('/api/v1/qa-results/exec-1')
        .set('Authorization', `Bearer ${token}`)
        .expect((res: request.Response) => {
          expect([200, 404]).toContain(res.status);
        });
    });
  });
});
