import { Test, TestingModule } from '@nestjs/testing';
import { AdrMetricsService } from './adr-metrics.service';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';
// import { getRepositoryToken } from '@nestjs/typeorm'; // Likely not needed if using Prisma
import { AdrStatus, RiskLevel } from '@/prisma/client';

describe('AdrMetricsService', () => {
    let service: AdrMetricsService;
    let prisma: PrismaService;
    let metricsService: MetricsService;
    let reviewsCounter: any;
    let durationHistogram: any;

    const mockPrismaService = {
        $queryRaw: jest.fn(),
        adr: {
            count: jest.fn(),
            findMany: jest.fn(),
            groupBy: jest.fn(),
        },
        $enums: {
            AdrStatus: AdrStatus
        }
    };

    const mockMetricsService = {
        incrementCounter: jest.fn(),
        recordHistogram: jest.fn(),
        setGauge: jest.fn(),
    };

    const mockReviewsCounter: any = { inc: jest.fn(), labels: jest.fn() };
    const mockDurationHistogram: any = { observe: jest.fn(), labels: jest.fn() };
    const mockQueueDepthGauge = { set: jest.fn() };
    const mockApprovalRateGauge = { set: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AdrMetricsService,
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
                {
                    provide: MetricsService,
                    useValue: mockMetricsService,
                },
                {
                    provide: 'PROM_METRIC_ADR_REVIEWS_TOTAL',
                    useValue: mockReviewsCounter
                },
                {
                    provide: 'PROM_METRIC_ADR_REVIEW_DURATION_SECONDS',
                    useValue: mockDurationHistogram
                },
                {
                    provide: 'PROM_METRIC_ADR_QUEUE_DEPTH',
                    useValue: mockQueueDepthGauge
                },
                {
                    provide: 'PROM_METRIC_ADR_APPROVAL_RATE',
                    useValue: mockApprovalRateGauge
                }
            ],
        }).compile();

        service = module.get<AdrMetricsService>(AdrMetricsService);
        prisma = module.get<PrismaService>(PrismaService);
        reviewsCounter = module.get('PROM_METRIC_ADR_REVIEWS_TOTAL');
        durationHistogram = module.get('PROM_METRIC_ADR_REVIEW_DURATION_SECONDS');
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('trackReviewCompleted', () => {
        it('should increment review counter and record duration', async () => {
            const adr = {
                id: '1',
                status: AdrStatus.ACCEPTED,
                execution: { ticket: { project_id: 'proj1' } },
                risk_level: RiskLevel.LOW,
                review_duration_seconds: 120
            };

            // Mock labels().inc() chain
            mockReviewsCounter.labels = jest.fn().mockReturnValue({ inc: jest.fn() });
            mockDurationHistogram.labels = jest.fn().mockReturnValue({ observe: jest.fn() });

            mockPrismaService.adr.count.mockResolvedValue(5); // Queue depth

            await service.trackReviewCompleted(adr as any, 'APPROVE');

            expect(mockReviewsCounter.labels).toHaveBeenCalledWith('APPROVE', 'LOW', 'proj1');
            // Verify inc() was called on the result of labels()
            expect(mockReviewsCounter.labels().inc).toHaveBeenCalled();

            expect(mockDurationHistogram.labels).toHaveBeenCalledWith('LOW');
            expect(mockDurationHistogram.labels().observe).toHaveBeenCalledWith(120);
        });
    });

    describe('getReviewMetrics', () => {
        it('should calculate metrics correctly', async () => {
            // Mock data
            mockPrismaService.$queryRaw.mockResolvedValue([{ date: new Date(), count: 10n }]);

            // Mock groupBy calls in order
            // 1. Status counts (Approval Rate)
            mockPrismaService.adr.groupBy.mockResolvedValueOnce([
                { status: AdrStatus.ACCEPTED, _count: 45 },
                { status: AdrStatus.REJECTED, _count: 5 }
            ]);

            // 2. Risk counts (Risk Distribution)
            mockPrismaService.adr.groupBy.mockResolvedValueOnce([
                { risk_level: 'HIGH', _count: 5 }
            ]);

            // Mock findMany calls
            // 1. Rejection reasons
            // 2. Queue metrics
            mockPrismaService.adr.findMany
                .mockResolvedValueOnce([
                    { rejection_reason: 'Security issue', status: 'REJECTED' }
                ])
                .mockResolvedValueOnce([
                    { created_at: new Date(Date.now() - 60000), status: 'PROPOSED' }
                ]);

            // Queue depth
            mockPrismaService.adr.count.mockResolvedValue(5);

            const metrics = await service.getReviewMetrics('proj-1');

            expect(metrics.approval_rate['ACCEPTED']).toBe(90); // 45/50 * 100
            expect(metrics.risk_distribution).toHaveProperty('HIGH', 5);
            expect(metrics.top_rejection_reasons).toBeDefined();
        });
    });
});
