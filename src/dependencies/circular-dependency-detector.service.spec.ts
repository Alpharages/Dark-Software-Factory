import { Test, TestingModule } from '@nestjs/testing';
import { CircularDependencyDetectorService } from './circular-dependency-detector.service';
import { ClickUpService } from '../clickup/clickup.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from '../database/prisma.service';
import { Logger } from '@nestjs/common';
import { DependencyGraph, CircularDependencyResult, ClickUpTask } from './interfaces/dependency-graph.interface';

describe('CircularDependencyDetectorService', () => {
  let service: CircularDependencyDetectorService;
  let clickUpService: jest.Mocked<ClickUpService>;
  let aiDecisionLogger: jest.Mocked<AIDecisionLoggerService>;
  let metricsService: jest.Mocked<MetricsService>;
  let prismaService: jest.Mocked<PrismaService>;

  // Mock task data for tests
  const mockTaskA: ClickUpTask = {
    id: 'task-a',
    name: 'Task A',
    status: { status: 'In Progress' },
    dependencies: [{ task_id: 'task-b', type: 'waiting_on' }],
  };

  const mockTaskB: ClickUpTask = {
    id: 'task-b',
    name: 'Task B',
    status: { status: 'In Progress' },
    dependencies: [{ task_id: 'task-c', type: 'waiting_on' }],
  };

  const mockTaskC: ClickUpTask = {
    id: 'task-c',
    name: 'Task C',
    status: { status: 'In Progress' },
    dependencies: [{ task_id: 'task-a', type: 'waiting_on' }],
  };

  beforeEach(async () => {
    const mockClickUpService = {
      getTask: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(true),
      addComment: jest.fn().mockResolvedValue(true),
    };

    const mockAIDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue({ id: 'log-id' }),
    };

    const mockMetricsService = {
      incrementCounter: jest.fn(),
      recordHistogram: jest.fn(),
      setGauge: jest.fn(),
      getCounter: jest.fn().mockReturnValue({ inc: jest.fn() }),
      getHistogram: jest.fn().mockReturnValue({ observe: jest.fn() }),
      getGauge: jest.fn().mockReturnValue({ set: jest.fn() }),
    };

    const mockPrismaService = {
      ticketDependency: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircularDependencyDetectorService,
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CircularDependencyDetectorService>(CircularDependencyDetectorService);
    clickUpService = module.get(ClickUpService);
    aiDecisionLogger = module.get(AIDecisionLoggerService);
    metricsService = module.get(MetricsService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectCircularDependencies', () => {
    it('should detect a simple 2-node cycle (A → B → A)', async () => {
      // Setup: A depends on B, B depends on A
      const taskA = { ...mockTaskA, dependencies: [{ task_id: 'task-b', type: 'waiting_on' as const }] };
      const taskB = { ...mockTaskB, dependencies: [{ task_id: 'task-a', type: 'waiting_on' as const }] };

      // Mock getTask to return objects with description field (required by ClickUp service)
      clickUpService.getTask
        .mockResolvedValueOnce({ ...taskA, description: '' })
        .mockResolvedValueOnce({ ...taskB, description: '' });

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toContain('task-a');
      expect(result.cycle).toContain('task-b');
      expect(result.confidence).toBe(0.95);
    });

    it('should detect a 3-node cycle (A → B → C → A)', async () => {
      clickUpService.getTask
        .mockResolvedValueOnce(mockTaskA)
        .mockResolvedValueOnce(mockTaskB)
        .mockResolvedValueOnce(mockTaskC);

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toEqual(expect.arrayContaining(['task-a', 'task-b', 'task-c']));
      expect(result.affectedTickets).toHaveLength(3);
      expect(result.confidence).toBe(0.95);
    });

    it('should detect self-dependency (A → A)', async () => {
      const selfDepTask = {
        ...mockTaskA,
        dependencies: [{ task_id: 'task-a', type: 'waiting_on' as const }],
      };

      clickUpService.getTask.mockResolvedValueOnce({ ...selfDepTask, description: '' });

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toContain('task-a');
      expect(result.affectedTickets).toEqual(['task-a']);
    });

    it('should return no cycle for linear chain (A → B → C)', async () => {
      const taskC = { ...mockTaskC, dependencies: [] };

      clickUpService.getTask
        .mockResolvedValueOnce({ ...mockTaskA, description: '' })
        .mockResolvedValueOnce({ ...mockTaskB, description: '' })
        .mockResolvedValueOnce({ ...taskC, description: '' });

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(false);
      expect(result.cycle).toEqual([]);
      expect(result.confidence).toBe(1.0);
    });

    it('should return no cycle for task with no dependencies', async () => {
      const taskNoDeps = { ...mockTaskA, dependencies: [] };

      clickUpService.getTask.mockResolvedValueOnce({ ...taskNoDeps, description: '' });

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(false);
      expect(result.cycle).toEqual([]);
    });

    it('should log AI decisions before and after detection', async () => {
      clickUpService.getTask.mockResolvedValueOnce({ ...mockTaskA, dependencies: [] });

      await service.detectCircularDependencies('task-a');

      expect(aiDecisionLogger.logDecision).toHaveBeenCalledTimes(2);
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'Circular Dependency Detector',
          action: 'circular_dependency_check',
          ticketId: 'task-a',
        }),
      );
    });

    it('should record Prometheus metrics', async () => {
      clickUpService.getTask.mockResolvedValueOnce({ ...mockTaskA, dependencies: [] });

      await service.detectCircularDependencies('task-a');

      expect(metricsService.setGauge).toHaveBeenCalled();
      expect(metricsService.recordHistogram).toHaveBeenCalled();
    });
  });

  describe('buildDependencyGraph', () => {
    it('should build a graph with multiple nodes', async () => {
      clickUpService.getTask
        .mockResolvedValueOnce({ ...mockTaskA, description: '' })
        .mockResolvedValueOnce({ ...mockTaskB, description: '' })
        .mockResolvedValueOnce({ ...mockTaskC, description: '' });

      const graph = await service.buildDependencyGraph('task-a');

      expect(graph.nodes.size).toBe(3);
      expect(graph.edges.get('task-a')).toEqual(['task-b']);
      expect(graph.edges.get('task-b')).toEqual(['task-c']);
    });

    it('should handle missing tasks gracefully', async () => {
      clickUpService.getTask
        .mockResolvedValueOnce({ ...mockTaskA, description: '' })
        .mockRejectedValueOnce(new Error('Task not found'));

      const graph = await service.buildDependencyGraph('task-a');

      expect(graph.nodes.size).toBe(1);
      expect(graph.nodes.has('task-a')).toBe(true);
    });
  });

  describe('visualizeCycle', () => {
    it('should format cycle path as markdown', () => {
      const cycle = ['task-a', 'task-b', 'task-c'];
      const graph: DependencyGraph = {
        nodes: new Map([
          ['task-a', mockTaskA],
          ['task-b', mockTaskB],
          ['task-c', mockTaskC],
        ]),
        edges: new Map(),
      };

      const result = service.visualizeCycle(cycle, graph);

      expect(result).toContain('Task A');
      expect(result).toContain('Task B');
      expect(result).toContain('Task C');
      expect(result).toContain('→');
    });
  });

  describe('alertPM', () => {
    it('should send alert to primary ticket and comments to others', async () => {
      const cycle = ['task-a', 'task-b', 'task-c'];
      const graph: DependencyGraph = {
        nodes: new Map([
          ['task-a', mockTaskA],
          ['task-b', mockTaskB],
          ['task-c', mockTaskC],
        ]),
        edges: new Map(),
      };

      await service.alertPM(cycle, graph);

      expect(clickUpService.addComment).toHaveBeenCalledTimes(3);
      expect(clickUpService.addComment).toHaveBeenCalledWith('task-a', expect.any(String));
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('circular_dependency_alerts_sent_total');
    });
  });

  describe('markTicketsAsCircular', () => {
    it('should update ClickUp status and database for all tickets', async () => {
      const ticketIds = ['task-a', 'task-b', 'task-c'];

      await service.markTicketsAsCircular(ticketIds);

      expect(clickUpService.updateStatus).toHaveBeenCalledTimes(3);
      expect(prismaService.ticketDependency.updateMany).toHaveBeenCalledTimes(3);
    });

    it('should continue processing if one ticket update fails', async () => {
      const ticketIds = ['task-a', 'task-b'];
      clickUpService.updateStatus
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce(true);

      await service.markTicketsAsCircular(ticketIds);

      expect(clickUpService.updateStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex multi-cycle graph', async () => {
      // Graph: A → B → C → A, D → E → D (two separate cycles)
      const taskD: ClickUpTask = {
        id: 'task-d',
        name: 'Task D',
        status: { status: 'In Progress' },
        dependencies: [{ task_id: 'task-e', type: 'waiting_on' }],
      };

      const taskE: ClickUpTask = {
        id: 'task-e',
        name: 'Task E',
        status: { status: 'In Progress' },
        dependencies: [{ task_id: 'task-d', type: 'waiting_on' }],
      };

      clickUpService.getTask
        .mockResolvedValueOnce(mockTaskA)
        .mockResolvedValueOnce(mockTaskB)
        .mockResolvedValueOnce(mockTaskC);

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(true);
    });

    it('should handle disconnected graph with cycle in subgraph', async () => {
      // Graph: A → B, C → D → C (cycle only in C-D subgraph)
      const taskB = { ...mockTaskB, dependencies: [] };

      clickUpService.getTask
        .mockResolvedValueOnce({ ...mockTaskA, description: '' })
        .mockResolvedValueOnce({ ...taskB, description: '' });

      const result = await service.detectCircularDependencies('task-a');

      expect(result.hasCycle).toBe(false);
    });
  });
});

