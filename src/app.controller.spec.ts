import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';
import { DockerService } from './docker/docker.service';

describe('AppController', () => {
  let appController: AppController;
  // let appService: AppService;
  let prismaService: PrismaService;
  let rabbitMQService: RabbitMQService;
  let dockerService: DockerService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: jest.fn().mockReturnValue('Hello World!'),
            getIntegrationHealth: jest
              .fn()
              .mockResolvedValue({ docker: true, sendgrid: true, openai: false, slack: true }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
          },
        },
        {
          provide: RabbitMQService,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: DockerService,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    prismaService = app.get<PrismaService>(PrismaService);
    rabbitMQService = app.get<RabbitMQService>(RabbitMQService);
    dockerService = app.get<DockerService>(DockerService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('getHealth', () => {
    it('should return healthy status when all services are up', async () => {
      const result = await appController.getHealth();

      expect(result).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        services: {
          database: 'up',
          rabbitmq: 'up',
          docker: 'up',
        },
      });
    });

    it('should return unhealthy status when database is down', async () => {
      jest.spyOn(prismaService, '$queryRaw').mockRejectedValue(new Error('DB Error'));

      await expect(appController.getHealth()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should return unhealthy status when rabbitmq is down', async () => {
      jest.spyOn(rabbitMQService, 'isHealthy').mockResolvedValue(false);

      await expect(appController.getHealth()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should return unhealthy status when docker is down', async () => {
      jest.spyOn(dockerService, 'isHealthy').mockResolvedValue(false);

      await expect(appController.getHealth()).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getIntegrationHealth', () => {
    it('should return integration health status', async () => {
      const expectedHealth = { docker: true, sendgrid: true, openai: false, slack: true };
      const result = await appController.getIntegrationHealth();
      expect(result).toEqual(expectedHealth);
    });
  });
});

describe('Swagger Configuration', () => {
  let module: TestingModule;
  let app: INestApplication | null;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: jest.fn().mockReturnValue('Hello World!'),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
          },
        },
        {
          provide: RabbitMQService,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: DockerService,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();
  });

  afterEach(async () => {
    // Close app instance after each test to prevent open handles
    if (app) {
      await app.close();
      app = null;
    }
  });

  afterAll(async () => {
    await module.close();
  });

  it('should generate valid OpenAPI document', () => {
    app = module.createNestApplication();

    const config = new DocumentBuilder()
      .setTitle('Test API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'JWT-auth')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    expect(document).toBeDefined();
    expect(document.openapi).toBe('3.0.0');
    expect(document.info.title).toBe('Test API');
    expect(document.paths).toBeDefined();
  });

  it('should include JWT security scheme', () => {
    app = module.createNestApplication();

    const config = new DocumentBuilder()
      .setTitle('Test API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'JWT-auth')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    expect(document.components?.securitySchemes?.['JWT-auth']).toBeDefined();
  });
});
