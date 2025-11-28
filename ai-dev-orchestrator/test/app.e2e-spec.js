"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const app_module_1 = require("./../src/app.module");
describe('AppController (e2e)', () => {
    let app;
    beforeEach(async () => {
        const moduleFixture = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleFixture.createNestApplication(new platform_fastify_1.FastifyAdapter());
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
