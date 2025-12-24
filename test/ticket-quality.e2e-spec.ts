import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/constants/roles.enum';
import { PrismaService } from '@/database/prisma.service';

/**
 * Story 2.11: Ticket Quality Scoring API E2E Tests
 * FR4: PMs can view ticket quality score before submitting
 */
describe('Ticket Quality API (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const createToken = (role: Role, userId = 'user-123'): string => {
    return jwtService.sign({
      sub: userId,
      email: `${role.toLowerCase()}@test.com`,
      name: `Test ${role}`,
      role,
    });
  };

  // Valid ticket request for testing
  const validTicketRequest = {
    title: 'Implement user authentication for login endpoint',
    description:
      'Add JWT-based authentication to enable secure login because users need to access protected resources. This requires changes to src/auth/ module.',
    acceptanceCriteria:
      'Given valid credentials When user submits login Then JWT token is returned within 200ms\nGiven invalid token When access protected Then 401 Unauthorized',
    tags: ['auth', 'security'],
    contextDocuments: ['auth-spec.md'],
    prerequisites: ['Story 1.5'],
  };

  // Minimal ticket request (poor quality)
  const minimalTicketRequest = {
    title: 'Fix',
    description: 'Bug',
    acceptanceCriteria: 'Works',
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
        execution: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
        ticket: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/ticket-quality/score', () => {
    it('should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .send(validTicketRequest)
        .expect(401);
    });

    it('should return 403 for VIEWER role (unauthorized)', () => {
      const token = createToken(Role.VIEWER);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(403);
    });

    it('should return 403 for TL role (unauthorized)', () => {
      const token = createToken(Role.TL);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(403);
    });

    it('should return 200 with quality score for PM role', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalScore');
          expect(res.body).toHaveProperty('grade');
          expect(res.body).toHaveProperty('gradeEmoji');
          expect(res.body).toHaveProperty('gradeMessage');
          expect(res.body).toHaveProperty('breakdown');
          expect(res.body).toHaveProperty('topSuggestions');
          expect(res.body).toHaveProperty('meetsMinimumThreshold');
          expect(res.body).toHaveProperty('scoredAt');

          expect(res.body.totalScore).toBeGreaterThanOrEqual(0);
          expect(res.body.totalScore).toBeLessThanOrEqual(100);
          expect(['excellent', 'good', 'fair', 'poor']).toContain(res.body.grade);
        });
    });

    it('should return 200 with quality score for ADMIN role', () => {
      const token = createToken(Role.ADMIN);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(200)
        .expect((res) => {
          expect(res.body.totalScore).toBeGreaterThanOrEqual(70);
          expect(['excellent', 'good']).toContain(res.body.grade);
        });
    });

    it('should return 200 with quality score for MANAGER role', () => {
      const token = createToken(Role.MANAGER);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(200);
    });

    it('should return poor grade for minimal ticket', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(minimalTicketRequest)
        .expect(200)
        .expect((res) => {
          expect(res.body.grade).toBe('poor');
          expect(res.body.gradeEmoji).toBe('❌');
          expect(res.body.meetsMinimumThreshold).toBe(false);
          expect(res.body.topSuggestions.length).toBeGreaterThan(0);
        });
    });

    it('should return detailed breakdown with category scores', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(200)
        .expect((res) => {
          const { breakdown } = res.body;

          expect(breakdown).toHaveProperty('titleClarity');
          expect(breakdown).toHaveProperty('descriptionCompleteness');
          expect(breakdown).toHaveProperty('acceptanceCriteria');
          expect(breakdown).toHaveProperty('contextDocuments');
          expect(breakdown).toHaveProperty('taskComplexity');
          expect(breakdown).toHaveProperty('prerequisites');

          // Each category should have score, maxPoints, percentage, suggestions, details
          expect(breakdown.titleClarity).toHaveProperty('score');
          expect(breakdown.titleClarity).toHaveProperty('maxPoints');
          expect(breakdown.titleClarity).toHaveProperty('percentage');
          expect(breakdown.titleClarity).toHaveProperty('suggestions');
          expect(breakdown.titleClarity).toHaveProperty('details');
        });
    });

    it('should return 400 for missing required fields', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Only title' })
        .expect(400);
    });

    it('should return 400 for invalid field types', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 123, // Should be string
          description: 'Valid',
          acceptanceCriteria: 'Valid',
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/ticket-quality/quick-check', () => {
    it('should return only score and grade', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/quick-check')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('score');
          expect(res.body).toHaveProperty('grade');
          // Quick check should NOT have detailed breakdown
          expect(res.body).not.toHaveProperty('breakdown');
          expect(res.body).not.toHaveProperty('topSuggestions');
        });
    });

    it('should return 403 for unauthorized roles', () => {
      const token = createToken(Role.QA);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/quick-check')
        .set('Authorization', `Bearer ${token}`)
        .send(validTicketRequest)
        .expect(403);
    });
  });

  describe('POST /api/v1/ticket-quality/batch-score', () => {
    it('should score multiple tickets', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/batch-score')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tickets: [validTicketRequest, minimalTicketRequest],
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('results');
          expect(res.body).toHaveProperty('processedCount');
          expect(res.body).toHaveProperty('averageScore');

          expect(res.body.results).toHaveLength(2);
          expect(res.body.processedCount).toBe(2);
          expect(res.body.averageScore).toBeGreaterThanOrEqual(0);
          expect(res.body.averageScore).toBeLessThanOrEqual(100);

          // First ticket (valid) should have higher score than second (minimal)
          expect(res.body.results[0].totalScore).toBeGreaterThan(res.body.results[1].totalScore);
        });
    });

    it('should return 400 for empty tickets array', () => {
      const token = createToken(Role.PM);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/batch-score')
        .set('Authorization', `Bearer ${token}`)
        .send({ tickets: [] })
        .expect(400); // Empty batch now returns validation error
    });

    it('should return 403 for unauthorized roles', () => {
      const token = createToken(Role.VIEWER);

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/batch-score')
        .set('Authorization', `Bearer ${token}`)
        .send({ tickets: [validTicketRequest] })
        .expect(403);
    });
  });

  describe('Quality scoring accuracy', () => {
    it('should score well-formed tickets higher', () => {
      const token = createToken(Role.PM);

      const wellFormedTicket = {
        title: 'Implement JWT authentication for secure user login endpoint',
        description:
          'Add JWT-based authentication to the user service because we need to secure user sessions so that users can safely manage their accounts. This involves updating src/auth/auth.service.ts and adding a new endpoint.',
        acceptanceCriteria:
          'Given valid credentials When user submits login request Then JWT token returned within 200ms\nGiven invalid credentials When user submits login Then 401 Unauthorized returned\nGiven expired token When accessing protected route Then 401 returned with refresh hint',
        tags: ['authentication', 'security', 'api'],
        contextDocuments: ['auth-spec.md', 'security-guidelines.pdf'],
        prerequisites: ['Story 1.5 Database', 'Story 1.6 JWT Service'],
      };

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(wellFormedTicket)
        .expect(200)
        .expect((res) => {
          // Well-formed ticket should score at least 70 (good)
          expect(res.body.totalScore).toBeGreaterThanOrEqual(70);
          expect(['excellent', 'good']).toContain(res.body.grade);
          expect(res.body.meetsMinimumThreshold).toBe(true);
        });
    });

    it('should identify poor quality tickets', () => {
      const token = createToken(Role.PM);

      const poorTicket = {
        title: 'Bug',
        description: 'Fix it',
        acceptanceCriteria: 'Works',
      };

      return request(app.getHttpServer())
        .post('/api/v1/ticket-quality/score')
        .set('Authorization', `Bearer ${token}`)
        .send(poorTicket)
        .expect(200)
        .expect((res) => {
          expect(res.body.totalScore).toBeLessThan(50);
          expect(res.body.grade).toBe('poor');
          expect(res.body.meetsMinimumThreshold).toBe(false);
          // Should have suggestions for improvement
          expect(res.body.topSuggestions.length).toBeGreaterThan(0);
        });
    });
  });
});
