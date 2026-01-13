import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './../src/app.module';
import { PrismaService } from '@/database/prisma.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
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
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({}),
        },
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        project: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue({}),
        },
        ticket: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn().mockResolvedValue({}),
        },
        ticketDependency: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        aIDecisionLog: {
          create: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        providerHealth: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        webhookEvent: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
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

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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
        expect(body).toHaveProperty('status', 'healthy');
        expect(body).toHaveProperty('timestamp');
        // The service name is NOT in the response per current implementation
      });
  });
});
