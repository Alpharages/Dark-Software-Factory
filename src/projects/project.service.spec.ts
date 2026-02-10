import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { ProjectRepository } from './project.repository';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ConfigService } from '@nestjs/config';

describe('ProjectService', () => {
  let service: ProjectService;
  let repository: jest.Mocked<ProjectRepository>;

  const mockProject = {
    id: 'project-123',
    name: 'Test Project',
    clickup_list_id: 'list-123',
    github_repository_url: 'https://github.com/test/repo',
    default_branch: 'main',
    pm_id: 'pm-123',
    status: 'active',
    client_name: 'Test Client',
    provider: 'CLICKUP' as const,
    monitor_tasks: false,
    sync_config: null,
    budget_usd: new Prisma.Decimal(100.0),
    is_active: true,
    deactivated_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockCounter = {
    inc: jest.fn(),
  };

  // Define mockPrisma first as a partial object to avoid self-reference error
  const mockPrismaTx = {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    ticket: {
      upsert: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn((callback) => callback(mockPrismaTx)),
    ...mockPrismaTx,
  };

  const mockClickUpService = {
    getList: jest.fn(),
    getTasks: jest.fn(),
  };

  // Story 16-5: Mock for AIDecisionLoggerService
  const mockAIDecisionLogger = {
    logDecision: jest.fn().mockResolvedValue({ id: 'log-123' }),
  };

  // Story 20.1: Mock for RabbitMQPublisherService
  const mockRabbitMQPublisher = {
    publishToQueue: jest.fn().mockResolvedValue(undefined),
  };

  // Mock for ConfigService
  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
  };

  const mockTasks = [
    {
      id: 'task-1',
      name: 'Test Task 1',
      description: 'Desc 1',
      status: { status: 'open', color: '#ff0000' },
      date_updated: '123',
    },
    {
      id: 'task-2',
      name: 'Test Task 2',
      description: '',
      status: { status: 'complete', color: '#00ff00' },
      date_updated: '456',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: ProjectRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByListId: jest.fn(),
            findAll: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            countActiveTickets: jest.fn(),
            updateRepository: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ClickUpService,
          useValue: mockClickUpService,
        },
        {
          provide: 'PROM_METRIC_PROJECT_OPERATIONS_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_PROJECT_LOOKUPS_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_PROJECT_DELETION_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_PROJECT_SYNC_TOTAL',
          useValue: mockCounter,
        },
        // Story 16-5: AIDecisionLoggerService mock
        {
          provide: AIDecisionLoggerService,
          useValue: mockAIDecisionLogger,
        },
        // Story 20.1: RabbitMQPublisherService mock
        {
          provide: RabbitMQPublisherService,
          useValue: mockRabbitMQPublisher,
        },
        // ConfigService mock
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    repository = module.get(ProjectRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a project', async () => {
      repository.create.mockResolvedValue(mockProject);
      const dto = {
        name: 'Test Project',
        clickup_list_id: 'list-123',
        github_repository_url: 'https://github.com/test/repo',
        pm_id: 'pm-123',
        client_name: 'Test Client',
      };

      const result = await service.create(dto);

      expect(result).toEqual(mockProject);
      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        default_branch: 'main',
        status: 'active',
      });
      expect(mockCounter.inc).toHaveBeenCalledWith({ operation: 'create', status: 'success' });
    });
  });

  describe('findOne', () => {
    it('should return a project if found', async () => {
      repository.findById.mockResolvedValue(mockProject);

      const result = await service.findOne('project-123');

      expect(result).toEqual(mockProject);
      expect(mockCounter.inc).toHaveBeenCalledWith({ type: 'id' });
      expect(mockCounter.inc).toHaveBeenCalledWith({ type: 'id', status: 'success' });
    });

    it('should throw NotFoundException if not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      expect(mockCounter.inc).toHaveBeenCalledWith({ type: 'id', status: 'not_found' });
    });
  });

  describe('findByListId', () => {
    it('should return a project if found', async () => {
      repository.findByListId.mockResolvedValue(mockProject);

      const result = await service.findByListId('list-123');

      expect(result).toEqual(mockProject);
      expect(mockCounter.inc).toHaveBeenCalledWith({ type: 'list_id', status: 'success' });
    });
  });

  describe('reassign', () => {
    it('should reassign project to a new PM successfully', async () => {
      const reassignDto = { new_pm_id: 'pm-456', reason: 'Workload balancing' };
      const updatedProject = { ...mockProject, pm_id: 'pm-456' };

      mockPrismaTx.project.findUnique.mockResolvedValue(mockProject);
      mockPrismaTx.user.findUnique.mockResolvedValue({
        id: 'pm-456',
        full_name: 'New PM',
        email: 'newpm@test.com',
        role: 'PM',
      });
      mockPrismaTx.project.update.mockResolvedValue(updatedProject);
      mockPrismaTx.auditLog.create.mockResolvedValue({});

      const result = await service.reassign('project-123', reassignDto);

      expect(result.pm_id).toBe('pm-456');
      expect(mockPrismaTx.auditLog.create).toHaveBeenCalled();
      expect(mockCounter.inc).toHaveBeenCalledWith({ operation: 'reassign', status: 'success' });
    });
  });

  describe('deleteProject', () => {
    it('should delete project when no active tickets', async () => {
      repository.findById.mockResolvedValue(mockProject);
      repository.countActiveTickets.mockResolvedValue(0);
      repository.delete.mockResolvedValue(mockProject);

      const result = await service.deleteProject('project-123', false);

      expect(result).toEqual(mockProject);
      expect(repository.delete).toHaveBeenCalledWith('project-123');
      expect(mockCounter.inc).toHaveBeenCalledWith({ status: 'success', force: 'false' });
      // Story 16-5: Verify AIDecisionLoggerService was called AFTER deletion with correct data
      expect(mockAIDecisionLogger.logDecision).toHaveBeenCalledWith({
        agentName: ProjectService.name,
        action: 'project_safe_delete',
        reasoning:
          'Project deleted successfully. Project: "Test Project" (project-123), Active Tickets: 0, Force: false',
        ticketId: 'project-123',
        inputData: {
          projectId: 'project-123',
          projectName: 'Test Project',
          activeTickets: 0,
          force: false,
        },
        outputData: {
          deleted: true,
          projectId: 'project-123',
          deletedAt: expect.any(String),
        },
        confidence: 1.0,
      });
      // Fix: Issue #1 - Verify deletion happens BEFORE logging (structurally enforced in code)
    });

    it('should reject deletion when active tickets exist and force=false', async () => {
      repository.findById.mockResolvedValue(mockProject);
      repository.countActiveTickets.mockResolvedValue(5);

      await expect(service.deleteProject('project-123', false)).rejects.toThrow(
        'Cannot delete project with 5 active tickets',
      );
      expect(repository.delete).not.toHaveBeenCalled();
      // Fix: Issue #3 - Verify no audit log is created for rejected deletions
      expect(mockAIDecisionLogger.logDecision).not.toHaveBeenCalled();
    });

    it('should force delete project when active tickets exist and force=true', async () => {
      repository.findById.mockResolvedValue(mockProject);
      repository.countActiveTickets.mockResolvedValue(5);
      repository.delete.mockResolvedValue(mockProject);

      const result = await service.deleteProject('project-123', true);

      expect(result).toEqual(mockProject);
      expect(repository.delete).toHaveBeenCalledWith('project-123');
      expect(mockCounter.inc).toHaveBeenCalledWith({ status: 'success', force: 'true' });
      // Story 16-5: Verify AIDecisionLoggerService was called with force delete action
      expect(mockAIDecisionLogger.logDecision).toHaveBeenCalledWith({
        agentName: ProjectService.name,
        action: 'project_force_delete',
        reasoning:
          'Project deleted successfully. Project: "Test Project" (project-123), Active Tickets: 5, Force: true',
        ticketId: 'project-123',
        inputData: {
          projectId: 'project-123',
          projectName: 'Test Project',
          activeTickets: 5,
          force: true,
        },
        outputData: {
          deleted: true,
          projectId: 'project-123',
          deletedAt: expect.any(String),
        },
        confidence: 1.0,
      });
    });

    // Fix: Issue #2 - Test audit log failure handling
    it('should complete deletion even when audit logging fails', async () => {
      repository.findById.mockResolvedValue(mockProject);
      repository.countActiveTickets.mockResolvedValue(0);
      repository.delete.mockResolvedValue(mockProject);
      // Simulate audit log failure
      mockAIDecisionLogger.logDecision.mockResolvedValueOnce(null);

      const result = await service.deleteProject('project-123', false);

      // Deletion should still succeed
      expect(result).toEqual(mockProject);
      expect(repository.delete).toHaveBeenCalledWith('project-123');
      // But audit log was attempted
      expect(mockAIDecisionLogger.logDecision).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update project active status', async () => {
      const updatedProject = { ...mockProject, is_active: false };
      repository.findById.mockResolvedValue(mockProject);
      repository.updateStatus.mockResolvedValue(updatedProject);

      const result = await service.updateStatus('project-123', false);

      expect(result.is_active).toBe(false);
      expect(repository.updateStatus).toHaveBeenCalledWith('project-123', false);
      expect(mockCounter.inc).toHaveBeenCalledWith({
        operation: 'update_status',
        status: 'success',
      });
    });
  });

  describe('syncFromClickUp', () => {
    it('should sync project details and tasks from ClickUp', async () => {
      const clickUpList = { id: 'list-123', name: 'Updated Project Name' };
      const syncedProject = { ...mockProject, name: 'Updated Project Name' };

      repository.findById.mockResolvedValue(mockProject);
      mockClickUpService.getList.mockResolvedValue(clickUpList);
      mockClickUpService.getTasks.mockResolvedValue({ tasks: mockTasks });
      repository.update.mockResolvedValue(syncedProject);

      const result = await service.syncFromClickUp('project-123');

      expect(result.name).toBe('Updated Project Name');
      expect(result.syncedTasksCount).toBe(2);
      expect(mockClickUpService.getList).toHaveBeenCalledWith('list-123');
      expect(mockClickUpService.getTasks).toHaveBeenCalledWith({
        list_id: 'list-123',
        page: 0,
        limit: 50,
      });

      // Story 20.1: Verify tasks are published to RabbitMQ instead of direct DB upserts
      expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalledTimes(2);
      expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({
          externalId: 'task-1',
          title: 'Test Task 1',
          internalStatus: expect.any(String),
        }),
        expect.any(String),
      );

      expect(mockCounter.inc).toHaveBeenCalledWith({ operation: 'sync', status: 'success' });
    });

    it('should reject sync for non-ClickUp projects', async () => {
      const nonClickUpProject = {
        ...mockProject,
        provider: 'JIRA' as const,
        clickup_list_id: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      repository.findById.mockResolvedValue(nonClickUpProject);

      await expect(service.syncFromClickUp('project-123')).rejects.toThrow(
        'Project is not linked to ClickUp',
      );
      expect(mockClickUpService.getList).not.toHaveBeenCalled();
    });
  });
});
