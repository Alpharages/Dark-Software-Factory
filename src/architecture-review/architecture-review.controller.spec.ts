
import { Test, TestingModule } from '@nestjs/testing';
import { ArchitectureReviewController } from './architecture-review.controller';
import { AdrService } from './adr.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AdrReviewActionDto, AdrReviewAction } from './dto';
import { AdrStatus } from '@/prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('ArchitectureReviewController', () => {
    let controller: ArchitectureReviewController;
    let adrService: AdrService;
    let metricsService: MetricsService;

    const mockAdrService = {
        getReviewQueue: jest.fn(),
        reviewAdr: jest.fn(),
    };

    const mockMetricsService = {
        incrementCounter: jest.fn(),
        setGauge: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ArchitectureReviewController],
            providers: [
                { provide: AdrService, useValue: mockAdrService },
                { provide: MetricsService, useValue: mockMetricsService },
            ],
        })
            .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
            .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
            .compile();

        controller = module.get<ArchitectureReviewController>(ArchitectureReviewController);
        adrService = module.get<AdrService>(AdrService);
        metricsService = module.get<MetricsService>(MetricsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getQueue', () => {
        it('should return the review queue and record metrics', async () => {
            const mockQueue = [{ id: 'adr-1', title: 'ADR 1' }];
            mockAdrService.getReviewQueue.mockResolvedValue(mockQueue);

            const result = await controller.getQueue({ status: 'PROPOSED' });

            expect(result.items).toEqual(mockQueue);
            expect(metricsService.incrementCounter).toHaveBeenCalledWith('adr_queue_accessed_total', expect.any(Object));
            expect(metricsService.setGauge).toHaveBeenCalledWith('adr_queue_depth', 1);
        });
    });

    describe('reviewAdr', () => {
        it('should review an ADR and record metrics', async () => {
            const dto: AdrReviewActionDto = { action: AdrReviewAction.APPROVE, notes: 'Good job' };
            const mockResponse = {
                success: true,
                message: 'Approved',
                adr: { id: 'adr-1', status: AdrStatus.ACCEPTED, updated_at: new Date() }
            };

            mockAdrService.reviewAdr.mockResolvedValue(mockResponse);

            const result = await controller.reviewAdr('adr-1', dto);

            expect(result).toEqual(mockResponse);
            expect(adrService.reviewAdr).toHaveBeenCalledWith('adr-1', 'APPROVE', 'Good job');
            expect(metricsService.incrementCounter).toHaveBeenCalledWith('adr_review_action_total', expect.objectContaining({
                action: 'APPROVE',
            }));
        });
    });
});
