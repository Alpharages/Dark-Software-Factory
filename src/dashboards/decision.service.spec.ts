import { Test, TestingModule } from '@nestjs/testing';
import { DecisionService } from './decision.service';
import { PrismaService } from '../database/prisma.service';
import { AICostTrackerService } from '../cost-tracking/ai-cost-tracker.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { ExecutionService } from '../execution/execution.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '../prisma/enums';

describe('DecisionService', () => {
  let service: DecisionService;
  let prisma: PrismaService;
  let costTracker: AICostTrackerService;
  let decisionLogger: AIDecisionLoggerService;
  let executionService: ExecutionService;

  const mockPrismaService = {
    ticket: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAICostTrackerService = {
    getCostStats: jest.fn(),
  };

  const mockAIDecisionLoggerService = {
    logDecision: jest.fn(),
  };

  const mockExecutionService = {
    resumeExecution: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AICostTrackerService, useValue: mockAICostTrackerService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLoggerService },
        { provide: ExecutionService, useValue: mockExecutionService },
      ],
    }).compile();

    service = module.get<DecisionService>(DecisionService);
    prisma = module.get<PrismaService>(PrismaService);
    costTracker = module.get<AICostTrackerService>(AICostTrackerService);
    decisionLogger = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
    executionService = module.get<ExecutionService>(ExecutionService);

    jest.clearAllMocks();
  });

  describe('getPendingTickets', () => {
    it('should return tickets with status AWAITING_APPROVAL', async () => {
      const tickets = [{ id: '1', status: 'AWAITING_APPROVAL' }];
      mockPrismaService.ticket.findMany.mockResolvedValue(tickets);
      mockAICostTrackerService.getCostStats.mockResolvedValue({
        totalCost: 10,
        projectBudget: 100,
        projectSpend: 50,
      });

      const result = await service.getPendingTickets();
      expect(result).toHaveLength(1);
      expect(result[0].costStats).toBeDefined();
      expect(mockPrismaService.ticket.findMany).toHaveBeenCalledWith({
        where: { status: { in: [TicketStatus.AWAITING_APPROVAL] } },
        include: { project: true },
      });
    });
  });

  describe('processDecision', () => {
    it('should approve ticket and resume execution', async () => {
      const ticketId = '1';
      const userId = 'user-1';
      const userRole = 'PM';
      const decisionDto = { decision: 'APPROVE' as const, reason: 'Looks good' };

      mockPrismaService.ticket.findUnique.mockResolvedValue({
        id: ticketId,
        status: 'AWAITING_APPROVAL',
      });
      mockPrismaService.ticket.update.mockResolvedValue({ id: ticketId, status: 'QUEUED' });

      await service.processDecision(ticketId, userId, userRole, decisionDto);

      expect(mockPrismaService.ticket.update).toHaveBeenCalledWith({
        where: { id: ticketId },
        data: { status: TicketStatus.QUEUED },
      });
      expect(mockAIDecisionLoggerService.logDecision).toHaveBeenCalled();
      expect(mockExecutionService.resumeExecution).toHaveBeenCalledWith(ticketId);
    });

    it('should reject ticket and not resume execution', async () => {
      const ticketId = '1';
      const userId = 'user-1';
      const userRole = 'PM';
      const decisionDto = { decision: 'REJECT' as const, reason: 'Too expensive' };

      mockPrismaService.ticket.findUnique.mockResolvedValue({
        id: ticketId,
        status: 'AWAITING_APPROVAL',
      });
      mockPrismaService.ticket.update.mockResolvedValue({ id: ticketId, status: 'REJECTED' });

      await service.processDecision(ticketId, userId, userRole, decisionDto);

      expect(mockPrismaService.ticket.update).toHaveBeenCalledWith({
        where: { id: ticketId },
        data: { status: TicketStatus.REJECTED },
      });
      expect(mockExecutionService.resumeExecution).not.toHaveBeenCalled();
    });

    it('should throw error if ticket not found', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(null);
      const decisionDto = { decision: 'APPROVE' as const };
      await expect(service.processDecision('999', 'user-1', 'PM', decisionDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
