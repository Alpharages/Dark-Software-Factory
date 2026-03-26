import { Test, TestingModule } from '@nestjs/testing';
import { AIRoutingService } from './ai-routing.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { PromptGeneratorService } from './prompt-generator.service';
import { AIProvider } from '@/prisma/client';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { FileLockManagerService } from '../file-locks/file-lock-manager.service';
import { BranchStrategistService } from '../github/services/branch-strategist.service';
import { ProviderFactoryService } from './provider-factory.service';
import {
  IRoutingRequest,
  RoutingReason,
  ProviderSelectionReason,
  ComplexityGrade,
} from './interfaces';

describe('AIRoutingService', () => {
  let service: AIRoutingService;
  let _rabbitMQ: RabbitMQPublisherService;
  let _providerHealth: ProviderHealthService;
  let _prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => {
      // Handle provider enabled checks
      if (key === 'ai.providers.claudeCode.enabled') return true;
      if (key === 'ai.providers.kimi.enabled') return true;
      if (key === 'ai.routing.primaryProvider') return null; // Default: no override
      // For all other config values, return default
      return defaultValue;
    }),
  };

  const mockPrisma = {
    project: { findUnique: jest.fn() },
    execution: { create: jest.fn(), update: jest.fn() },
    ticket: { update: jest.fn() },
    auditLog: { create: jest.fn() },
    ticketDependency: { findMany: jest.fn().mockResolvedValue([]) },
    fileLock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

  const mockPromptGenerator = {
    generatePrompt: jest.fn(),
  };

  const mockProviderFactory = {
    selectProvider: jest.fn(),
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
    // Default project mapping (Story 4.9: Project → repository URL)
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      github_repository_url: 'https://github.com/test/repo.git',
    });
    mockPromptGenerator.generatePrompt.mockResolvedValue({ prompt: 'generated prompt' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIRoutingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQ },
        { provide: ComplexityScorerService, useValue: mockComplexityScorer },
        { provide: ProviderHealthService, useValue: mockProviderHealth },
        { provide: PromptGeneratorService, useValue: mockPromptGenerator },
        { provide: 'PROM_METRIC_AI_ROUTING_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_AI_ROUTING_DURATION_SECONDS', useValue: mockHistogram },
        { provide: 'PROM_METRIC_AI_COMPLEXITY_SCORE', useValue: mockHistogram },
        {
          provide: FileLockManagerService,
          useValue: {
            predictFileModifications: jest.fn().mockResolvedValue({ filePaths: [] }),
            acquireLocks: jest.fn().mockResolvedValue({ acquired: true }),
          },
        },
        {
          provide: BranchStrategistService,
          useValue: {
            selectBaseBranch: jest.fn().mockResolvedValue({
              selectedBranch: 'main',
              strategy: 'main',
              reasoning: 'default',
            }),
          },
        },
        { provide: 'PROM_METRIC_DSF_TICKET_WAITING_LOCKS_TOTAL', useValue: mockCounter },
        { provide: ProviderFactoryService, useValue: mockProviderFactory },
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

  it('should route high complexity ticket (score >= 10) to CLAUDE_CODE', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 15 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.CLAUDE_CODE,
      fallback: AIProvider.CODEX,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 15,
      complexityGrade: ComplexityGrade.HIGH,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CLAUDE_CODE,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_HIGH);
    expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.AI_EXECUTION,
      expect.anything(),
      mockRequest.correlationId,
    );
  });

  it('should route medium complexity ticket (5 <= score < 10) to CLAUDE_CODE', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 7 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.CLAUDE_CODE,
      fallback: AIProvider.GEMINI,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 7,
      complexityGrade: ComplexityGrade.MEDIUM,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CLAUDE_CODE,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_MEDIUM);
  });

  it('should route low complexity ticket (score < 5) to KIMI', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 3 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.KIMI,
      fallback: AIProvider.CLAUDE_CODE,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 3,
      complexityGrade: ComplexityGrade.LOW,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.KIMI,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.KIMI);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_LOW);
  });

  it('should honor primary provider override from factory/config', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 15 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.GEMINI,
      fallback: null,
      reason: ProviderSelectionReason.OVERRIDE,
      complexityScore: 15,
      complexityGrade: ComplexityGrade.HIGH,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.GEMINI,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.GEMINI);
    expect(decision.routingReason).toBe(RoutingReason.EXPLICIT_OVERRIDE);
  });

  it('should route low complexity ticket (score < 5) with KIMI disabled to CLAUDE_CODE', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 3 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.CLAUDE_CODE,
      fallback: null,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 3,
      complexityGrade: ComplexityGrade.LOW,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue({
      provider: AIProvider.CLAUDE_CODE,
      health: { isHealthy: true },
    });
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    const decision = await service.routeTicket(mockRequest);

    expect(decision.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
    expect(decision.routingReason).toBe(RoutingReason.COMPLEXITY_LOW);
  });

  it('should handle fallback when provider is unhealthy', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 15 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.CLAUDE_CODE,
      fallback: null,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 15,
      complexityGrade: ComplexityGrade.HIGH,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue(null); // All unhealthy
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    await expect(service.routeTicket(mockRequest)).rejects.toThrow(
      'No AI provider currently available',
    );
  });

  it('should queue for delayed retry when no provider is available', async () => {
    mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 10 });
    mockProviderFactory.selectProvider.mockResolvedValue({
      primary: AIProvider.CLAUDE_CODE,
      fallback: null,
      reason: ProviderSelectionReason.COMPLEXITY,
      complexityScore: 10,
      complexityGrade: ComplexityGrade.HIGH,
    });
    mockProviderHealth.getAvailableProvider.mockResolvedValue(null); // No provider
    mockProviderHealth.shouldAlert.mockReturnValue(false);
    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1' });

    await expect(service.routeTicket(mockRequest)).rejects.toThrow(
      'No AI provider currently available',
    );

    // Verify publish to WAIT queue
    expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
      QUEUE_NAMES.AI_ROUTING_WAIT,
      mockRequest,
      mockRequest.correlationId,
    );

    // Execution is created early for file locks, but then cancelled
    expect(mockPrisma.execution.create).toHaveBeenCalled();
    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { status: 'CANCELLED', error_message: 'No AI provider available' },
    });

    // Verify NO ticket update (it will be retried)
    expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
  });
});
