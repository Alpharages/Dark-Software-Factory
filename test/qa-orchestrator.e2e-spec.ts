import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { QaOrchestratorService } from '../src/qa-automation/qa-orchestrator.service';
import { AiQaOrchestrator } from '../src/qa-automation/ai-qa-orchestrator.service';
import { QualityGatesService } from '../src/qa-automation/quality-gates.service';
import { QaMetricsService } from '../src/qa-automation/qa-metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { TicketStatus, ExecutionStatus } from '@/prisma/client';
import { Role } from '../src/auth/constants/roles.enum';
import { RabbitMQPublisherService } from '../src/rabbitmq/rabbitmq-publisher.service';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';

describe('QaOrchestrator (E2E)', () => {
  let app: INestApplication;
  let orchestratorService: QaOrchestratorService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockRabbitPublisher = {
    publishToExchange: jest.fn().mockResolvedValue(true),
    publishToQueue: jest.fn().mockResolvedValue(true),
  };

  const mockChannel = {
    assertQueue: jest.fn().mockResolvedValue({}),
    assertExchange: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'test-tag' }),
    prefetch: jest.fn().mockResolvedValue({}),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn().mockResolvedValue(true),
    publish: jest.fn().mockResolvedValue(true),
    cancel: jest.fn().mockResolvedValue({}),
    checkQueue: jest.fn().mockResolvedValue({ messageCount: 0, consumerCount: 0 }),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockRabbitMQService = {
    connect: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    getChannel: jest.fn().mockReturnValue(mockChannel),
    getQueueStats: jest.fn().mockResolvedValue({ messageCount: 0, consumerCount: 0 }),
    isHealthy: jest.fn().mockResolvedValue(true),
    publishToQueue: jest.fn().mockResolvedValue(true),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const mockAiQaOrchestrator = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (typeof prop === 'string' && prop.startsWith('execute')) {
          return jest.fn().mockResolvedValue({
            status: 'success',
            score: 100,
            passed: true,
            analysis: `Mock ${prop} success`,
            issues: [],
          });
        }
        return undefined;
      },
    },
  );

  const mockQualityGatesService = {
    evaluate: jest.fn().mockResolvedValue({ passed: true, results: [] }),
  };

  const mockQaMetrics = {
    recordGateDecision: jest.fn(),
    recordCheck: jest.fn(),
    recordQuery: jest.fn(),
    recordCheckError: jest.fn(),
  };

  // Improved mock Prisma with Proxy to handle all model methods automatically
  const createMockPrisma = () => {
    const mockPrisma: any = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((cb) => cb(mockPrisma)),
      $on: jest.fn(),
      $use: jest.fn(),
    };

    const createModelMock = () => ({
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    });

    // Pre-populate common models with unique mock objects
    mockPrisma.execution = createModelMock();
    mockPrisma.ticket = createModelMock();
    mockPrisma.project = createModelMock();
    mockPrisma.workspace = createModelMock();
    mockPrisma.auditLog = createModelMock();
    mockPrisma.aIDecisionLog = createModelMock();
    mockPrisma.qaResult = createModelMock();
    mockPrisma.qAResult = createModelMock();
    mockPrisma.fileLock = createModelMock();

    return new Proxy(mockPrisma, {
      get: (target, prop: string) => {
        if (prop in target) return target[prop];

        if (
          typeof prop === 'string' &&
          prop[0] === prop[0].toLowerCase() &&
          !prop.startsWith('$')
        ) {
          const newModel = createModelMock();
          target[prop] = newModel;
          return newModel;
        }

        return target[prop];
      },
    });
  };

  const mockPrismaService = createMockPrisma();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(RabbitMQPublisherService)
      .useValue(mockRabbitPublisher)
      .overrideProvider(RabbitMQService)
      .useValue(mockRabbitMQService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(AiQaOrchestrator)
      .useValue(mockAiQaOrchestrator)
      .overrideProvider(QualityGatesService)
      .useValue(mockQualityGatesService)
      .overrideProvider(QaMetricsService)
      .useValue(mockQaMetrics)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orchestratorService = moduleFixture.get<QaOrchestratorService>(QaOrchestratorService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const createToken = (role: Role): string => {
    return jwtService.sign({
      sub: 'user-123',
      email: 'test@test.com',
      role,
    });
  };

  it('should process a full QA check via orchestrator', async () => {
    // 1. Configure mock expectations
    (mockPrismaService.ticket.create as jest.Mock).mockResolvedValue({
      id: 'ticket-e2e-1',
      title: 'E2E Test Ticket',
      project_id: 'proj-e2e-1',
    });
    (mockPrismaService.ticket.findUnique as jest.Mock).mockResolvedValue({
      id: 'ticket-e2e-1',
      status: TicketStatus.GITHUB_PUSH,
    });
    // 1. Setup mocks for specific models needed for this test
    mockPrismaService.execution.findUnique.mockResolvedValue({
      id: 'exec-1',
      status: ExecutionStatus.IN_PROGRESS,
      clickup_task_id: 'ticket-e2e-1',
      project_id: 'proj-e2e-1',
    });
    mockPrismaService.ticket.findUnique.mockResolvedValue({
      id: 'ticket-e2e-1',
      status: TicketStatus.QA_REVIEW,
    });
    mockPrismaService.project.findUnique.mockResolvedValue({
      id: 'proj-e2e-1',
      name: 'Test Project',
    });
    mockPrismaService.qaResult.create.mockResolvedValue({ id: 'qa-1' });

    // 2. Define message
    const message = {
      executionId: 'exec-1',
      ticketId: 'ticket-e2e-1',
      projectId: 'proj-e2e-1',
      correlationId: 'corr-1',
      workspacePath: '/tmp/test-workspace',
    };

    // 3. Call orchestrator directly
    const result = await orchestratorService.processQaCheck(message);

    // 4. Verify orchestration result
    expect(result.executionId).toBe(message.executionId);
    expect(result.qualityGateResult.passed).toBe(true);

    // 5. Verify database updates
    expect(prisma.ticket.update).toHaveBeenCalled();
    expect(prisma.qAResult.create).toHaveBeenCalled();

    // 6. Verify RabbitMQ emission
    expect(mockRabbitPublisher.publishToExchange).toHaveBeenCalled();

    // 7. Verify Access via API
    const token = createToken(Role.QA);
    (mockPrismaService.qAResult.findFirst as jest.Mock).mockResolvedValueOnce({
      execution_id: message.executionId,
      overall_passed: true,
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/qa-results/${message.executionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.execution_id).toBe(message.executionId);
    expect(response.body.overall_passed).toBe(true);
  });

  it('should allow manual override of failed gate', async () => {
    const executionId = 'exec-fail-1';
    const token = createToken(Role.QA);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/quality-gate/${executionId}/override`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Emergency fix', approvedBy: 'User1' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Quality gate overridden');

    // 3. Verify DB update
    expect(prisma.qAResult.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { execution_id: executionId },
        data: { overall_passed: true },
      }),
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'quality_gate_override',
          entity_id: executionId,
        }),
      }),
    );
  });
});
