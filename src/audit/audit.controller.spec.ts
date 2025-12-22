import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AIDecisionLoggerService } from './ai-decision-logger.service';
import { LoggerService } from '@/common/logger/logger.service';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('AuditController', () => {
  let controller: AuditController;
  let service: AIDecisionLoggerService;
  let logger: LoggerService;

  const mockDecisions = [
    {
      id: 'uuid-1',
      timestamp: new Date('2025-12-22T10:00:00Z'),
      agent_name: 'TicketIntakeConsumer',
      action: 'quality_score',
      reasoning: 'Quality check passed',
      ticket_id: 'DSF-123',
      execution_id: null,
      input_data: { score: 85 },
      output_data: { passed: true },
      confidence: 0.95,
      execution: null,
    },
  ];

  const mockService = {
    getDecisionTimeline: jest.fn(),
    getLowConfidenceDecisions: jest.fn(),
    searchDecisions: jest.fn(),
  };

  const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn(() => true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AIDecisionLoggerService,
          useValue: mockService,
        },
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    })
      .overrideGuard(jest.requireActual('@/common/guards/auth.guard').JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(jest.requireActual('@/common/guards/roles.guard').RolesGuard)
      .useValue(mockGuard)
      .overrideGuard(jest.requireActual('@nestjs/throttler').ThrottlerGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
    logger = module.get<LoggerService>(LoggerService);

    jest.clearAllMocks();
  });

  describe('getTimeline', () => {
    it('should return timeline with decisions for valid ticket', async () => {
      mockService.getDecisionTimeline.mockResolvedValue(mockDecisions);

      const result = await controller.getTimeline('DSF-123', 'corr-id');

      expect(result).toEqual({
        ticketId: 'DSF-123',
        decisions: mockDecisions,
        totalDecisions: 1,
      });
      expect(service.getDecisionTimeline).toHaveBeenCalledWith('DSF-123', 'corr-id');
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should return empty array for ticket with no decisions', async () => {
      mockService.getDecisionTimeline.mockResolvedValue([]);

      const result = await controller.getTimeline('DSF-999', 'corr-id');

      expect(result).toEqual({
        ticketId: 'DSF-999',
        decisions: [],
        totalDecisions: 0,
      });
    });
  });

  describe('getLowConfidence', () => {
    it('should return paginated low-confidence decisions with default params', async () => {
      const mockResponse = {
        data: mockDecisions,
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          hasMore: false,
        },
      };
      mockService.getLowConfidenceDecisions.mockResolvedValue(mockResponse);

      const result = await controller.getLowConfidence({}, 'corr-id');

      expect(result).toEqual(mockResponse);
      expect(service.getLowConfidenceDecisions).toHaveBeenCalledWith(
        { page: 1, limit: 50, minConfidence: 0.5 },
        'corr-id',
      );
    });

    it('should use custom threshold when provided', async () => {
      const mockResponse = {
        data: [],
        meta: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      };
      mockService.getLowConfidenceDecisions.mockResolvedValue(mockResponse);

      await controller.getLowConfidence({ minConfidence: 0.7 }, 'corr-id');

      expect(service.getLowConfidenceDecisions).toHaveBeenCalledWith(
        { page: 1, limit: 50, minConfidence: 0.7 },
        'corr-id',
      );
    });

    it('should respect custom pagination params', async () => {
      const mockResponse = {
        data: mockDecisions,
        meta: {
          page: 2,
          limit: 25,
          total: 50,
          totalPages: 2,
          hasMore: false,
        },
      };
      mockService.getLowConfidenceDecisions.mockResolvedValue(mockResponse);

      await controller.getLowConfidence({ page: 2, limit: 25, minConfidence: 0.5 }, 'corr-id');

      expect(service.getLowConfidenceDecisions).toHaveBeenCalledWith(
        { page: 2, limit: 25, minConfidence: 0.5 },
        'corr-id',
      );
    });
  });

  describe('search', () => {
    it('should search with agent filter', async () => {
      const mockResponse = {
        data: mockDecisions,
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          hasMore: false,
        },
      };
      mockService.searchDecisions.mockResolvedValue(mockResponse);

      const result = await controller.search({ agent_name: 'AIExecutionConsumer' }, 'corr-id');

      expect(result).toEqual(mockResponse);
      expect(service.searchDecisions).toHaveBeenCalledWith(
        {
          agent_name: 'AIExecutionConsumer',
          action: undefined,
          ticketId: undefined,
          executionId: undefined,
          startDate: undefined,
          endDate: undefined,
          page: 1,
          limit: 50,
        },
        'corr-id',
      );
    });

    it('should search with date range filter', async () => {
      const mockResponse = {
        data: mockDecisions,
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          hasMore: false,
        },
      };
      mockService.searchDecisions.mockResolvedValue(mockResponse);

      await controller.search(
        {
          startDate: '2025-12-20T00:00:00.000Z',
          endDate: '2025-12-22T23:59:59.999Z',
        },
        'corr-id',
      );

      const callArgs = mockService.searchDecisions.mock.calls[0][0];
      expect(callArgs.startDate).toBeInstanceOf(Date);
      expect(callArgs.endDate).toBeInstanceOf(Date);
    });

    it('should throw 400 for invalid date format', async () => {
      mockService.searchDecisions.mockRejectedValue(new Error('Invalid date'));

      await expect(controller.search({ startDate: 'invalid-date' }, 'corr-id')).rejects.toThrow(
        new HttpException(
          'Invalid date format. Use ISO 8601 format (e.g., 2025-12-22T10:00:00.000Z).',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should search with combined filters', async () => {
      const mockResponse = {
        data: mockDecisions,
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          hasMore: false,
        },
      };
      mockService.searchDecisions.mockResolvedValue(mockResponse);

      await controller.search(
        {
          agent_name: 'TicketIntakeConsumer',
          action: 'quality_score',
          ticketId: 'DSF-123',
        },
        'corr-id',
      );

      expect(service.searchDecisions).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_name: 'TicketIntakeConsumer',
          action: 'quality_score',
          ticketId: 'DSF-123',
        }),
        'corr-id',
      );
    });
  });
});
