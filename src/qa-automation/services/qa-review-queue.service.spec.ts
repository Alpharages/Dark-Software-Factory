/**
 * QA Review Queue Service Tests
 * Story 8.1: QA Review Queue & Sampling Configuration
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ConflictException } from '@nestjs/common';

import { QaReviewQueueService } from './qa-review-queue.service';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/logger/logger.service';
import { SentryService } from '../../common/sentry/sentry.service';

import { QaReviewStatus, RiskLevel, SamplingStrategy } from '@/prisma/client';

describe('QaReviewQueueService', () => {
  let service: QaReviewQueueService;

  let _prisma: PrismaService;

  const mockPrisma = {
    qaReviewQueue: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    execution: {
      findUnique: jest.fn(),
    },
  };

  const mockMetrics = {
    inc: jest.fn(),
    set: jest.fn(),
    observe: jest.fn(),
    get: jest.fn().mockResolvedValue({ values: [{ value: 20 }] }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaReviewQueueService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: 'PROM_METRIC_DSF_QA_REVIEW_QUEUE_DEPTH',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_QA_REVIEW_TICKETS_SAMPLED_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_QA_REVIEW_TICKETS_BY_RISK_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_QA_REVIEW_QUEUE_DURATION_SECONDS',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_QA_REVIEW_DECISIONS_TOTAL',
          useValue: mockMetrics,
        },
      ],
    }).compile();

    service = module.get<QaReviewQueueService>(QaReviewQueueService);
    _prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createEntry', () => {
    it('should create a queue entry successfully', async () => {
      const input = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        projectId: 'proj-123',
        prId: '123',
        prUrl: 'https://github.com/test/pr/123',
        riskLevel: RiskLevel.HIGH,
        riskFactors: ['high_file_count'],
        samplingStrategy: SamplingStrategy.RISK_BASED,
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(null);
      mockPrisma.execution.findUnique.mockResolvedValue({
        ticket: { title: 'Test Ticket' },
      });
      mockPrisma.qaReviewQueue.create.mockResolvedValue({
        id: 'queue-123',
        ticket_id: input.ticketId,
        execution_id: input.executionId,
        project_id: input.projectId,
        pr_id: input.prId,
        pr_url: input.prUrl,
        status: QaReviewStatus.PENDING,
        risk_level: input.riskLevel,
        risk_factors: input.riskFactors,
        sampling_strategy: input.samplingStrategy,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.createEntry(input);

      expect(result.id).toBe('queue-123');
      expect(result.ticketId).toBe(input.ticketId);
      expect(result.riskLevel).toBe(input.riskLevel);
      expect(mockPrisma.qaReviewQueue.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if entry already exists', async () => {
      const input = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        riskLevel: RiskLevel.HIGH,
        riskFactors: ['high_file_count'],
        samplingStrategy: SamplingStrategy.RISK_BASED,
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.createEntry(input)).rejects.toThrow(ConflictException);
    });
  });

  describe('getById', () => {
    it('should return queue entry by ID', async () => {
      const mockEntry = {
        id: 'queue-123',
        ticket_id: 'TEST-123',
        execution_id: 'exec-123',
        status: QaReviewStatus.PENDING,
        risk_level: RiskLevel.HIGH,
        risk_factors: ['high_file_count'],
        sampling_strategy: SamplingStrategy.RISK_BASED,
        created_at: new Date(),
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);

      const result = await service.getById('queue-123');

      expect(result.id).toBe('queue-123');
      expect(result.ticketTitle).toBe('Test Ticket');
    });

    it('should throw NotFoundException if entry not found', async () => {
      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('queryQueue', () => {
    it('should return paginated queue items', async () => {
      const mockEntries = [
        {
          id: 'queue-1',
          ticket_id: 'TEST-1',
          execution_id: 'exec-1',
          status: QaReviewStatus.PENDING,
          risk_level: RiskLevel.HIGH,
          risk_factors: ['high_complexity'],
          sampling_strategy: SamplingStrategy.RISK_BASED,
          created_at: new Date(),
          execution: {
            ai_provider: 'CLAUDE_CODE',
            complexity_score: 12,
            files_changed: ['file1.ts'],
            ticket: { title: 'Ticket 1' },
          },
        },
      ];

      mockPrisma.qaReviewQueue.findMany.mockResolvedValue(mockEntries);
      mockPrisma.qaReviewQueue.count.mockResolvedValue(1);

      const result = await service.queryQueue({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.hasNextPage).toBe(false);
    });

    it('should apply filters correctly', async () => {
      mockPrisma.qaReviewQueue.findMany.mockResolvedValue([]);
      mockPrisma.qaReviewQueue.count.mockResolvedValue(0);

      await service.queryQueue({
        status: 'PENDING',
        riskLevel: 'HIGH',
        projectId: 'proj-123',
        aiProvider: 'claude_code',
      });

      expect(mockPrisma.qaReviewQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            risk_level: 'HIGH',
            project_id: 'proj-123',
            execution: {
              ai_provider: 'CLAUDE_CODE',
            },
          }),
        }),
      );
    });
  });

  describe('claimTicket', () => {
    it('should claim a ticket successfully', async () => {
      const mockEntry = {
        id: 'queue-123',
        ticket_id: 'TEST-123',
        execution_id: 'exec-123',
        status: QaReviewStatus.PENDING,
        risk_level: RiskLevel.HIGH,
        risk_factors: [],
        sampling_strategy: SamplingStrategy.RISK_BASED,
        created_at: new Date(),
        reviewed_by: null,
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);
      mockPrisma.qaReviewQueue.update.mockResolvedValue({
        ...mockEntry,
        status: QaReviewStatus.IN_REVIEW,
        reviewed_by: 'user-123',
      });

      const result = await service.claimTicket('queue-123', 'user-123');

      expect(result.status).toBe(QaReviewStatus.IN_REVIEW);
      expect(result.reviewedBy).toBe('user-123');
    });

    it('should throw ConflictException if already claimed by another user', async () => {
      const mockEntry = {
        id: 'queue-123',
        status: QaReviewStatus.IN_REVIEW,
        reviewed_by: 'other-user',
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);

      await expect(service.claimTicket('queue-123', 'user-123')).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for invalid status transition', async () => {
      const mockEntry = {
        id: 'queue-123',
        status: QaReviewStatus.APPROVED,
        reviewed_by: null,
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);

      await expect(service.claimTicket('queue-123', 'user-123')).rejects.toThrow(ConflictException);
    });
  });

  describe('approveTicket', () => {
    it('should approve a ticket successfully', async () => {
      const mockEntry = {
        id: 'queue-123',
        ticket_id: 'TEST-123',
        execution_id: 'exec-123',
        status: QaReviewStatus.IN_REVIEW,
        risk_level: RiskLevel.HIGH,
        risk_factors: [],
        sampling_strategy: SamplingStrategy.RISK_BASED,
        created_at: new Date(),
        reviewed_by: 'user-123',
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);
      mockPrisma.qaReviewQueue.update.mockResolvedValue({
        ...mockEntry,
        status: QaReviewStatus.APPROVED,
        reviewed_at: new Date(),
        review_notes: 'LGTM',
      });

      const result = await service.approveTicket('queue-123', 'user-123', 'LGTM');

      expect(result.status).toBe(QaReviewStatus.APPROVED);
      expect(result.reviewNotes).toBe('LGTM');
      expect(mockMetrics.inc).toHaveBeenCalledWith({ decision: 'approved' });
    });
  });

  describe('rejectTicket', () => {
    it('should reject a ticket successfully', async () => {
      const mockEntry = {
        id: 'queue-123',
        ticket_id: 'TEST-123',
        execution_id: 'exec-123',
        status: QaReviewStatus.IN_REVIEW,
        risk_level: RiskLevel.HIGH,
        risk_factors: [],
        sampling_strategy: SamplingStrategy.RISK_BASED,
        created_at: new Date(),
        reviewed_by: 'user-123',
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);
      mockPrisma.qaReviewQueue.update.mockResolvedValue({
        ...mockEntry,
        status: QaReviewStatus.REJECTED,
        reviewed_at: new Date(),
        review_notes: 'Needs work',
      });

      const result = await service.rejectTicket('queue-123', 'user-123', 'Needs work');

      expect(result.status).toBe(QaReviewStatus.REJECTED);
      expect(result.reviewNotes).toBe('Needs work');
      expect(mockMetrics.inc).toHaveBeenCalledWith({ decision: 'rejected' });
    });
  });

  describe('unclaimTicket', () => {
    it('should unclaim a ticket successfully', async () => {
      const mockEntry = {
        id: 'queue-123',
        ticket_id: 'TEST-123',
        execution_id: 'exec-123',
        status: QaReviewStatus.IN_REVIEW,
        risk_level: RiskLevel.HIGH,
        risk_factors: [],
        sampling_strategy: SamplingStrategy.RISK_BASED,
        created_at: new Date(),
        reviewed_by: 'user-123',
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);
      mockPrisma.qaReviewQueue.update.mockResolvedValue({
        ...mockEntry,
        status: QaReviewStatus.PENDING,
        reviewed_by: null,
      });

      const result = await service.unclaimTicket('queue-123', 'user-123');

      expect(result.status).toBe(QaReviewStatus.PENDING);
      expect(result.reviewedBy).toBeNull();
    });

    it('should throw ConflictException if not claimed by same user', async () => {
      const mockEntry = {
        id: 'queue-123',
        status: QaReviewStatus.IN_REVIEW,
        reviewed_by: 'other-user',
        execution: {
          ticket: { title: 'Test Ticket' },
        },
      };

      mockPrisma.qaReviewQueue.findUnique.mockResolvedValue(mockEntry);

      await expect(service.unclaimTicket('queue-123', 'user-123')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getQueueDepth', () => {
    it('should return queue depth by status', async () => {
      mockPrisma.qaReviewQueue.groupBy.mockResolvedValue([
        { status: QaReviewStatus.PENDING, _count: { status: 5 } },
        { status: QaReviewStatus.IN_REVIEW, _count: { status: 3 } },
        { status: QaReviewStatus.APPROVED, _count: { status: 10 } },
        { status: QaReviewStatus.REJECTED, _count: { status: 2 } },
      ]);

      const result = await service.getQueueDepth();

      expect(result.pending).toBe(5);
      expect(result.in_review).toBe(3);
      expect(result.approved).toBe(10);
      expect(result.rejected).toBe(2);
    });

    it('should return 0 for empty statuses', async () => {
      mockPrisma.qaReviewQueue.groupBy.mockResolvedValue([]);

      const result = await service.getQueueDepth();

      expect(result.pending).toBe(0);
      expect(result.in_review).toBe(0);
    });
  });
});
