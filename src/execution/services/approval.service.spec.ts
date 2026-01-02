import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalService } from './approval.service';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionTrackerService } from '../execution-tracker.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ExecutionStatus, ApprovalDecision } from '@/prisma/client';

describe('ApprovalService', () => {
  let service: ApprovalService;
  let _prisma: PrismaService;
  let _tracker: ExecutionTrackerService;
  let _publisher: RabbitMQPublisherService;
  let _logger: AIDecisionLoggerService;

  const mockPrisma = {
    execution: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    ticket: {
      update: jest.fn(),
    },
    approvalRecord: {
      create: jest.fn(),
    },
  };

  const mockTracker = {
    markAwaitingApproval: jest.fn(),
  };

  const mockPublisher = {
    publishToExchange: jest.fn(),
  };

  const mockLogger = {
    logDecision: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExecutionTrackerService, useValue: mockTracker },
        { provide: RabbitMQPublisherService, useValue: mockPublisher },
        { provide: AIDecisionLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
    _prisma = module.get<PrismaService>(PrismaService);
    _tracker = module.get<ExecutionTrackerService>(ExecutionTrackerService);
    _publisher = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    _logger = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('approve', () => {
    it('should approve execution and trigger github push', async () => {
      const executionId = 'exec-1';
      const pmId = 'pm-1';
      const execution = {
        id: executionId,
        status: ExecutionStatus.AWAITING_APPROVAL,
        ticket_id: 'ticket-1',
      };

      mockPrisma.execution.findUnique.mockResolvedValue(execution);

      const result = await service.approve(executionId, pmId, 'Looks good');

      expect(result.success).toBe(true);
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ decision: ApprovalDecision.APPROVE, pm_id: pmId }),
      });
      expect(mockPrisma.execution.update).toHaveBeenCalledWith({
        where: { id: executionId },
        data: { status: ExecutionStatus.COMPLETED },
      });
      expect(mockPublisher.publishToExchange).toHaveBeenCalled();
    });

    it('should throw BadRequestException if status is not AWAITING_APPROVAL', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      mockPrisma.execution.findUnique.mockResolvedValue({ status: ExecutionStatus.IN_PROGRESS });
      await expect(service.approve('exec-1', 'pm-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('rework', () => {
    it('should trigger rework with feedback', async () => {
      const executionId = 'exec-1';
      const feedback = 'Fix lint errors';
      const execution = {
        id: executionId,
        status: ExecutionStatus.AWAITING_APPROVAL,
        ticket_id: 'ticket-1',
        retry_count: 0,
      };

      mockPrisma.execution.findUnique.mockResolvedValue(execution);

      await service.rework(executionId, 'pm-1', feedback);

      expect(mockPublisher.publishToExchange).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          context: expect.objectContaining({ feedback }),
        }),
      );
    });
  });

  describe('handleAutomaticEscalations', () => {
    it('should escalate stale approvals', async () => {
      const staleExec = { id: 'stale-1', ticket_id: 'ticket-1' };
      mockPrisma.execution.findMany.mockResolvedValue([staleExec]);
      mockPrisma.execution.findUnique.mockResolvedValue(staleExec);

      await service.handleAutomaticEscalations();

      expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          decision: ApprovalDecision.ESCALATE,
          pm_id: 'SYSTEM_AUTO_ESCALATOR',
        }),
      });
    });
  });
});
