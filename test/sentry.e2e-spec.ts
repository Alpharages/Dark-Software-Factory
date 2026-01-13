import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@/database/prisma.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';

/**
 * Mock PrismaService for E2E tests to bypass database requirements
 * This prevents database authentication errors during testing
 */

describe('Sentry Integration (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
        project: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        execution: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          groupBy: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
        providerHealth: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        aIDecisionLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        fileLock: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        qaResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        qAResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      })
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
      })
      .compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes without Sentry capture', async () => {
      const response = await request(app.getHttpServer()).get('/unknown-route-test').expect(404);

      expect(response.body).toHaveProperty('statusCode', 404);
      // 404s should NOT have sentryEventId (not captured per design)
      expect(response.body.sentryEventId).toBeUndefined();
    });

    it('should include timestamp in error responses', async () => {
      const response = await request(app.getHttpServer()).get('/unknown-route-test').expect(404);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Health Endpoints', () => {
    it('should respond to health checks without Sentry capture', async () => {
      // Health endpoint should not trigger Sentry events
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Metrics Endpoint', () => {
    it('should expose Prometheus metrics endpoint', async () => {
      const response = await request(app.getHttpServer()).get('/metrics').expect(200);

      expect(response.text).toContain('# HELP');
      expect(response.text).toContain('# TYPE');
    });
  });
});
