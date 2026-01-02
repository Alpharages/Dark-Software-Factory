import { Test, TestingModule } from '@nestjs/testing';
import { AdrReviewListener } from './adr-review.listener';
import { ExecutionService } from '../../execution/execution.service';
import { PrismaService } from '../../database/prisma.service';
import { PromptGeneratorService } from '../prompt-generator.service';
import { EventBusService } from '../../common/event-bus.service';
import { AdrReviewedEvent } from '../../architecture-review/events/adr-reviewed.event';
import { AIProvider } from '@/prisma/client';

describe('AdrReviewListener', () => {
  let listener: AdrReviewListener;
  let executionService: ExecutionService;
  let prisma: PrismaService;
  let promptGenerator: PromptGeneratorService;

  const mockExecutionService = {
    getExecution: jest.fn(),
    startExecution: jest.fn(),
  };

  const mockPrisma = {
    ticket: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPromptGenerator = {
    generatePrompt: jest.fn(),
  };

  const mockEventBus = {
    on: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdrReviewListener,
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PromptGeneratorService, useValue: mockPromptGenerator },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    listener = module.get<AdrReviewListener>(AdrReviewListener);
    executionService = module.get<ExecutionService>(ExecutionService);
    prisma = module.get<PrismaService>(PrismaService);
    promptGenerator = module.get<PromptGeneratorService>(PromptGeneratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handleAdrReviewed', () => {
    it('should ignore actions other than REJECT or MODIFY', async () => {
      const event = new AdrReviewedEvent('adr-1', 'ticket-1', 'APPROVE');
      await listener.handleAdrReviewed(event);
      expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
    });

    it('should log warning if no ticket ID', async () => {
      const event = new AdrReviewedEvent('adr-1', '', 'REJECT');
      await listener.handleAdrReviewed(event);
      expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
    });

    it('should trigger retry execution on REJECT', async () => {
      const event = new AdrReviewedEvent('adr-1', 'ticket-1', 'REJECT', 'Bad design', 'exec-1');
      const mockTicket = {
        id: 'ticket-1',
        title: 'Task',
        project_id: 'proj-1',
        clickup_task_id: 'task-1',
      };

      mockPrisma.ticket.findUnique.mockResolvedValue(mockTicket);
      mockExecutionService.getExecution.mockResolvedValue({ provider: AIProvider.CLAUDE_CODE });
      mockPromptGenerator.generatePrompt.mockResolvedValue({
        prompt: 'New Prompt',
        metadata: {
          promptLength: 100,
          estimatedTokens: 50,
          generatedAt: new Date(),
          templateVersion: '1.0',
        },
      });

      await listener.handleAdrReviewed(event);

      // Verify Ticket Status Update (AC#3 Compliance)
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'AWAITING_REWORK' },
      });

      expect(mockExecutionService.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'ticket-1',
          feedback: 'Bad design',
          provider: AIProvider.CLAUDE_CODE,
        }),
      );
    });
  });
});
