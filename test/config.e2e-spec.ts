import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { envValidationSchema } from '../src/config/env.validation';

describe('Configuration (e2e)', () => {
  let app: INestApplication;
  let configService: ConfigService;

  beforeAll(async () => {
    // Note: Environment variables are set globally in test/jest-setup.ts
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    configService = app.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should validate required configuration exists', () => {
    const requiredConfigs = [
      'database.url',
      'auth.jwtSecret',
      'github.token',
      'clickup.webhookSecret',
    ];

    requiredConfigs.forEach((key) => {
      const value = configService.get(key);
      expect(value).toBeDefined();
      expect(value).not.toBe('');
    });
  });

  it('should have at least one AI provider configured', () => {
    const providers = configService.get('ai.providers');
    const hasProvider = providers.cursorHeadless?.enabled || providers.claudeCode?.enabled;

    expect(hasProvider).toBeDefined();
  });
});
