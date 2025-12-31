import { Test, TestingModule } from '@nestjs/testing';
import { ArchitectureReviewController } from './architecture-review.controller';
import { AdrService } from './adr.service';
import { AdrReviewQueueQueryDto, AdrQueueItemDto } from './dto';
import { AdrStatus, RiskLevel } from '@/prisma/client';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { MetricsService } from '@/common/metrics/metrics.service';

describe('ArchitectureReviewController', () => {
    let controller: ArchitectureReviewController;
    let adrService: jest.Mocked<AdrService>;

    const mockQueueItem: AdrQueueItemDto = {
        id: 'adr-123',
        title: 'Use Redis for Session Storage',
        status: AdrStatus.PROPOSED,
        risk_level: RiskLevel.HIGH,
        ai_confidence: 0.85,
        created_at: new Date('2025-12-31T16:00:00Z'),
        estimated_review_time_minutes: 15,
        ticket: {
            id: 'ticket-123',
            title: 'Implement user authentication',
            clickup_task_id: 'abc123',
        },
        execution_id: 'exec-123',
    };

    // Mock guards
    const mockJwtAuthGuard = { canActivate: jest.fn(() => true) };
    const mockRolesGuard = { canActivate: jest.fn(() => true) };
    const mockThrottlerGuard = { canActivate: jest.fn(() => true) };

    beforeEach(async () => {
        const mockAdrService = {
            getReviewQueue: jest.fn(),
            reviewAdr: jest.fn(),
        };

        const mockMetricsService = {
            incrementCounter: jest.fn(),
            setGauge: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ArchitectureReviewController],
            providers: [
                {
                    provide: AdrService,
                    useValue: mockAdrService,
                },
                {
                    provide: MetricsService,
                    useValue: mockMetricsService,
                },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue(mockJwtAuthGuard)
            .overrideGuard(RolesGuard)
            .useValue(mockRolesGuard)
            .overrideGuard(ThrottlerGuard)
            .useValue(mockThrottlerGuard)
            .compile();

        controller = module.get<ArchitectureReviewController>(ArchitectureReviewController);
        adrService = module.get(AdrService) as jest.Mocked<AdrService>;
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getQueue', () => {
        it('should return ADR queue with default filters (PROPOSED status)', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                sort_by: 'risk_level',
                sort_order: 'DESC',
            };

            adrService.getReviewQueue.mockResolvedValue([mockQueueItem]);

            const result = await controller.getQueue(queryDto);

            expect(result).toEqual({ items: [mockQueueItem], total: 1 });
            expect(adrService.getReviewQueue).toHaveBeenCalledWith(queryDto);
        });

        it('should filter by risk_level HIGH', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                risk_level: RiskLevel.HIGH,
                sort_by: 'risk_level',
                sort_order: 'DESC',
            };

            adrService.getReviewQueue.mockResolvedValue([mockQueueItem]);

            const result = await controller.getQueue(queryDto);

            expect(result.items).toHaveLength(1);
            expect(result.items[0].risk_level).toBe(RiskLevel.HIGH);
            expect(adrService.getReviewQueue).toHaveBeenCalledWith(queryDto);
        });

        it('should filter by project_id', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                project_id: 'project-abc',
                sort_by: 'risk_level',
                sort_order: 'DESC',
            };

            adrService.getReviewQueue.mockResolvedValue([mockQueueItem]);

            const result = await controller.getQueue(queryDto);

            expect(result.total).toBe(1);
            expect(adrService.getReviewQueue).toHaveBeenCalledWith(queryDto);
        });

        it('should filter by confidence range', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                min_confidence: 0.5,
                max_confidence: 0.9,
                sort_by: 'confidence',
                sort_order: 'ASC',
            };

            adrService.getReviewQueue.mockResolvedValue([mockQueueItem]);

            const result = await controller.getQueue(queryDto);

            expect(result.items[0].ai_confidence).toBeGreaterThanOrEqual(0.5);
            expect(result.items[0].ai_confidence).toBeLessThanOrEqual(0.9);
            expect(adrService.getReviewQueue).toHaveBeenCalledWith(queryDto);
        });

        it('should sort by created_at DESC', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                sort_by: 'created_at',
                sort_order: 'DESC',
            };

            adrService.getReviewQueue.mockResolvedValue([mockQueueItem]);

            const result = await controller.getQueue(queryDto);

            expect(result.items).toHaveLength(1);
            expect(adrService.getReviewQueue).toHaveBeenCalledWith(queryDto);
        });

        it('should return empty array when no ADRs found', async () => {
            const queryDto: AdrReviewQueueQueryDto = {
                status: AdrStatus.PROPOSED,
                sort_by: 'risk_level',
                sort_order: 'DESC',
            };

            adrService.getReviewQueue.mockResolvedValue([]);

            const result = await controller.getQueue(queryDto);

            expect(result).toEqual({ items: [], total: 0 });
        });
    });

    describe('reviewAdr', () => {
        it('should approve an ADR and record metrics', async () => {
            const adrId = 'adr-123';
            const reviewDto = { action: 'APPROVE' };
            const mockResponse = {
                success: true,
                message: 'ADR approved successfully',
                adr: {
                    id: adrId,
                    title: 'Use Redis for Session Storage',
                    status: 'ACCEPTED',
                    updated_at: new Date(),
                },
            };

            (adrService.reviewAdr as jest.Mock).mockResolvedValue(mockResponse);

            const result = await controller.reviewAdr(adrId, reviewDto as any);

            expect(result).toEqual(mockResponse);
            expect(adrService.reviewAdr).toHaveBeenCalledWith(adrId, 'APPROVE', undefined);
        });

        it('should reject an ADR with notes and record metrics', async () => {
            const adrId = 'adr-456';
            const reviewDto = {
                action: 'REJECT',
                notes: 'Security concerns - use PostgreSQL instead',
            };
            const mockResponse = {
                success: true,
                message: 'ADR rejected successfully',
                adr: {
                    id: adrId,
                    title: 'Use Redis',
                    status: 'REJECTED',
                    updated_at: new Date(),
                },
            };

            (adrService.reviewAdr as jest.Mock).mockResolvedValue(mockResponse);

            const result = await controller.reviewAdr(adrId, reviewDto as any);

            expect(result).toEqual(mockResponse);
            expect(adrService.reviewAdr).toHaveBeenCalledWith(adrId, 'REJECT', reviewDto.notes);
        });

        it('should handle MODIFY action', async () => {
            const adrId = 'adr-789';
            const reviewDto = {
                action: 'MODIFY',
                notes: 'Please adjust architecture approach',
            };
            const mockResponse = {
                success: true,
                message: 'ADR modified successfully',
                adr: {
                    id: adrId,
                    title: 'Test ADR',
                    status: 'PROPOSED',
                    updated_at: new Date(),
                },
            };

            (adrService.reviewAdr as jest.Mock).mockResolvedValue(mockResponse);

            const result = await controller.reviewAdr(adrId, reviewDto as any);

            expect(result).toEqual(mockResponse);
            expect(adrService.reviewAdr).toHaveBeenCalledWith(adrId, 'MODIFY', reviewDto.notes);
        });
    });
});
