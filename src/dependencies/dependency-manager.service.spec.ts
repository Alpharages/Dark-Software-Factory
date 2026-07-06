import { Test, TestingModule } from '@nestjs/testing';
import { DependencyManagerService } from './dependency-manager.service';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { TicketDependencyRepository } from './ticket-dependency.repository';

describe('DependencyManagerService', () => {
  let service: DependencyManagerService;
  let clickUpService: jest.Mocked<ClickUpService>;
  let prismaService: jest.Mocked<PrismaService>;
  let rabbitmqPublisher: jest.Mocked<RabbitMQPublisherService>;
  let ticketDependencies: jest.Mocked<TicketDependencyRepository>;

  interface MockClickUpApiTask {
    id: string;
    name: string;
    description: string;
    status: { status: string };
    text_content?: string;
    dependencies?: { task_id: string }[];
  }

  beforeEach(async () => {
    const mockClickUpService = {
      getTask: jest.fn().mockResolvedValue({}),
      updateStatus: jest.fn().mockResolvedValue(true),
      addComment: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ClickUpService>;

    const mockAIDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue({ id: 'log-id' }),
    };

    const mockMetricsService = {
      incrementCounter: jest.fn(),
      recordHistogram: jest.fn(),
      setGauge: jest.fn(),
    };

    const mockPrismaService = {
      ticketDependency: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      execution: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ticket: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mockRabbitMQPublisher = {
      publishToQueue: jest.fn().mockResolvedValue(true),
      publishWithRetry: jest.fn().mockResolvedValue(true),
    };

    const mockTicketDependencies = {
      getBlockers: jest.fn().mockResolvedValue([]),
      getDependents: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependencyManagerService,
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQPublisher },
        { provide: TicketDependencyRepository, useValue: mockTicketDependencies },
      ],
    }).compile();

    service = module.get<DependencyManagerService>(DependencyManagerService);
    clickUpService = module.get(ClickUpService);
    prismaService = module.get(PrismaService);
    rabbitmqPublisher = module.get(RabbitMQPublisherService);
    ticketDependencies = module.get(TicketDependencyRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkDependencies', () => {
    it('should return canProceed=true when ticket has no dependencies', async () => {
      // Mock ClickUp API: task with no dependencies
      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        id: 'ticket-123',
        name: 'Task 123',
        description: 'Test task',
        status: { status: 'Open' },
        dependencies: undefined,
      } as MockClickUpApiTask);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.resolvedCount).toBe(0);
      expect(result.estimatedETA).toBeNull();
    });

    it('should return canProceed=true when all dependencies are resolved', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-1', circular_detected: false },
        { depends_on: 'dep-2', circular_detected: false },
      ] as never);
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'dep-1',
          name: 'Dep 1',
          description: '',
          status: { status: 'completed' },
        } as MockClickUpApiTask)
        .mockResolvedValueOnce({
          id: 'dep-2',
          name: 'Dep 2',
          description: '',
          status: { status: 'deployed' },
        } as MockClickUpApiTask);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toEqual([]);
      expect(result.totalCount).toBe(2);
      expect(result.resolvedCount).toBe(2);
    });

    it('should return canProceed=false when one dependency is unresolved', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-1', circular_detected: false },
        { depends_on: 'dep-2', circular_detected: false },
      ] as never);
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'dep-1',
          name: 'Dep 1',
          description: '',
          status: { status: 'in progress' },
        } as MockClickUpApiTask)
        .mockResolvedValueOnce({
          id: 'dep-2',
          name: 'Dep 2',
          description: '',
          status: { status: 'completed' },
        } as MockClickUpApiTask);
      // Mock execution history for ETA
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(false);
      expect(result.unresolvedDependencies).toContain('dep-1');
      expect(result.totalCount).toBe(2);
      expect(result.resolvedCount).toBe(1);
      expect(result.estimatedETA).not.toBeNull();
    });

    it('should return canProceed=false with circular dependency detected', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-123',
          depends_on: 'dep-1',
          status: 'BLOCKED',
          circular_detected: true,
          created_at: new Date(),
          resolved_at: null,
        } as never,
      ] as never);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(false);
      expect(result.unresolvedDependencies).toContain('dep-1');
      expect(result.estimatedETA).toBeNull(); // Cannot estimate ETA for circular deps
    });

    it('should proceed when no dependency rows exist even if ClickUp is unavailable', async () => {
      const result = await service.checkDependencies('ticket-123');
      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('treats a deleted blocker (404) as resolved to avoid deadlock', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-missing', circular_detected: false },
      ] as never);
      (clickUpService.getTask as jest.Mock).mockRejectedValueOnce(new Error('Task not found'));

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toEqual([]);
      expect(result.resolvedCount).toBe(1);
    });

    it('treats a transient blocker fetch error as unresolved', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-1', circular_detected: false },
      ] as never);
      (clickUpService.getTask as jest.Mock).mockRejectedValueOnce(new Error('ClickUp 503'));

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(false);
      expect(result.unresolvedDependencies).toEqual(['dep-1']);
    });

    it('falls back to the live ClickUp status when the local ticket is tracked but not yet resolved', async () => {
      // Regression test: Ticket.status is DSF's internal pipeline status (e.g. QA_REVIEW),
      // never one of the words isStatusResolved recognizes. A defined-but-unresolved local
      // status must not suppress the real ClickUp completion check.
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-1', circular_detected: false },
      ] as never);
      (prismaService.ticket.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'QA_REVIEW' });
      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        status: { status: 'completed' },
      });

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(result.resolvedCount).toBe(1);
    });

    it('uses the local ticket status as a fast path when already resolved, skipping ClickUp', async () => {
      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'dep-1', circular_detected: false },
      ] as never);
      (prismaService.ticket.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'COMPLETED' });

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(clickUpService.getTask).not.toHaveBeenCalled();
    });
  });

  describe('calculateETA', () => {
    it('should calculate ETA based on historical execution data', async () => {
      // Mock historical execution data: 3 executions, avg 10 minutes
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-a',
          started_at: new Date('2025-12-22T10:00:00Z'),
          completed_at: new Date('2025-12-22T10:08:00Z'), // 8 min
        },
        {
          id: '2',
          ticket_id: 'ticket-b',
          started_at: new Date('2025-12-22T11:00:00Z'),
          completed_at: new Date('2025-12-22T11:10:00Z'), // 10 min
        },
        {
          id: '3',
          ticket_id: 'ticket-c',
          started_at: new Date('2025-12-22T12:00:00Z'),
          completed_at: new Date('2025-12-22T12:12:00Z'), // 12 min
        },
      ]);

      const result = await service.calculateETA('ticket-123', ['dep-1', 'dep-2']);

      expect(result.historicalAverage).toBeCloseTo(10, 1); // (8+10+12)/3 = 10
      expect(result.queuePosition).toBe(0);
      expect(result.estimatedWaitMinutes).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.reasoning).toContain('historical');
      expect(result.estimatedCompletionTime).toBeInstanceOf(Date);
    });

    it('should use default average when no historical data exists', async () => {
      // Mock no historical data
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([]);

      // Mock task for complexity estimation
      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        id: 'ticket-123',
        name: 'Task 123',
        description: 'This is a complex task with many requirements and edge cases',
        status: { status: 'Open' },
      });

      const result = await service.calculateETA('ticket-123', ['dep-1']);

      expect(result.historicalAverage).toBeNull();
      expect(result.estimatedWaitMinutes).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.5); // Lower confidence without historical data
      expect(result.reasoning).toContain('default');
    });

    it('should ignore removed QA queue depth for ETA calculation', async () => {
      // Mock historical data
      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-a',
          started_at: new Date('2025-12-22T10:00:00Z'),
          completed_at: new Date('2025-12-22T10:10:00Z'), // 10 min
        },
      ]);

      const result = await service.calculateETA('ticket-123', ['dep-1']);

      expect(result.queuePosition).toBe(0);
      expect(result.estimatedWaitMinutes).toBeGreaterThan(0);
    });

    it('should provide higher confidence with more historical samples', async () => {
      // Mock 10 historical executions
      const executions = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        ticket_id: `ticket-${i}`,
        started_at: new Date('2025-12-22T10:00:00Z'),
        completed_at: new Date('2025-12-22T10:10:00Z'),
      }));

      (prismaService.execution.findMany as jest.Mock).mockResolvedValueOnce(executions);

      const result = await service.calculateETA('ticket-123', []);

      expect(result.confidence).toBeGreaterThan(0.7); // High confidence with 10 samples
    });
  });

  describe('notifyDependentTickets', () => {
    it('should find and notify dependent tickets when a ticket is completed', async () => {
      ticketDependencies.getDependents.mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-a',
          depends_on: 'completed-ticket',
          status: 'WAITING',
          circular_detected: false,
        },
        {
          id: '2',
          ticket_id: 'ticket-b',
          depends_on: 'completed-ticket',
          status: 'WAITING',
          circular_detected: false,
        },
      ] as never);

      ticketDependencies.getBlockers
        .mockResolvedValueOnce([
          { depends_on: 'completed-ticket', circular_detected: false },
          { depends_on: 'other-dep', circular_detected: false },
        ] as never)
        .mockResolvedValueOnce([
          { depends_on: 'completed-ticket', circular_detected: false },
        ] as never);
      (prismaService.ticket.findUnique as jest.Mock).mockImplementation(
        ({ where }: { where: { clickup_task_id?: string } }) => {
          if (where.clickup_task_id === 'completed-ticket') {
            return Promise.resolve({ status: 'COMPLETED' });
          }
          if (where.clickup_task_id === 'other-dep') {
            return Promise.resolve({ status: 'AI_PROCESSING' });
          }
          return Promise.resolve({
            dependency_block_behavior: null,
            project: { dependency_block_behavior: 'auto_resume' },
          });
        },
      );

      await service.notifyDependentTickets('completed-ticket');

      // Verify ClickUp comments added
      expect(clickUpService.addComment).toHaveBeenCalledTimes(2);

      // Verify both tickets received comments (order-agnostic)
      const calls = (clickUpService.addComment as jest.Mock).mock.calls;
      const ticketIds = calls.map((call) => call[0]);
      expect(ticketIds).toContain('ticket-a');
      expect(ticketIds).toContain('ticket-b');

      // Verify all comments mention dependencies
      calls.forEach((call) => {
        expect(call[1].toLowerCase()).toMatch(/dependenc/);
      });

      // Verify ticket-b was re-queued (all deps resolved)
      expect(rabbitmqPublisher.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({ ticket_id: 'ticket-b' }),
      );

      // Verify ticket-a was NOT re-queued (still has unresolved deps)
      expect(rabbitmqPublisher.publishToQueue).not.toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({ ticket_id: 'ticket-a' }),
      );
    });

    it('should handle no dependent tickets gracefully', async () => {
      ticketDependencies.getDependents.mockResolvedValueOnce([]);

      await service.notifyDependentTickets('completed-ticket');

      expect(clickUpService.addComment).not.toHaveBeenCalled();
      expect(rabbitmqPublisher.publishToQueue).not.toHaveBeenCalled();
    });

    it('should handle ClickUp API failures when adding comments', async () => {
      ticketDependencies.getDependents.mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-a',
          depends_on: 'completed-ticket',
          status: 'WAITING',
        },
      ] as never);

      ticketDependencies.getBlockers.mockResolvedValueOnce([
        { depends_on: 'completed-ticket', circular_detected: false },
      ] as never);
      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        id: 'completed-ticket',
        status: { status: 'completed' },
      });

      (clickUpService.addComment as jest.Mock).mockRejectedValueOnce(
        new Error('ClickUp API error'),
      );

      // Should not throw, but log error
      await expect(service.notifyDependentTickets('completed-ticket')).resolves.not.toThrow();
    });
  });
});
