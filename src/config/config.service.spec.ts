import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './configuration';
import { envValidationSchema } from './env.validation';

describe('ConfigService', () => {
  let configService: ConfigService;

  beforeEach(async () => {
    // Set test environment variables
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
    process.env.RABBITMQ_URL = 'amqp://test:test@localhost:5672';
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
    process.env.CURSOR_API_KEY = 'test-cursor-key';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          ignoreEnvFile: true, // Use process.env only in tests
        }),
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(configService).toBeDefined();
  });

  it('should load database URL', () => {
    const dbUrl = configService.get<string>('database.url');
    expect(dbUrl).toBe('postgresql://test:test@localhost:5432/test_db');
  });

  it('should load JWT secret', () => {
    const jwtSecret = configService.get<string>('auth.jwtSecret');
    expect(jwtSecret).toBe('test-secret-at-least-32-characters-long');
  });

  it('should detect development environment', () => {
    // In test environment, NODE_ENV is likely 'test' not 'development'
    // So isDevelopment would be false. Let's check current env
    const nodeEnv = configService.get<string>('nodeEnv');
    const isDev = configService.get<boolean>('isDevelopment');

    // Verify consistency: isDevelopment should match nodeEnv === 'development'
    expect(isDev).toBe(nodeEnv === 'development');
  });

  it('should provide default values', () => {
    const port = configService.get<number>('port');
    expect(port).toBeGreaterThan(0);
  });
});

describe('ConfigService - Validation Failures', () => {
  it('should fail when DATABASE_URL is missing', async () => {
    const originalValue = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            load: [configuration],
            validationSchema: envValidationSchema,
            ignoreEnvFile: true,
          }),
        ],
      }).compile(),
    ).rejects.toThrow();

    // Restore
    process.env.DATABASE_URL = originalValue;
  });

  it('should fail when JWT_SECRET is too short', async () => {
    const originalValue = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short'; // <32 chars

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            load: [configuration],
            validationSchema: envValidationSchema,
            ignoreEnvFile: true,
          }),
        ],
      }).compile(),
    ).rejects.toThrow();

    // Restore
    process.env.JWT_SECRET = originalValue;
  });

  it('should not fail when no AI provider is configured (currently optional)', async () => {
    const cursorKey = process.env.CURSOR_API_KEY;
    const windsurfKey = process.env.WINDSURF_API_KEY;
    const antigravityKey = process.env.ANTIGRAVITY_API_KEY;

    delete process.env.CURSOR_API_KEY;
    delete process.env.WINDSURF_API_KEY;
    delete process.env.ANTIGRAVITY_API_KEY;

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            load: [configuration],
            validationSchema: envValidationSchema,
            ignoreEnvFile: true,
          }),
        ],
      }).compile(),
    ).resolves.toBeDefined();

    // Restore
    if (cursorKey) process.env.CURSOR_API_KEY = cursorKey;
    if (windsurfKey) process.env.WINDSURF_API_KEY = windsurfKey;
    if (antigravityKey) process.env.ANTIGRAVITY_API_KEY = antigravityKey;
  });
});
