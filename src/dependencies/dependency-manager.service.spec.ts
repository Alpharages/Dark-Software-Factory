import { Test, TestingModule } from '@nestjs/testing';
import { DependencyManagerService } from './dependency-manager.service';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';

describe('DependencyManagerService', () => {
  let service: DependencyManagerService;
  let clickUpService: jest.Mocked<ClickUpService>;
  let prismaService: jest.Mocked<PrismaService>;
  let rabbitmqPublisher: jest.Mocked<RabbitMQPublisherService>;

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
    };

    const mockRabbitMQPublisher = {
      publishToQueue: jest.fn().mockResolvedValue(true),
      publishWithRetry: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependencyManagerService,
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQPublisher },
      ],
    }).compile();

    service = module.get<DependencyManagerService>(DependencyManagerService);
    clickUpService = module.get(ClickUpService);
    prismaService = module.get(PrismaService);
    rabbitmqPublisher = module.get(RabbitMQPublisherService);
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
      // Mock ClickUp API: task with 2 dependencies
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'ticket-123',
          name: 'Task 123',
          description: 'Test',
          status: { status: 'Open' },
          dependencies: [{ task_id: 'dep-1' }, { task_id: 'dep-2' }],
        } as MockClickUpApiTask)
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

      // Mock Prisma: no circular dependencies
      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toEqual([]);
      expect(result.totalCount).toBe(2);
      expect(result.resolvedCount).toBe(2);
    });

    it('should return canProceed=false when one dependency is unresolved', async () => {
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'ticket-123',
          name: 'Task 123',
          description: '',
          status: { status: 'Open' },
          dependencies: [{ task_id: 'dep-1' }, { task_id: 'dep-2' }],
        } as unknown)
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

      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([]);

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
      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        id: 'ticket-123',
        name: 'Task 123',
        description: '',
        status: { status: 'Open' },
        dependencies: [{ task_id: 'dep-1' }],
      } as unknown);

      // Mock Prisma: circular dependency flagged by Story 12.1
      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-123',
          depends_on: 'dep-1',
          status: 'BLOCKED',
          circular_detected: true,
          created_at: new Date(),
          resolved_at: null,
        } as unknown,
      ]);

      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(false);
      expect(result.unresolvedDependencies).toContain('dep-1');
      expect(result.estimatedETA).toBeNull(); // Cannot estimate ETA for circular deps
    });

    it('should handle ClickUp API failures gracefully', async () => {
      (clickUpService.getTask as jest.Mock).mockRejectedValueOnce(new Error('ClickUp API timeout'));

      // Should resolve with canProceed=true instead of throwing — dependency check is best-effort
      const result = await service.checkDependencies('ticket-123');
      expect(result.canProceed).toBe(true);
      expect(result.unresolvedDependencies).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle missing dependencies (404) gracefully', async () => {
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'ticket-123',
          name: 'Task 123',
          description: '',
          status: { status: 'Open' },
          dependencies: [{ task_id: 'dep-missing' }],
        } as MockClickUpApiTask)
        .mockRejectedValueOnce(new Error('Task not found'));

      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([]);

      // Should continue processing despite missing dependency
      const result = await service.checkDependencies('ticket-123');

      expect(result.canProceed).toBe(true); // Missing deps treated as resolved (deleted)
      expect(result.unresolvedDependencies).toEqual([]);
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
      // Mock Prisma: 2 tickets depend on 'completed-ticket'
      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([
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
      ]);

      // Mock checkDependencies for ticket-a: still blocked by another dep
      (clickUpService.getTask as jest.Mock)
        .mockResolvedValueOnce({
          id: 'ticket-a',
          name: 'Task A',
          description: '',
          status: { status: 'Open' },
          dependencies: [{ task_id: 'completed-ticket' }, { task_id: 'other-dep' }],
        })
        .mockResolvedValueOnce({
          id: 'completed-ticket',
          name: 'Completed',
          description: '',
          status: { status: 'completed' },
        })
        .mockResolvedValueOnce({
          id: 'other-dep',
          name: 'Other Dep',
          description: '',
          status: { status: 'in progress' },
        })
        // Mock checkDependencies for ticket-b: all deps resolved
        .mockResolvedValueOnce({
          id: 'ticket-b',
          name: 'Task B',
          description: '',
          status: { status: 'Open' },
          dependencies: [{ task_id: 'completed-ticket' }],
        })
        .mockResolvedValueOnce({
          id: 'completed-ticket',
          name: 'Completed',
          description: '',
          status: { status: 'completed' },
        });

      (prismaService.ticketDependency.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // ticket-a: no circular deps
        .mockResolvedValueOnce([]); // ticket-b: no circular deps

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
      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.notifyDependentTickets('completed-ticket');

      expect(clickUpService.addComment).not.toHaveBeenCalled();
      expect(rabbitmqPublisher.publishToQueue).not.toHaveBeenCalled();
    });

    it('should handle ClickUp API failures when adding comments', async () => {
      (prismaService.ticketDependency.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: '1',
          ticket_id: 'ticket-a',
          depends_on: 'completed-ticket',
          status: 'WAITING',
        },
      ]);

      (clickUpService.getTask as jest.Mock).mockResolvedValueOnce({
        id: 'ticket-a',
        name: 'Task A',
        description: '',
        status: { status: 'Open' },
        dependencies: [{ task_id: 'completed-ticket' }],
      });

      (clickUpService.addComment as jest.Mock).mockRejectedValueOnce(
        new Error('ClickUp API error'),
      );

      // Should not throw, but log error
      await expect(service.notifyDependentTickets('completed-ticket')).resolves.not.toThrow();
    });
  });
});
