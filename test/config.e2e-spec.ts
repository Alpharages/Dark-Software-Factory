import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { envValidationSchema } from '../src/config/env.validation';

describe('Configuration (e2e)', () => {
    let app: INestApplication;
    let configService: ConfigService;

    beforeAll(async () => {
        // Set minimal required env vars for testing
        process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
        process.env.RABBITMQ_URL = 'amqp://test:test@localhost:5672';
        process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
        process.env.GITHUB_TOKEN = 'ghp_testtoken';
        process.env.CLICKUP_API_KEY = 'test-key';
        process.env.CLICKUP_WEBHOOK_SECRET = 'test-secret-16-chars';
        process.env.AUTH_SERVICE_URL = 'http://localhost:4000';
        process.env.CURSOR_API_KEY = 'test-key';

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
        const providers = configService.get('aiProviders');
        const hasProvider =
            providers.cursor.enabled ||
            providers.windsurf.enabled ||
            providers.antigravity.enabled;

        expect(hasProvider).toBe(true);
    });
});
