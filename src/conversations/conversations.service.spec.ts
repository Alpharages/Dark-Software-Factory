import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '@/database/prisma.service';
import { AIConversationProcessorService } from './ai-conversation-processor.service';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AetherFlowClientService } from '@/integrations/aetherflow/aetherflow-client.service';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let metricsService: jest.Mocked<MetricsService>;
  let aetherFlowClient: jest.Mocked<AetherFlowClientService>;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        {
          provide: PrismaService,
          useValue: {
            project: { findUnique: jest.fn() },
            clientConversation: { findUnique: jest.fn(), update: jest.fn() },
          },
        },
        { provide: AIConversationProcessorService, useValue: {} },
        { provide: AICostTrackerService, useValue: {} },
        {
          provide: MetricsService,
          useValue: {
            incrementConversationTicketCreationSuccess: jest.fn(),
            incrementConversationTicketCreationFailure: jest.fn(),
          },
        },
        { provide: SentryService, useValue: { captureException: jest.fn() } },
        {
          provide: AetherFlowClientService,
          useValue: {
            createTasks: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
    metricsService = module.get(MetricsService);
    aetherFlowClient = module.get(AetherFlowClientService);
    prisma = module.get(PrismaService);
  });

  describe('createTicketsFromActionItems', () => {
    const conversationId = 'conv1';
    const actionItemIds = ['item1'];
    const mockConversation = {
      id: conversationId,
      project_id: 'proj1',
      pm_id: 'pm1',
      title: 'Test',
      conversation_date: new Date(),
      action_items: [{ id: 'item1', task: 'Task 1', priority: 'high' }],
    };

    it('should record success metrics on successful ticket creation', async () => {
      (prisma.clientConversation.findUnique as jest.Mock).mockResolvedValue(
        mockConversation as any,
      );
      (aetherFlowClient.createTasks as jest.Mock).mockResolvedValue({
        success: true,
        count: 1,
        tasks: [{ id: 't1' }],
      } as any);

      await service.createTicketsFromActionItems(conversationId, actionItemIds);

      expect(metricsService.incrementConversationTicketCreationSuccess).toHaveBeenCalledWith(1);
    });

    it('should record failure metrics on AetherFlow failure', async () => {
      (prisma.clientConversation.findUnique as jest.Mock).mockResolvedValue(
        mockConversation as any,
      );
      (aetherFlowClient.createTasks as jest.Mock).mockResolvedValue({
        success: false,
        error: 'AetherFlow Unavailable',
      } as any);

      try {
        await service.createTicketsFromActionItems(conversationId, actionItemIds);
      } catch (e) {
        // expected
      }

      expect(metricsService.incrementConversationTicketCreationFailure).toHaveBeenCalledWith(
        'aetherflow_unavailable',
      );
    });
  });
});
