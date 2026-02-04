import { Test, TestingModule } from '@nestjs/testing';
import { FixTicketService } from './fix-ticket.service';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { SystemConfigService } from '@/system-settings/system-config.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorSeverity } from '@/prisma/enums';

describe('FixTicketService', () => {
  let service: FixTicketService;
  let prisma: PrismaService;
  let clickup: ClickUpService;

  const mockPrismaService = {
    productionError: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    aIDecisionLog: {
      create: jest.fn(),
    },
  };

  const mockClickUpService = {
    createTask: jest.fn(),
  };

  const mockSystemConfigService = {
    get: jest.fn(),
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixTicketService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: SystemConfigService, useValue: mockSystemConfigService },
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    service = module.get<FixTicketService>(FixTicketService);
    prisma = module.get<PrismaService>(PrismaService);
    clickup = module.get<ClickUpService>(ClickUpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('shouldCreateTicket', () => {
    it('should return true if severity is equal to threshold', async () => {
      mockSystemConfigService.get.mockResolvedValue('HIGH');
      const result = await service.shouldCreateTicket(ErrorSeverity.HIGH);
      expect(result).toBe(true);
    });

    it('should return true if severity is higher than threshold', async () => {
      mockSystemConfigService.get.mockResolvedValue('HIGH');
      const result = await service.shouldCreateTicket(ErrorSeverity.CRITICAL);
      expect(result).toBe(true);
    });

    it('should return false if severity is lower than threshold', async () => {
      mockSystemConfigService.get.mockResolvedValue('HIGH');
      const result = await service.shouldCreateTicket(ErrorSeverity.MEDIUM);
      expect(result).toBe(false);
    });
  });

  describe('checkForDuplicates', () => {
    it('should return fix_ticket_id if duplicate exists within 24h', async () => {
      mockPrismaService.productionError.findFirst.mockResolvedValue({ fix_ticket_id: 'task-123' });
      const result = await service.checkForDuplicates('app-1', 'ErrorType');
      expect(result).toBe('task-123');
    });

    it('should return null if no duplicate exists', async () => {
      mockPrismaService.productionError.findFirst.mockResolvedValue(null);
      const result = await service.checkForDuplicates('app-1', 'ErrorType');
      expect(result).toBeNull();
    });
  });

  describe('processError', () => {
    const mockError = {
      id: 'error-1',
      application: 'TestApp',
      error_type: 'TimeoutError',
      error_message: 'Request timed out after 30s',
      stack_trace: 'stack trace here',
      severity: ErrorSeverity.CRITICAL,
      occurred_at: new Date(),
    };

    it('should create a ticket and update the error record', async () => {
      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockSystemConfigService.get.mockImplementation((key) => {
        if (key === 'AUTO_TICKET_SEVERITY_THRESHOLD') return Promise.resolve('HIGH');
        if (key === 'FRONTEND_URL') return Promise.resolve('http://dsf.com');
        return Promise.resolve(null);
      });
      mockPrismaService.productionError.findFirst.mockResolvedValue(null); // No duplicates
      mockPrismaService.project.findFirst.mockResolvedValue({
        clickup_list_id: 'list-123',
        pm_id: '789',
      });
      mockClickUpService.createTask.mockResolvedValue({ id: 'task-created' });

      const result = await service.processError('error-1');

      expect(result).toBe('task-created');
      expect(clickup.createTask).toHaveBeenCalledWith(
        'list-123',
        expect.any(Object),
        expect.any(Object),
      );
      expect(prisma.productionError.update).toHaveBeenCalledWith({
        where: { id: 'error-1' },
        data: expect.objectContaining({
          fix_ticket_id: 'task-created',
          fix_ticket_url: 'https://app.clickup.com/t/task-created',
        }),
      });
    });

    it('should skip creation if severity is below threshold', async () => {
      const lowError = { ...mockError, severity: ErrorSeverity.LOW };
      mockPrismaService.productionError.findUnique.mockResolvedValue(lowError);
      mockSystemConfigService.get.mockResolvedValue('HIGH');

      const result = await service.processError('error-1');

      expect(result).toBeNull();
      expect(clickup.createTask).not.toHaveBeenCalled();
    });

    it('should skip creation if duplicate identified', async () => {
      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockSystemConfigService.get.mockResolvedValue('HIGH');
      mockPrismaService.productionError.findFirst.mockResolvedValue({
        fix_ticket_id: 'existing-task',
      });

      const result = await service.processError('error-1');

      expect(result).toBeNull();
      expect(clickup.createTask).not.toHaveBeenCalled();
    });

    it('should throw if ClickUp creation fails', async () => {
      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockSystemConfigService.get.mockImplementation((key) => {
        if (key === 'AUTO_TICKET_SEVERITY_THRESHOLD') return Promise.resolve('HIGH');
        if (key === 'DEFAULT_PRODUCTION_ERRORS_LIST_ID') return Promise.resolve('default-list');
        return Promise.resolve(null);
      });
      mockPrismaService.productionError.findFirst.mockResolvedValue(null);
      mockPrismaService.project.findFirst.mockResolvedValue(null);
      mockClickUpService.createTask.mockResolvedValue(null);

      await expect(service.processError('error-1')).rejects.toThrow(
        'Failed to create ClickUp task (API error)',
      );
    });
  });
});
