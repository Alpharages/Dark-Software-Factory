// Set required environment variables for all tests
// This runs before any test files are loaded
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-testing-purposes';
process.env.AUTH_SERVICE_URL = 'http://localhost:4000';
process.env.GITHUB_TOKEN = 'ghp_testtoken1234567890';
process.env.GITHUB_DEFAULT_REPOSITORY = 'https://github.com/test-org/test-repo';
process.env.CLICKUP_API_KEY = 'test-clickup-key';
process.env.CLICKUP_WEBHOOK_SECRET = 'test-webhook-secret-16chars';
process.env.CURSOR_API_KEY = 'test-cursor-key';
process.env.NODE_ENV = 'test';
process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
