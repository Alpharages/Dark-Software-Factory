import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { QaAutomationModule } from '../src/qa-automation/qa-automation.module';
import { QaOrchestratorService } from '../src/qa-automation/qa-orchestrator.service';
import { PrismaService } from '../src/database/prisma.service';
import { TicketStatus } from '@/prisma/client';
import { RabbitMQPublisherService } from '../src/rabbitmq/rabbitmq-publisher.service';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';

describe('QaOrchestrator (E2E)', () => {
  let app: INestApplication;
  let orchestratorService: QaOrchestratorService;
  let prisma: PrismaService;

  const mockRabbitPublisher = {
    publishToExchange: jest.fn().mockResolvedValue(true),
    publishToQueue: jest.fn().mockResolvedValue(true),
  };

  const mockRabbitMQService = {
    connect: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrismaService = {
    ticket: {
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: 'ticket-e2e-1',
          ...args.data,
          updated_at: new Date(),
          created_at: new Date(),
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ status: TicketStatus.GITHUB_PUSH }),
    },
    qAResult: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ overall_passed: true }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ action: 'quality_gate_override' }),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }), // Add this to resolve ConfigService for Logger
        QaAutomationModule,
      ],
    })
      .overrideProvider(RabbitMQPublisherService)
      .useValue(mockRabbitPublisher)
      .overrideProvider(RabbitMQService)
      .useValue(mockRabbitMQService)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orchestratorService = moduleFixture.get<QaOrchestratorService>(QaOrchestratorService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // await prisma.$disconnect(); // Mocked
    await app.close();
  });

  it('should process a full QA check via orchestrator', async () => {
    // 1. Create a test ticket
    const ticketData = {
      title: 'E2E Test Ticket',
      description: 'Testing QA Orchestration',
      status: TicketStatus.AI_PROCESSING,
      clickup_task_id: `task-${Date.now()}`,
      ticket_quality_score: 100,
      acceptance_criteria: 'Given X when Y then Z',
      project_id: 'proj-e2e-1',
    };
    const ticket = await prisma.ticket.create({ data: ticketData });

    // 2. Define message
    const message = {
      executionId: `exec-${Date.now()}`,
      ticketId: ticket.id,
      projectId: ticket.project_id,
      correlationId: `corr-${Date.now()}`,
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
    // For this to work with MOCK Prisma, the controller must use the SAME mock prisma instance.
    // Since we overrode it in the module, it should be the same singleton.
    // However, QaResultsController uses QaResultsService which uses PrismaService.
    // We need to ensure mockPrisma returns what QaResultsController expects.

    // Mock findFirst mapping: expects snake_case from DB
    (mockPrismaService.qAResult.findFirst as jest.Mock).mockResolvedValueOnce({
      execution_id: message.executionId,
      overall_passed: true,
      // status field does not exist in Prisma model
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/qa-results/${message.executionId}`)
      .expect(200);

    // Expect snake_case as returned by default serializer from Prisma object
    expect(response.body.execution_id).toBe(message.executionId);
    // Expect boolean for overall_passed
    expect(response.body.overall_passed).toBe(true);
  });

  it('should allow manual override of failed gate', async () => {
    const executionId = 'exec-fail-1';

    const response = await request(app.getHttpServer())
      .post(`/api/v1/quality-gate/${executionId}/override`)
      .send({ reason: 'Emergency fix', approvedBy: 'User1' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Quality gate overridden');

    // 3. Verify DB update
    // With mocks, we check calls
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
