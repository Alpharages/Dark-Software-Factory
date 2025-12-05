import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QualityGatesService } from './quality-gates.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { TicketStatus } from '@prisma/client';
import { getToken } from '@willsoto/nestjs-prometheus';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { ROUTING_KEYS, EXCHANGE_NAMES } from '../rabbitmq/rabbitmq.config';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';

describe('QaOrchestratorService', () => {
  let service: QaOrchestratorService;
  let prisma: PrismaService;
  let rabbitPublisher: RabbitMQPublisherService;
  let qualityGatesService: QualityGatesService;

  const mockPrismaService = {
    ticket: {
      update: jest.fn(),
    },
    qAResult: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  const mockQualityGatesService = {
    evaluate: jest.fn(),
  };

  const mockRabbitPublisher = {
    publishToExchange: jest.fn(),
    publishToQueue: jest.fn(),
  };

  const mockCounter = {
    inc: jest.fn(),
  };

  const mockHistogram = {
    startTimer: jest.fn(() => jest.fn()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaOrchestratorService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SentryService, useValue: mockSentryService },
        { provide: QualityGatesService, useValue: mockQualityGatesService },
        { provide: RabbitMQPublisherService, useValue: mockRabbitPublisher },
        { provide: getToken(QA_METRICS.CHECKS_TOTAL), useValue: mockCounter },
        { provide: getToken(QA_METRICS.CHECK_DURATION), useValue: mockHistogram },
      ],
    }).compile();

    service = module.get<QaOrchestratorService>(QaOrchestratorService);
    prisma = module.get<PrismaService>(PrismaService);
    rabbitPublisher = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    qualityGatesService = module.get<QualityGatesService>(QualityGatesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processQaCheck', () => {
    const mockMessage = {
      executionId: 'exec-1',
      ticketId: 'ticket-1',
      projectId: 'proj-1',
      correlationId: 'corr-1',
      workspacePath: '/tmp/workspace',
    };

    const mockPassedGateResult = {
      passed: true,
      status: 'Passed',
      overallScore: 100,
      blockingIssues: [],
      warningIssues: [],
      categories: {},
      ticketStatusUpdate: TicketStatus.GITHUB_PUSH,
    };

    const mockFailedGateResult = {
      passed: false,
      status: 'Failed',
      overallScore: 50,
      blockingIssues: [{ category: 'testing', message: 'Tests failed' }],
      warningIssues: [],
      categories: {},
      ticketStatusUpdate: TicketStatus.QA_FAILED,
    };

    it('should process a successful QA check', async () => {
      // Setup mocks
      mockQualityGatesService.evaluate.mockResolvedValue(mockPassedGateResult);
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null); // No existing result
      mockRabbitPublisher.publishToExchange.mockResolvedValue(true);
      mockRabbitPublisher.publishToQueue.mockResolvedValue(true);

      // Execute
      await service.processQaCheck(mockMessage);

      // Verify ticket status update to QA_REVIEW
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: mockMessage.ticketId },
        data: { status: TicketStatus.QA_REVIEW },
      });

      // Verify QA result creation
      expect(prisma.qAResult.create).toHaveBeenCalled();

      // Verify Gate Evaluation
      expect(qualityGatesService.evaluate).toHaveBeenCalled();

      // Verify final ticket update
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: mockMessage.ticketId },
        data: { status: TicketStatus.GITHUB_PUSH },
      });

      // Verify event emission
      expect(rabbitPublisher.publishToExchange).toHaveBeenCalledWith(
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        ROUTING_KEYS.QA_CHECK_COMPLETED,
        expect.objectContaining({
          executionId: mockMessage.executionId,
          passed: true,
        }),
      );
    });

    it('should process a failed QA check', async () => {
      // Setup mocks
      mockQualityGatesService.evaluate.mockResolvedValue(mockFailedGateResult);
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);
      mockRabbitPublisher.publishToExchange.mockResolvedValue(true);

      // Execute
      await service.processQaCheck(mockMessage);

      // Verify final ticket update to FAILED
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: mockMessage.ticketId },
        data: { status: TicketStatus.QA_FAILED },
      });

      // Verify failure event emission
      expect(rabbitPublisher.publishToExchange).toHaveBeenCalledWith(
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        ROUTING_KEYS.QA_CHECK_FAILED,
        expect.objectContaining({
          executionId: mockMessage.executionId,
          blockers: expect.any(Array),
        }),
      );
    });

    it('should handle errors gracefully', async () => {
      // Setup mocks to throw error
      const error = new Error('Database connection failed');
      mockPrismaService.ticket.update.mockRejectedValueOnce(error);

      // Execute & Verify rejection
      await expect(service.processQaCheck(mockMessage)).rejects.toThrow(error);

      // Verify Sentry reporting
      expect(mockSentryService.captureException).toHaveBeenCalled();

      // Verify error metrics
      expect(mockCounter.inc).toHaveBeenCalledWith({
        status: 'error',
      });
    });
  });
});
