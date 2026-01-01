import { Test, TestingModule } from '@nestjs/testing';
import { ClickUpPollingOrchestrator } from './clickup-polling-orchestrator.service';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from './clickup.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { LoggerService } from '@/common/logger/logger.service';
import { ConfigService } from '@nestjs/config';

describe('ClickUpPollingOrchestrator', () => {
    let service: ClickUpPollingOrchestrator;
    let prisma: PrismaService;
    let logger: LoggerService;

    const mockPrismaService = {
        project: {
            findMany: jest.fn(),
        },
    };

    const mockClickUpService = {
        getTasks: jest.fn(),
    };

    const mockRabbitMQService = {
        publishToQueue: jest.fn(),
    };

    const mockMetricsService = {
        recordHistogram: jest.fn(),
        incrementCounter: jest.fn(),
    };

    const mockSentryService = {
        captureException: jest.fn(),
    };

    const mockLoggerService = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    };

    const mockConfigService = {
        get: jest.fn((key: string, defaultValue?: any) => {
            if (key === 'CLICKUP_USE_WEBHOOKS') return 'false';
            return defaultValue;
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ClickUpPollingOrchestrator,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: ClickUpService, useValue: mockClickUpService },
                { provide: RabbitMQService, useValue: mockRabbitMQService },
                { provide: MetricsService, useValue: mockMetricsService },
                { provide: SentryService, useValue: mockSentryService },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<ClickUpPollingOrchestrator>(ClickUpPollingOrchestrator);
        prisma = module.get<PrismaService>(PrismaService);
        logger = module.get<LoggerService>(LoggerService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        service.onModuleDestroy();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('onModuleInit', () => {
        it('should fetch monitored projects and start polling', async () => {
            const projects = [
                { clickup_list_id: '123' },
                { clickup_list_id: '456' }
            ];
            mockPrismaService.project.findMany.mockResolvedValue(projects);

            // Spy on startPolling
            const startPollingSpy = jest.spyOn(service, 'startPolling').mockImplementation(async () => { });

            await service.onModuleInit();

            expect(prisma.project.findMany).toHaveBeenCalledWith({
                where: {
                    provider: 'CLICKUP',
                    monitor_tasks: true,
                    status: 'active',
                },
                select: {
                    clickup_list_id: true,
                },
            });
            expect(startPollingSpy).toHaveBeenCalledTimes(2);
            expect(startPollingSpy).toHaveBeenCalledWith('123');
            expect(startPollingSpy).toHaveBeenCalledWith('456');
        });

        it('should handle db errors gracefully', async () => {
            mockPrismaService.project.findMany.mockRejectedValue(new Error('DB Error'));

            await service.onModuleInit();

            expect(logger.error).toHaveBeenCalledWith('Failed to fetch monitored projects from DB', expect.any(String));
        });
    });

    describe('refreshMonitoredLists', () => {
        it('should refresh polling list based on DB state', async () => {
            // Setup: 123 is currently polling, 456 is new, 123 is removed
            // Actually logic says: get from DB, start new ones, stop old ones.

            // Mock active polling state
            // We can't easily set private property map, but we can rely on startPolling/stopPolling spies
            // if we could simulate state. 
            // Strategy: Use startPolling implementation to set state (mocking just internal parts is hard).
            // Let's rely on spying start/stop calls.

            // Mock findMany returns '456'
            mockPrismaService.project.findMany.mockResolvedValue([{ clickup_list_id: '456' }]);

            // Mock `isPolling` to return true for '123' and false for '456'
            // Since isPolling is private, we can't mock it directly easily without ts-ignore or prototype.
            // But we can assume the service logic is sound and just verify start/stop.
            // We need to validly adding '123' to state first.

            // Manually add to map using 'any' cast if necessary or use startPolling
            (service as any).pollingStates.set('123', {
                listId: '123',
                isActive: true,
                timeoutHandle: setTimeout(() => { }, 1000)
            });

            const startSpy = jest.spyOn(service, 'startPolling').mockResolvedValue();
            const stopSpy = jest.spyOn(service, 'stopPolling');

            await service.refreshMonitoredLists();

            expect(startSpy).toHaveBeenCalledWith('456');
            expect(stopSpy).toHaveBeenCalledWith('123', undefined);
        });
    });
});
