import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return app
      .inject({
        method: 'GET',
        url: '/health',
      })
      .then((result) => {
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.payload);
        expect(body).toHaveProperty('status', 'ok');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('service', 'ai-dev-orchestrator');
      });
  });
});
