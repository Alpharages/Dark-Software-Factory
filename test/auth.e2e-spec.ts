import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType, RequestMethod } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/constants/roles.enum';
import { PrismaService } from '@/database/prisma.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const createToken = (payload: {
    sub: string;
    email: string;
    name: string;
    role: Role;
  }): string => {
    return jwtService.sign(payload);
  };

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
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({}),
        },
        ticket: {
          groupBy: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        execution: {
          groupBy: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        fileLock: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        qaResult: {
          create: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        qAResult: {
          create: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        providerHealth: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        aIDecisionLog: {
          create: jest.fn().mockResolvedValue({}),
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
        publishToQueue: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('api', {
      exclude: [{ path: 'metrics', method: RequestMethod.GET }],
    });

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public endpoints', () => {
    it('GET /api/v1 should be accessible without token', () => {
      return request(app.getHttpServer()).get('/api/v1').expect(200);
    });

    it('GET /api/v1/health should be accessible without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('services');
        });
    });
  });

  describe('Protected endpoints', () => {
    it('GET /api/v1/profile should return 401 without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/profile')
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Authentication required');
        });
    });

    it('GET /api/v1/profile should return 401 with invalid token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('GET /api/v1/profile should return 401 with expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', role: Role.PM, email: 'test@test.com', name: 'Test' },
        { expiresIn: '-1h' },
      );

      return request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('expired');
        });
    });

    it('GET /api/v1/profile should return user with valid token', () => {
      const token = createToken({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      });

      return request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe('user-123');
          expect(res.body.email).toBe('test@example.com');
          expect(res.body.role).toBe(Role.PM);
        });
    });
  });

  describe('Role-based access', () => {
    it('GET /api/v1/admin/stats should return 403 for VIEWER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'viewer@test.com',
        name: 'Viewer',
        role: Role.VIEWER,
      });

      return request(app.getHttpServer())
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('GET /api/v1/admin/stats should return 200 for ADMIN role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'admin@test.com',
        name: 'Admin',
        role: Role.ADMIN,
      });

      return request(app.getHttpServer())
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('GET /api/v1/admin/stats should return 200 for MANAGER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'manager@test.com',
        name: 'Manager',
        role: Role.MANAGER,
      });

      return request(app.getHttpServer())
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
