import { Test, TestingModule } from '@nestjs/testing';
import { BotAssignmentService } from './bot-assignment.service';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '../common/sentry/sentry.service';
import { Logger } from '@nestjs/common';

describe('BotAssignmentService', () => {
  let service: BotAssignmentService;
  let prisma: jest.Mocked<PrismaService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let sentry: jest.Mocked<SentryService>;

  const mockTicket = { id: 't-1', clickup_task_id: 'task-123' };
  const mockIntegration = {
    id: 'pi-1',
    bot_user_id: 'bot-456',
    provider: 'CLICKUP',
  };

  beforeEach(async () => {
    const mockPrisma = {
      ticket: {
        findUnique: jest.fn(),
      },
    };
    const mockIntegrationService = {
      findFirstByProject: jest.fn(),
    };
    const mockProviderFactory = {
      getProvider: jest.fn(),
    };
    const mockSentry = {
      captureException: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotAssignmentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProjectIntegrationService, useValue: mockIntegrationService },
        { provide: PMProviderFactory, useValue: mockProviderFactory },
        { provide: SentryService, useValue: mockSentry },
      ],
    }).compile();

    service = module.get<BotAssignmentService>(BotAssignmentService);
    prisma = module.get(PrismaService);
    integrationService = module.get(ProjectIntegrationService);
    providerFactory = module.get(PMProviderFactory);
    sentry = module.get(SentryService);

    // Suppress logs during tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignBotToTask', () => {
    it('should assign bot to task successfully', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(mockTicket as any);
      integrationService.findFirstByProject.mockResolvedValue(mockIntegration as any);
      const mockProvider = { assignTask: jest.fn().mockResolvedValue(undefined) };
      providerFactory.getProvider.mockResolvedValue(mockProvider as any);

      await service.assignBotToTask('t-1', 'p-1', 'corr-1');

      expect(prisma.ticket.findUnique).toHaveBeenCalledWith({ where: { id: 't-1' } });
      expect(integrationService.findFirstByProject).toHaveBeenCalledWith('p-1');
      expect(providerFactory.getProvider).toHaveBeenCalledWith(mockIntegration);
      expect(mockProvider.assignTask).toHaveBeenCalledWith('task-123', 'bot-456');
      expect(sentry.captureException).not.toHaveBeenCalled();
    });

    it('should skip if ticket not found', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);

      await service.assignBotToTask('t-1', 'p-1', 'corr-1');

      expect(integrationService.findFirstByProject).not.toHaveBeenCalled();
      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });

    it('should skip if integration not found', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(mockTicket as any);
      integrationService.findFirstByProject.mockResolvedValue(null);

      await service.assignBotToTask('t-1', 'p-1', 'corr-1');

      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });

    it('should skip if bot_user_id is null', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(mockTicket as any);
      integrationService.findFirstByProject.mockResolvedValue({
        ...mockIntegration,
        bot_user_id: null,
      } as any);

      await service.assignBotToTask('t-1', 'p-1', 'corr-1');

      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });

    it('should skip if bot_user_id is empty string', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(mockTicket as any);
      integrationService.findFirstByProject.mockResolvedValue({
        ...mockIntegration,
        bot_user_id: '',
      } as any);

      await service.assignBotToTask('t-1', 'p-1', 'corr-1');

      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });

    it('should log and capture error but not throw if provider fails', async () => {
      (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(mockTicket as any);
      integrationService.findFirstByProject.mockResolvedValue(mockIntegration as any);
      const mockProvider = { assignTask: jest.fn().mockRejectedValue(new Error('API Error')) };
      providerFactory.getProvider.mockResolvedValue(mockProvider as any);

      await expect(service.assignBotToTask('t-1', 'p-1', 'corr-1')).resolves.not.toThrow();

      expect(Logger.prototype.error).toHaveBeenCalled();
      expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
