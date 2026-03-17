import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@/database/prisma.service';
import { TicketStatus } from '@/prisma/client';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '../src/rabbitmq/rabbitmq-publisher.service';
import { TicketIntakeService } from '../src/ticket-intake/ticket-intake.service';
import { AIRoutingService } from '../src/ai-routing/ai-routing.service';
import { CircularDependencyDetectorService } from '../src/dependencies/circular-dependency-detector.service';
import { DependencyManagerService } from '../src/dependencies/dependency-manager.service';
import { FileLockManagerService } from '../src/file-locks/file-lock-manager.service';
import { ClickUpService } from '../src/clickup/clickup.service';

describe('Dependency & Conflict Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rabbitMQ: RabbitMQPublisherService;
  let intakeService: TicketIntakeService;
  let routingService: AIRoutingService;

  const mockProject = {
    id: 'proj-123',
    name: 'Test Project',
    clickup_list_id: 'list-123',
    github_repository_url: 'https://github.com/org/repo',
    default_branch: 'main',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
        project: {
          findUnique: jest.fn().mockResolvedValue(mockProject),
          findFirst: jest.fn().mockResolvedValue(mockProject),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        ticket: {
          create: jest
            .fn()
            .mockImplementation((args) => Promise.resolve({ id: 'ticket-123', ...args.data })),
          update: jest
            .fn()
            .mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn().mockResolvedValue({}),
        },
        ticketDependency: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        execution: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          groupBy: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        providerHealth: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        aIDecisionLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        fileLock: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        qaResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        qAResult: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      })
      .overrideProvider(RabbitMQService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        getConnection: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
        getChannel: jest.fn().mockReturnValue({
          assertQueue: jest.fn().mockResolvedValue({}),
          assertExchange: jest.fn().mockResolvedValue({}),
          bindQueue: jest.fn().mockResolvedValue({}),
          consume: jest.fn().mockResolvedValue({ consumerTag: 'test' }),
          prefetch: jest.fn(),
          cancel: jest.fn().mockResolvedValue({}),
          close: jest.fn().mockResolvedValue({}),
          checkQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
        }),
        publishToQueue: jest.fn().mockResolvedValue(true),
      })
      .overrideProvider(RabbitMQPublisherService)
      .useValue({
        publish: jest.fn(),
        publishToQueue: jest.fn().mockResolvedValue(true),
        publishToExchange: jest.fn().mockResolvedValue(true),
      })
      .overrideProvider(ClickUpService)
      .useValue({
        updateStatus: jest.fn().mockResolvedValue(true),
        addComment: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    rabbitMQ = app.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    intakeService = app.get<TicketIntakeService>(TicketIntakeService);
    routingService = app.get<AIRoutingService>(AIRoutingService);

    // Mock project in DB

    jest.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as any);

    jest.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as any);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Circular Dependency Handling', () => {
    it('should block a ticket with a circular dependency', async () => {
      const taskId = 'task-cycle-1';

      // Mock cycle detection
      jest
        .spyOn(app.get(CircularDependencyDetectorService), 'detectCircularDependencies')
        .mockResolvedValue({
          hasCycle: true,
          cycle: ['task-cycle-1', 'task-cycle-2', 'task-cycle-1'],
          affectedTickets: ['task-cycle-1', 'task-cycle-2'],
          confidence: 1.0,
        });

      const result = await intakeService.processTaskEvent({
        correlationId: 'test-corr-1',
        webhookEventId: 'ev-1',
        eventType: 'taskCreated',
        taskId,
        taskName: 'Circular Dependency Task Case',
        taskDescription:
          'This is a long description to satisfy the 50 character requirement of the ticket validator service. \n\n## Acceptance Criteria\n- The task must be blocked due to a cycle.\n- PM must be alerted.',
        taskStatus: 'open',
        listId: 'list-123',
        listName: 'List',
        spaceId: 'space-1',
        projectId: 'list-123',
        projectName: 'Project',
        taskUrl: 'url',
        tags: [],
        customFields: {},
        creatorEmail: 'test@test.com',
        eventTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      });

      expect(result.status).toBe(TicketStatus.BLOCKED_CIRCULAR);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Circular dependency detected');
    });
  });

  describe('Dependency Blocker Handling', () => {
    it('should mark ticket as WAITING if blockers are unresolved', async () => {
      const taskId = 'task-blocked-1';
      const eta = new Date();
      eta.setHours(eta.getHours() + 2);

      // Mock dependency check
      jest.spyOn(app.get(DependencyManagerService), 'checkDependencies').mockResolvedValue({
        canProceed: false,
        unresolvedDependencies: ['blocker-1'],
        resolvedCount: 0,
        totalCount: 1,
        estimatedETA: eta,
      });

      // Mock no cycle
      jest
        .spyOn(app.get(CircularDependencyDetectorService), 'detectCircularDependencies')
        .mockResolvedValue({
          hasCycle: false,
          cycle: [],
          affectedTickets: [],
          confidence: 1.0,
        });

      const result = await intakeService.processTaskEvent({
        correlationId: 'test-corr-2',
        webhookEventId: 'ev-2',
        eventType: 'taskCreated',
        taskId,
        taskName: 'Blocked Dependency Task Case',
        taskDescription:
          'This is another long description to satisfy the ticket validator service requirements for testing dependency blockers. \n\n## Acceptance Criteria\n- The task must wait for its blockers to resolve.\n- ETA should be calculated.',
        taskStatus: 'open',
        listId: 'list-123',
        listName: 'List',
        spaceId: 'space-1',
        projectId: 'list-123',
        projectName: 'Project',
        taskUrl: 'url',
        tags: [],
        customFields: {},
        creatorEmail: 'test@test.com',
        eventTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      });

      expect(result.status).toBe(TicketStatus.WAITING);
      expect(result.estimatedETA).toEqual(eta);
      expect(rabbitMQ.publishToQueue).not.toHaveBeenCalledWith(
        'ai-routing-queue',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('File Lock Conflict Handling', () => {
    it('should re-queue ticket if file locks are unavailable', async () => {
      const ticketId = 'tick-lock-1';

      // Mock lock conflict
      jest.spyOn(app.get(FileLockManagerService), 'acquireLocks').mockResolvedValue({
        acquired: false,
        conflicts: {
          filePaths: ['src/app.ts'],
          ownerTicketIds: ['other-tick'],
        },
      });

      // Mock prediction
      jest.spyOn(app.get(FileLockManagerService), 'predictFileModifications').mockResolvedValue({
        filePaths: ['src/app.ts'],
        confidence: 0.9,
        reasoning: 'test',
      });

      const result = await routingService.routeTicket({
        correlationId: 'test-corr-3',
        ticketId,
        clickupTaskId: 'task-lock-1',
        projectId: 'proj-123',
        title: 'Lock Task',
        description: 'desc',
        acceptanceCriteria: 'ac',
        tags: [],
        qualityScore: 80,
        qualityGrade: 'excellent',
        timestamp: new Date().toISOString(),
      });

      expect(result.status).toBe('WAITING_FOR_LOCKS');
      expect(rabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ai-routing-wait-queue',
        expect.anything(),
        'test-corr-3',
      );
    });

    it('should handle sequential execution when locks become available', async () => {
      // This test simulates the re-triggering logic when locks are released
      const ticketId = 'tick-lock-2';

      // 1. Mock lock acquisition success (as if previously blocked)
      jest.spyOn(app.get(FileLockManagerService), 'acquireLocks').mockResolvedValue({
        acquired: true,
      });

      const result = await routingService.routeTicket({
        correlationId: 'test-corr-4',
        ticketId,
        clickupTaskId: 'task-lock-2',
        projectId: 'proj-123',
        title: 'Lock Task Resolved',
        description: 'desc',
        acceptanceCriteria: 'ac',
        tags: [],
        qualityScore: 80,
        qualityGrade: 'excellent',
        timestamp: new Date().toISOString(),
      });

      expect(result.status).toBe('QUEUED');
      expect(rabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ai-execution-queue',
        expect.anything(),
        'test-corr-4',
      );
    });
  });

  describe('Automatic Re-triggering', () => {
    it('should re-trigger dependent tickets when blocker is resolved', async () => {
      const blockerId = 'blocker-123';
      const dependentId = 'dependent-456';

      // Mock DB finding dependent tickets
      jest
        .spyOn(prisma.ticketDependency, 'findMany')
        .mockResolvedValue([
          { ticket_id: dependentId, depends_on: blockerId, status: 'WAITING' },
        ] as any);

      // Mock dependency check passing now
      jest.spyOn(app.get(DependencyManagerService), 'checkDependencies').mockResolvedValue({
        canProceed: true,
        unresolvedDependencies: [],
        resolvedCount: 1,
        totalCount: 1,
        estimatedETA: null,
      });

      const dependencyManager = app.get(DependencyManagerService);
      await dependencyManager.notifyDependentTickets(blockerId);

      // Verify re-queueing
      expect(rabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({
          ticket_id: dependentId,
          reason: 'dependencies_resolved',
        }),
      );

      // Verify ClickUp notification
      expect(app.get(ClickUpService).addComment).toHaveBeenCalledWith(
        dependentId,
        expect.stringContaining('All dependencies resolved'),
      );
    });
  });
});
