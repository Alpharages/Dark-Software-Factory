"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const app_controller_1 = require("./app.controller");
describe('AppController', () => {
    let appController;
    beforeEach(async () => {
        const app = await testing_1.Test.createTestingModule({
            controllers: [app_controller_1.AppController],
        }).compile();
        appController = app.get(app_controller_1.AppController);
    });
    describe('health', () => {
        it('should return health status', () => {
            const result = appController.health();
            expect(result).toHaveProperty('status', 'ok');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('service', 'ai-dev-orchestrator');
        });
    });
});
