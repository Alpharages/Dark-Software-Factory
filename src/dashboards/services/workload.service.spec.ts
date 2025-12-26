import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WorkloadService } from './workload.service';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';

describe('WorkloadService', () => {
    let service: WorkloadService;

    const mockPm = {
        id: 'pm-123',
        email: 'pm@example.com',
        name: 'Test PM',
        role: 'PM',
        max_tickets: 20,
        created_at: new Date(),
        updated_at: new Date(),
    };

    const mockManager = {
        id: 'mgr-456',
        email: 'manager@example.com',
        name: 'Test Manager',
        role: 'MANAGER',
        max_tickets: 0,
        created_at: new Date(),
        updated_at: new Date(),
    };

    const mockPrismaService = {
        user: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        ticket: {
            count: jest.fn(),
        },
        utilizationHistory: {
            findMany: jest.fn(),
        },
    };

    const mockMetricsService = {
        setGauge: jest.fn(),
        recordHistogram: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WorkloadService,
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
                {
                    provide: MetricsService,
                    useValue: mockMetricsService,
                },
            ],
        }).compile();

        service = module.get<WorkloadService>(WorkloadService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getPmUtilization', () => {
        it('should calculate utilization for a PM with green status', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(10); // 50% utilization

            const result = await service.getPmUtilization('pm-123');

            expect(result).toEqual({
                pm_id: 'pm-123',
                pm_name: 'Test PM',
                pm_email: 'pm@example.com',
                active_tickets: 10,
                max_tickets: 20,
                utilization_pct: 50,
                burnout_risk: 'green',
                burnout_risk_label: 'Healthy - Within normal capacity',
            });

            expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
                'pm_utilization_percent',
                50,
                { pm_id: 'pm-123', pm_name: 'Test PM' },
            );

            expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
                'pm_burnout_risk_total',
                0,
                { pm_id: 'pm-123', pm_name: 'Test PM' },
            );
        });

        it('should calculate utilization with yellow status (approaching capacity)', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(15); // 75% utilization

            const result = await service.getPmUtilization('pm-123');

            expect(result.utilization_pct).toBe(75);
            expect(result.burnout_risk).toBe('yellow');
            expect(result.burnout_risk_label).toBe('Moderate Risk - Approaching capacity limit');
        });

        it('should calculate utilization with red status (burnout risk)', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(18); // 90% utilization

            const result = await service.getPmUtilization('pm-123');

            expect(result.utilization_pct).toBe(90);
            expect(result.burnout_risk).toBe('red');
            expect(result.burnout_risk_label).toBe('High Risk - Over capacity, immediate attention required');

            expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
                'pm_burnout_risk_total',
                1,
                { pm_id: 'pm-123', pm_name: 'Test PM' },
            );
        });

        it('should throw NotFoundException if PM does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.getPmUtilization('invalid-id')).rejects.toThrow(
                NotFoundException,
            );
            await expect(service.getPmUtilization('invalid-id')).rejects.toThrow(
                'PM with ID invalid-id not found',
            );
        });

        it('should throw NotFoundException if user is not a PM', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);

            await expect(service.getPmUtilization('mgr-456')).rejects.toThrow(
                NotFoundException,
            );
            await expect(service.getPmUtilization('mgr-456')).rejects.toThrow(
                'User mgr-456 is not a PM',
            );
        });

        it('should count only active tickets (excluding completed/failed)', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(10);

            await service.getPmUtilization('pm-123');

            expect(mockPrismaService.ticket.count).toHaveBeenCalledWith({
                where: {
                    project: {
                        pm_id: 'pm-123',
                    },
                    status: {
                        in: [
                            'VALIDATED',
                            'QUEUED',
                            'AI_PROCESSING',
                            'QA_REVIEW',
                            'GITHUB_PUSH',
                            'DEPLOYING',
                            'AWAITING_APPROVAL',
                            'AWAITING_REWORK',
                        ],
                    },
                },
            });
        });
    });

    describe('get Team Capacity', () => {
        const mockPms = [
            {
                id: 'pm-1',
                name: 'PM One',
                email: 'pm1@example.com',
                max_tickets: 20,
            },
            {
                id: 'pm-2',
                name: 'PM Two',
                email: 'pm2@example.com',
                max_tickets: 15,
            },
        ];

        it('should return team capacity for a manager', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);
            mockPrismaService.user.findMany.mockResolvedValue(mockPms);
            mockPrismaService.ticket.count
                .mockResolvedValueOnce(15) // PM One: 75% utilization
                .mockResolvedValueOnce(12); // PM Two: 80% utilization

            const result = await service.getTeamCapacity('mgr-456');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                pm_id: 'pm-2',
                pm_name: 'PM Two',
                pm_email: 'pm2@example.com',
                active_tickets: 12,
                max_tickets: 15,
                utilization_pct: 80,
                burnout_risk: 'yellow',
            });
            expect(result[1]).toEqual({
                pm_id: 'pm-1',
                pm_name: 'PM One',
                pm_email: 'pm1@example.com',
                active_tickets: 15,
                max_tickets: 20,
                utilization_pct: 75,
                burnout_risk: 'yellow',
            });
        });

        it('should filter PMs by managed_by_id for MANAGER role', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);
            mockPrismaService.user.findMany.mockResolvedValue([]);

            await service.getTeamCapacity('mgr-456');

            expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
                where: {
                    role: 'PM',
                    managed_by_id: 'mgr-456',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    max_tickets: true,
                },
                orderBy: {
                    name: 'asc',
                },
            });
        });

        it('should return all PMs for ADMIN role', async () => {
            const mockAdmin = { ...mockManager, role: 'ADMIN' };
            mockPrismaService.user.findUnique.mockResolvedValue(mockAdmin);
            mockPrismaService.user.findMany.mockResolvedValue([]);

            await service.getTeamCapacity('admin-789');

            expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
                where: {
                    role: 'PM',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    max_tickets: true,
                },
                orderBy: {
                    name: 'asc',
                },
            });
        });

        it('should throw NotFoundException if manager does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.getTeamCapacity('invalid-id')).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should throw NotFoundException if user is not a Manager or Admin', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);

            await expect(service.getTeamCapacity('pm-123')).rejects.toThrow(
                NotFoundException,
            );
            await expect(service.getTeamCapacity('pm-123')).rejects.toThrow(
                'User pm-123 is not a Manager or Admin',
            );
        });

        it('should sort PMs by utilization descending (highest first)', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);
            mockPrismaService.user.findMany.mockResolvedValue(mockPms);
            mockPrismaService.ticket.count
                .mockResolvedValueOnce(10) // PM One: 50% utilization
                .mockResolvedValueOnce(14); // PM Two: 93.33% utilization

            const result = await service.getTeamCapacity('mgr-456');

            expect(result[0].pm_id).toBe('pm-2'); // Higher utilization first
            expect(result[0].utilization_pct).toBe(93.33);
            expect(result[1].pm_id).toBe('pm-1');
            expect(result[1].utilization_pct).toBe(50);
        });
    });

    describe('getHistoricalTrends', () => {
        const mockHistoryRecords = [
            {
                snapshot_date: new Date('2024-12-01'),
                active_tickets: 10,
                max_tickets: 20,
                utilization_pct: 50.0,
            },
            {
                snapshot_date: new Date('2024-12-02'),
                active_tickets: 12,
                max_tickets: 20,
                utilization_pct: 60.0,
            },
        ];

        it('should return historical utilization trends for a PM', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.utilizationHistory.findMany.mockResolvedValue(mockHistoryRecords);

            const result = await service.getHistoricalTrends('pm-123', 30);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                snapshot_date: new Date('2024-12-01'),
                active_tickets: 10,
                max_tickets: 20,
                utilization_pct: 50,
            });
            expect(result[1]).toEqual({
                snapshot_date: new Date('2024-12-02'),
                active_tickets: 12,
                max_tickets: 20,
                utilization_pct: 60,
            });
        });

        it('should query history for the specified number of days', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.utilizationHistory.findMany.mockResolvedValue([]);

            await service.getHistoricalTrends('pm-123', 7);

            const callArgs = mockPrismaService.utilizationHistory.findMany.mock.calls[0][0];
            expect(callArgs.where.pm_id).toBe('pm-123');
            expect(callArgs.where.snapshot_date).toHaveProperty('gte');
            expect(callArgs.where.snapshot_date).toHaveProperty('lte');
        });

        it('should throw NotFoundException if PM does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.getHistoricalTrends('invalid-id')).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should throw NotFoundException if user is not a PM', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);

            await expect(service.getHistoricalTrends('mgr-456')).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    describe('checkBurnoutAlert', () => {
        it('should return true if PM is above 80% utilization', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(18); // 90% utilization

            const result = await service.checkBurnoutAlert('pm-123');

            expect(result).toBe(true);
        });

        it('should return false if PM is below 80% utilization', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.ticket.count.mockResolvedValue(12); // 60% utilization

            const result = await service.checkBurnoutAlert('pm-123');

            expect(result).toBe(false);
        });
    });

    describe('updateMaxTickets', () => {
        it('should update max_tickets for a PM', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockPm);
            mockPrismaService.user.update.mockResolvedValue({ ...mockPm, max_tickets: 25 });

            await service.updateMaxTickets('pm-123', 25);

            expect(mockPrismaService.user.update).toHaveBeenCalledWith({
                where: { id: 'pm-123' },
                data: { max_tickets: 25 },
            });
        });

        it('should throw NotFoundException if PM does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.updateMaxTickets('invalid-id', 25)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should throw NotFoundException if user is not a PM', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(mockManager);

            await expect(service.updateMaxTickets('mgr-456', 25)).rejects.toThrow(
                NotFoundException,
            );
        });
    });
});
