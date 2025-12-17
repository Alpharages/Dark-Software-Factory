import { Test, TestingModule } from '@nestjs/testing';
import { AIRoutingService } from './ai-routing.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AIProvider } from '@/prisma/client';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { IRoutingRequest, RoutingReason } from './interfaces';

describe('AIRoutingService', () => {
  let service: AIRoutingService;
  let _rabbitMQ: RabbitMQPublisherService;
  let _providerHealth: ProviderHealthService;
  let _prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
  };

  const mockPrisma = {
    execution: { create: jest.fn() },
    ticket: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockRabbitMQ = {
    publishToQueue: jest.fn(),
    publishToExchange: jest.fn(),
  };

  const mockComplexityScorer = {
    calculateComplexity: jest.fn(),
  };

  const mockProviderHealth = {
    getAvailableProvider: jest.fn(),
    shouldAlert: jest.fn(),
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = {
    startTimer: jest.fn(() => jest.fn()),
    observe: jest.fn(),
  };

  const mockRequest: IRoutingRequest = {
    correlationId: 'test-corr-id',
    ticketId: 'ticket-123',
    clickupTaskId: 'task-123',
    projectId: 'proj-1',
    title: 'Test Ticket',
    description: 'Test Description',
    acceptanceCriteria: 'AC1',
    tags: ['bug'],
    qualityScore: 80,
    qualityGrade: 'good',
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIRoutingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQ },
        { provide: ComplexityScorerService, useValue: mockComplexityScorer },
        { provide: ProviderHealthService, useValue: mockProviderHealth },
        { provide: 'PROM_METRIC_AI_ROUTING_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_AI_ROUTING_DURATION_SECONDS', useValue: mockHistogram },
        { provide: 'PROM_METRIC_AI_COMPLEXITY_SCORE', useValue: mockHistogram },
      ],
    }).compile();

    service = module.get<AIRoutingService>(AIRoutingService);
    _rabbitMQ = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    _providerHealth = module.get<ProviderHealthService>(ProviderHealthService);
    _prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should route high complexity ticket to CURSOR_HEADLESS', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 15 });
    mockConfigService.get.mockReturnValue(10); // Threshold
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CURSOR_HEADLESS,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CURSOR_HEADLESS);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_HIGH);
    expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.AI_EXECUTION,
      expect.anything(),
      mockRequest.correlationId,
    );
  });

  it('should route low complexity ticket to CLAUDE_CODE', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 5 });
    mockConfigService.get.mockReturnValue(10);
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CLAUDE_CODE,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_LOW);
  });

  it('should handle fallback when preferred provider is unavailable', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 15 }); // Prefers Cursor
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CLAUDE_CODE, // Returns Claude instead
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.routingReason).toBe(RoutingReason.PRIMARY_UNAVAILABLE);
  });

  it('should queue for delayed retry when no provider is available', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 10 });
    mockProviderHealth.getAvailableProvider.mockResolvedValue(null); // No provider
    mockProviderHealth.shouldAlert.mockReturnValue(false);

    await expect(service.routeTicket(mockRequest)).rejects.toThrow(
      'No AI provider currently available',
    );

    // Verify publish to WAIT queue
    expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.AI_ROUTING_WAIT,
      mockRequest,
      mockRequest.correlationId,
    );

    // Verify NO execution created
    expect(mockPrisma.execution.create).not.toHaveBeenCalled();

    // Verify NO ticket update
    expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
  });
});
