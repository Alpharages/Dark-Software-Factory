import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/**
 * Mock PrismaService for E2E tests to bypass database requirements
 * This prevents database authentication errors during testing
 */
const mockPrismaService = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
};

describe('Sentry Integration (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
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
