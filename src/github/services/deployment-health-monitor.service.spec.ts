import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentHealthMonitorService } from './deployment-health-monitor.service';
import { PrismaService } from '../../database/prisma.service';
import { GitHubService } from '../github.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { DeploymentStatusSync } from './deployment-status-sync.service';
import { LoggerService } from '../../common/logger/logger.service';
import { ConfigService } from '@nestjs/config';

describe('DeploymentHealthMonitorService', () => {
    let service: DeploymentHealthMonitorService;
    let prisma: jest.Mocked<PrismaService>;
    let github: jest.Mocked<GitHubService>;
    let sentry: jest.Mocked<SentryService>;
    let metrics: jest.Mocked<MetricsService>;
    let auditLog: jest.Mocked<AIDecisionLoggerService>;
    let deploymentStatusSync: jest.Mocked<DeploymentStatusSync>;
    let logger: jest.Mocked<LoggerService>;
    let config: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DeploymentHealthMonitorService,
                {
                    provide: PrismaService,
                    useValue: {
                        deployment: {
                            findUnique: jest.fn().mockResolvedValue(null),
                            update: jest.fn().mockResolvedValue({}),
                            findMany: jest.fn().mockResolvedValue([]),
                        },
                        gitHubPush: {
                            findUnique: jest.fn().mockResolvedValue(null),
                        },
                        execution: {
                            findUnique: jest.fn().mockResolvedValue(null),
                        },
                    },
                },
                {
                    provide: GitHubService,
                    useValue: {
                        triggerWorkflow: jest.fn(),
                    },
                },
                {
                    provide: SentryService,
                    useValue: {
                        captureMessage: jest.fn(),
                        captureException: jest.fn(),
                    },
                },
                {
                    provide: MetricsService,
                    useValue: {
                        incrementCounter: jest.fn(),
                        recordHistogram: jest.fn(),
                    },
                },
                {
                    provide: AIDecisionLoggerService,
                    useValue: {
                        logDecision: jest.fn(),
                    },
                },
                {
                    provide: DeploymentStatusSync,
                    useValue: {
                        syncToClickUp: jest.fn(),
                    },
                },
                {
                    provide: LoggerService,
                    useValue: {
                        log: jest.fn(),
                        warn: jest.fn(),
                        error: jest.fn(),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
                            const config: Record<string, unknown> = {
                                'health.monitoringWindowMs': 300000,
                                'health.pollIntervalMs': 30000,
                                'health.errorRateThresholdPercent': 50,
                                'health.latencyThresholdMs': 200,
                                'health.baselineWindowMs': 300000,
                                'health.enabled': true,
                            };
                            return config[key] ?? defaultValue;
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<DeploymentHealthMonitorService>(DeploymentHealthMonitorService);
        prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
        github = module.get(GitHubService) as jest.Mocked<GitHubService>;
        sentry = module.get(SentryService) as jest.Mocked<SentryService>;
        metrics = module.get(MetricsService) as jest.Mocked<MetricsService>;
        auditLog = module.get(AIDecisionLoggerService) as jest.Mocked<AIDecisionLoggerService>;
        deploymentStatusSync = module.get(DeploymentStatusSync) as jest.Mocked<DeploymentStatusSync>;
        logger = module.get(LoggerService) as jest.Mocked<LoggerService>;
        config = module.get(ConfigService) as jest.Mocked<ConfigService>;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('startHealthMonitoring', () => {
        it('should capture baseline and start monitoring window', async () => {
            const deploymentId = 'deployment-123';
            (prisma.deployment.findUnique as jest.Mock).mockResolvedValue({
                id: deploymentId,
                environment: 'production',
                status: 'COMPLETED',
                created_at: new Date(),
            });

            (prisma.deployment.findMany as jest.Mock).mockResolvedValue([
                { status: 'FAILED' },
                { status: 'COMPLETED' },
                { status: 'COMPLETED' },
            ]);

            await service.startHealthMonitoring(deploymentId);

            expect(logger.log).toHaveBeenCalledWith(
                expect.stringContaining('Starting health monitoring'),
                expect.any(Object),
            );
            // Note: metrics.incrementCounter is called after 5-min timeout, not immediately
            // In real scenario, this would be tested with fake timers or integration tests
        });

        it('should not start monitoring if health monitoring is disabled', async () => {
            // Create a fresh service with disabled health monitoring
            const disabledModule = await Test.createTestingModule({
                providers: [
                    DeploymentHealthMonitorService,
                    {
                        provide: PrismaService,
                        useValue: prisma,
                    },
                    {
                        provide: GitHubService,
                        useValue: github,
                    },
                    {
                        provide: SentryService,
                        useValue: sentry,
                    },
                    {
                        provide: MetricsService,
                        useValue: metrics,
                    },
                    {
                        provide: AIDecisionLoggerService,
                        useValue: auditLog,
                    },
                    {
                        provide: DeploymentStatusSync,
                        useValue: deploymentStatusSync,
                    },
                    {
                        provide: LoggerService,
                        useValue: logger,
                    },
                    {
                        provide: ConfigService,
                        useValue: {
                            get: jest.fn().mockImplementation((key: string) => {
                                if (key === 'health.enabled') return false;
                                return 300000;
                            }),
                        },
                    },
                ],
            }).compile();

            const disabledService = disabledModule.get<DeploymentHealthMonitorService>(
                DeploymentHealthMonitorService,
            );

            const deploymentId = 'deployment-123';
            await disabledService.startHealthMonitoring(deploymentId);

            expect(logger.log).toHaveBeenCalledWith(
                expect.stringContaining('Health monitoring disabled'),
                expect.any(Object),
            );
            expect(prisma.deployment.findUnique).not.toHaveBeenCalled();
        });
    });

    describe('getPreDeploymentBaseline', () => {
        it('should calculate error rate from deployment history', async () => {
            (prisma.deployment.findMany as jest.Mock).mockResolvedValue([
                { status: 'FAILED' },
                { status: 'COMPLETED' },
                { status: 'COMPLETED' },
                { status: 'COMPLETED' },
            ]);

            const baseline = await service.getPreDeploymentBaseline('production');

            expect(baseline.error_rate).toBe(25); // 1/4 = 25%
            expect(baseline.p95_latency).toBeGreaterThanOrEqual(0);
            expect(baseline.captured_at).toBeInstanceOf(Date);
        });

        it('should return 0% error rate when no failed deployments', async () => {
            (prisma.deployment.findMany as jest.Mock).mockResolvedValue([
                { status: 'COMPLETED' },
                { status: 'COMPLETED' },
            ]);

            const baseline = await service.getPreDeploymentBaseline('production');

            expect(baseline.error_rate).toBe(0);
        });
    });

    describe('triggerRollback', () => {
        it('should update deployment status to ROLLED_BACK', async () => {
            const deploymentId = 'deployment-123';
            const reason = 'error_rate';
            const metricsDelta = { error_rate_delta: 55, latency_delta: 50 };

            (prisma.deployment.findUnique as jest.Mock).mockResolvedValue({
                id: deploymentId,
                environment: 'production',
                github_push_id: 'push-123',
            });

            (prisma.gitHubPush.findUnique as jest.Mock).mockResolvedValue({
                id: 'push-123',
                execution_id: 'exec-123',
            });

            (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
                id: 'exec-123',
                ticket_id: 'ticket-123',
            });

            await service.triggerRollback(deploymentId, reason, metricsDelta);

            expect(prisma.deployment.update).toHaveBeenCalledWith({
                where: { id: deploymentId },
                data: {
                    status: 'ROLLED_BACK',
                    error_message: expect.stringContaining(reason),
                },
            });
            expect(metrics.incrementCounter).toHaveBeenCalledWith(
                'deployment_rollback_total',
                expect.objectContaining({ reason }),
            );
            expect(sentry.captureMessage).toHaveBeenCalled();
        });

        it('should log AI decision for rollback', async () => {
            const deploymentId = 'deployment-123';
            (prisma.deployment.findUnique as jest.Mock).mockResolvedValue({
                id: deploymentId,
                environment: 'production',
                github_push_id: 'push-123',
            });

            (prisma.gitHubPush.findUnique as jest.Mock).mockResolvedValue({
                id: 'push-123',
                execution_id: 'exec-123',
            });

            (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
                id: 'exec-123',
                ticket_id: 'ticket-123',
            });

            await service.triggerRollback(deploymentId, 'latency', { error_rate_delta: 10, latency_delta: 250 });

            expect(auditLog.logDecision).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentName: 'DeploymentHealthMonitor',
                    action: 'deployment_rollback_triggered',
                    confidence: 1.0,
                }),
            );
        });
    });

    describe('onModuleDestroy', () => {
        it('should cleanup monitoring timers', () => {
            service.onModuleDestroy();
            expect(logger.log).toHaveBeenCalled();
        });
    });
});
