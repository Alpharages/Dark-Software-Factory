import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/constants/roles.enum';
import { PrismaService } from '../src/database/prisma.service';

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
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public endpoints', () => {
    it('GET / should be accessible without token', () => {
      return request(app.getHttpServer()).get('/').expect(200);
    });

    it('GET /health should be accessible without token', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('services');
        });
    });
  });

  describe('Protected endpoints', () => {
    it('GET /profile should return 401 without token', () => {
      return request(app.getHttpServer())
        .get('/profile')
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Authentication required');
        });
    });

    it('GET /profile should return 401 with invalid token', () => {
      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('GET /profile should return 401 with expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', role: Role.PM, email: 'test@test.com', name: 'Test' },
        { expiresIn: '-1h' },
      );

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('expired');
        });
    });

    it('GET /profile should return user with valid token', () => {
      const token = createToken({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      });

      return request(app.getHttpServer())
        .get('/profile')
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
    it('GET /admin/stats should return 403 for VIEWER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'viewer@test.com',
        name: 'Viewer',
        role: Role.VIEWER,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('GET /admin/stats should return 200 for ADMIN role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'admin@test.com',
        name: 'Admin',
        role: Role.ADMIN,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('GET /admin/stats should return 200 for MANAGER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'manager@test.com',
        name: 'Manager',
        role: Role.MANAGER,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
