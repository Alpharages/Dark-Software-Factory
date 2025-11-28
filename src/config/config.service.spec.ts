import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './configuration';

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
        // NODE_ENV defaults to 'development' in configuration.ts if unset
        const isDev = configService.get<boolean>('isDevelopment');
        expect(isDev).toBe(true);
    });

    it('should provide default values', () => {
        const port = configService.get<number>('port');
        expect(port).toBeGreaterThan(0);
    });
});
