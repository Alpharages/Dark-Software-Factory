import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { ProjectRepository } from './project.repository';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ConfigService } from '@nestjs/config';
import { PMProvider } from '@/prisma/enums';
import { ConnectedAppsService } from '@/connected-apps/connected-apps.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { ClickUpProvider } from '@/integrations/providers/clickup/clickup.provider';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';

jest.mock('@/integrations/providers/clickup/clickup.provider');

describe('ProjectService', () => {
  let service: ProjectService;
  let repository: jest.Mocked<ProjectRepository>;

  const mockProject = {
    id: 'project-123',
    name: 'Test Project',
    clickup_list_id: 'list-123',
    github_account_id: null,
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
    qa_failure_status: null,
    manual_review_status: null,
    code_review_status: null,
    qa_max_retries: 3,
    max_execution_retries: 3,
  };

  const mockCounter = {
    inc: jest.fn(),
  };

  // Define mockPrisma first as a partial object to avoid self-reference error
  const mockPrismaTx = {
    project: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    gitHubAccount: {
      findUnique: jest.fn(),
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
    projectIntegration: {
      create: jest.fn(),
    },
    connectedApp: {
      findUnique: jest.fn(),
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

  const mockConnectedAppsService = {
    getDecrypted: jest.fn(),
  };

  const mockProjectIntegrationService = {
    findByProjectAndProvider: jest.fn(),
  };

  const mockEncryptionService = {
    encrypt: jest.fn((text) => `enc-${text}`),
    decrypt: jest.fn((hash) => hash.replace('enc-', '')),
  };

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
            updateGithubRepo: jest.fn(),
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
        {
          provide: ConnectedAppsService,
          useValue: mockConnectedAppsService,
        },
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
        {
          provide: ProjectIntegrationService,
          useValue: mockProjectIntegrationService,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    repository = module.get(ProjectRepository);
    jest.clearAllMocks();

    // Reset ClickUpProvider mock — each test configures getList as needed
    (ClickUpProvider as jest.Mock).mockClear();
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
        name: 'Test Project',
        clickup_list_id: 'list-123',
        github_repository_url: 'https://github.com/test/repo',
        default_branch: 'main',
        pm_id: 'pm-123',
        status: 'active',
        client_name: 'Test Client',
      });
      expect(mockCounter.inc).toHaveBeenCalledWith({ operation: 'create', status: 'success' });
    });

    it('should create a project without github_repository_url (the optional path)', async () => {
      const mockProjectNoGithub = { ...mockProject, github_repository_url: '' };
      repository.create.mockResolvedValue(mockProjectNoGithub);
      const dto = {
        name: 'No-Repo Project',
        clickup_list_id: 'list-456',
        pm_id: 'pm-123',
        client_name: 'Acme Corp',
        // github_repository_url intentionally omitted
      };

      const result = await service.create(dto);

      expect(result).toEqual(mockProjectNoGithub);
      expect(repository.create).toHaveBeenCalledWith({
        name: 'No-Repo Project',
        clickup_list_id: 'list-456',
        github_repository_url: '', // undefined?.trim() || '' → ''
        default_branch: 'main',
        pm_id: 'pm-123',
        status: 'active',
        client_name: 'Acme Corp',
      });
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

  describe('updateGithubRepo', () => {
    it('should update github account and repository url successfully', async () => {
      const updatedProject = {
        ...mockProject,
        github_account_id: 'acc-123',
        github_repository_url: 'https://github.com/test/repo',
      };
      const dto = { githubAccountId: 'acc-123', repositoryFullName: 'test/repo' };

      repository.findById.mockResolvedValue(mockProject);
      mockPrisma.gitHubAccount.findUnique.mockResolvedValue({
        id: 'acc-123',
        userId: 'user-1',
      } as unknown as any);
      repository.updateGithubRepo.mockResolvedValue(updatedProject);

      const result = await service.updateGithubRepo('project-123', dto, 'user-1');

      expect(result.github_account_id).toBe('acc-123');
      expect(repository.updateGithubRepo).toHaveBeenCalledWith(
        'project-123',
        'acc-123',
        'https://github.com/test/repo',
      );
      expect(mockCounter.inc).toHaveBeenCalledWith({
        operation: 'update_github_repo',
        status: 'success',
      });
    });

    it('should throw ForbiddenException if account does not belong to user', async () => {
      const dto = { githubAccountId: 'acc-123', repositoryFullName: 'test/repo' };

      repository.findById.mockResolvedValue(mockProject);
      mockPrisma.gitHubAccount.findUnique.mockResolvedValue({
        id: 'acc-123',
        userId: 'other-user',
      } as unknown as any);

      await expect(service.updateGithubRepo('project-123', dto, 'user-1')).rejects.toThrow(
        'Not your GitHub account',
      );
      expect(repository.updateGithubRepo).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException if account not found', async () => {
      const dto = { githubAccountId: 'acc-invalid', repositoryFullName: 'test/repo' };

      repository.findById.mockResolvedValue(mockProject);
      mockPrisma.gitHubAccount.findUnique.mockResolvedValue(null);

      await expect(service.updateGithubRepo('project-123', dto, 'user-1')).rejects.toThrow(
        'Not your GitHub account',
      );
      expect(repository.updateGithubRepo).not.toHaveBeenCalled();
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

  describe('updateQaStatusConfig', () => {
    it('should update QA status configuration fields', async () => {
      const updatedProject = {
        ...mockProject,
        qa_failure_status: 'QA Failed',
        manual_review_status: 'Needs PM',
        code_review_status: 'Code Review',
      };
      const dto = {
        qa_failure_status: 'QA Failed',
        manual_review_status: 'Needs PM',
        code_review_status: 'Code Review',
      };

      repository.findById.mockResolvedValue(mockProject);
      repository.update.mockResolvedValue(updatedProject as any);

      const result = await service.updateQaStatusConfig('project-123', dto);

      expect((result as any).qa_failure_status).toBe('QA Failed');
      expect((result as any).manual_review_status).toBe('Needs PM');
      expect((result as any).code_review_status).toBe('Code Review');
      expect(repository.update).toHaveBeenCalledWith('project-123', {
        qa_failure_status: 'QA Failed',
        manual_review_status: 'Needs PM',
        code_review_status: 'Code Review',
      });
    });

    it('should throw NotFoundException if project not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateQaStatusConfig('project-123', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should return existing record without calling repository.update when no fields provided', async () => {
      repository.findById.mockResolvedValue(mockProject);

      const result = await service.updateQaStatusConfig('project-123', {});

      expect(result).toEqual(mockProject);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should update qaMaxRetries when provided in valid range (WR-5.1)', async () => {
      const updatedProject = {
        ...mockProject,
        qa_max_retries: 5,
      };
      const dto = { qaMaxRetries: 5 };

      repository.findById.mockResolvedValue(mockProject);
      repository.update.mockResolvedValue(updatedProject as any);

      const result = await service.updateQaStatusConfig('project-123', dto);

      expect((result as any).qa_max_retries).toBe(5);
      expect(repository.update).toHaveBeenCalledWith('project-123', {
        qa_max_retries: 5,
      });
    });

    it('should throw UnprocessableEntityException when qaMaxRetries is out of range (WR-5.1)', async () => {
      repository.findById.mockResolvedValue(mockProject);

      await expect(
        service.updateQaStatusConfig('project-123', { qaMaxRetries: 0 }),
      ).rejects.toThrow(UnprocessableEntityException);

      await expect(
        service.updateQaStatusConfig('project-123', { qaMaxRetries: 11 }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('syncFromClickUp', () => {
    const mockGetList = jest.fn();
    const mockGetTasksFromList = jest.fn();

    beforeEach(() => {
      mockGetList.mockResolvedValue({ id: 'list-123', name: 'Updated Project Name' });
      mockGetTasksFromList.mockResolvedValue({ tasks: mockTasks });
      (ClickUpProvider as jest.Mock).mockImplementation(() => ({
        getList: mockGetList,
        getTasksFromList: mockGetTasksFromList,
      }));
      mockProjectIntegrationService.findByProjectAndProvider.mockResolvedValue({
        access_token: 'token-abc',
      });
    });

    it('should sync project details and tasks from ClickUp', async () => {
      const syncedProject = { ...mockProject, name: 'Updated Project Name' };

      repository.findById.mockResolvedValue(mockProject);
      repository.update.mockResolvedValue(syncedProject);

      const result = await service.syncFromClickUp('project-123');

      expect(result.name).toBe('Updated Project Name');
      // CS1-1 fix: inline check allows QUEUED tasks through sync path (all tasks map to QUEUED)
      expect(result.syncedTasksCount).toBe(2);
      expect(ClickUpProvider).toHaveBeenCalledWith('token-abc');
      expect(mockGetList).toHaveBeenCalledWith('list-123');
      expect(mockGetTasksFromList).toHaveBeenCalledWith('list-123', 0, 50);

      // Both tasks are QUEUED (actionable) — published to intake queue
      expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalledTimes(2);

      expect(mockCounter.inc).toHaveBeenCalledWith({ operation: 'sync', status: 'success' });
    });

    it('should throw BadRequestException when no integration found', async () => {
      repository.findById.mockResolvedValue(mockProject);
      mockProjectIntegrationService.findByProjectAndProvider.mockResolvedValue(null);

      await expect(service.syncFromClickUp('project-123')).rejects.toThrow(BadRequestException);
    });

    it('should reject sync for non-ClickUp projects', async () => {
      const nonClickUpProject = {
        ...mockProject,
        provider: 'JIRA' as const,
        clickup_list_id: null,
      } as any;
      repository.findById.mockResolvedValue(nonClickUpProject);

      await expect(service.syncFromClickUp('project-123')).rejects.toThrow(
        'Project is not linked to ClickUp',
      );
    });
  });

  describe('importProject', () => {
    const TEST_ACCOUNT_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('T2: should throw BadRequestException when no accountId is provided', async () => {
      const dto = { provider: PMProvider.CLICKUP, resourceId: 'list-123' };
      await expect(service.importProject(dto, 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockConnectedAppsService.getDecrypted).not.toHaveBeenCalled();
      expect(mockPrismaTx.project.create).not.toHaveBeenCalled();
    });

    it('T1: should import project and auto-create integration when valid accountId is provided', async () => {
      const listDetails = { id: 'list-123', name: 'Imported List' };
      const decryptedModel = {
        id: 'app-123',
        user_id: 'user-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-456',
        workspace_name: 'Work',
        access_token: 'plain-token',
        refresh_token: 'plain-refresh',
        token_expiry: null,
        metadata: { botUserId: 'bot-123', botUsername: 'bot-name' },
      };

      const mockGetList = jest.fn().mockResolvedValue(listDetails);
      (ClickUpProvider as jest.Mock).mockImplementation(() => ({ getList: mockGetList }));
      mockConnectedAppsService.getDecrypted.mockResolvedValue(decryptedModel);
      mockPrismaTx.project.findFirst.mockResolvedValue(null);

      const createdProject = {
        ...mockProject,
        id: 'proj-new',
        name: 'Imported List',
        clickup_list_id: 'list-123',
      };
      mockPrismaTx.project.create.mockResolvedValue(createdProject);
      mockPrismaTx.projectIntegration.create.mockResolvedValue({ id: 'int-123' });

      const dto = {
        provider: PMProvider.CLICKUP,
        resourceId: 'list-123',
        accountId: TEST_ACCOUNT_UUID,
      };
      const result = await service.importProject(dto, 'user-1');

      expect(result.project).toEqual(createdProject);
      expect(result.integrationCreated).toBe(true);
      expect(mockConnectedAppsService.getDecrypted).toHaveBeenCalledWith(
        TEST_ACCOUNT_UUID,
        'user-1',
      );
      expect(mockPrismaTx.projectIntegration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          project_id: 'proj-new',
          workspace_id: 'ws-456',
          access_token: 'enc-plain-token',
          refresh_token: 'enc-plain-refresh',
          bot_user_id: 'bot-123',
          bot_username: 'bot-name',
          polling_enabled: false,
          webhook_enabled: false,
          provider_config: { containerId: 'list-123' },
          ai_trigger_status: null,
        }),
      });
    });

    it('T3: should propagate ForbiddenException when connected app belongs to another user', async () => {
      mockConnectedAppsService.getDecrypted.mockRejectedValue(
        new ForbiddenException('You do not have permission to access this connected app'),
      );
      const dto = {
        provider: PMProvider.CLICKUP,
        resourceId: 'list-123',
        accountId: TEST_ACCOUNT_UUID,
      };

      await expect(service.importProject(dto, 'user-1')).rejects.toThrow(ForbiddenException);
      expect(mockPrismaTx.project.create).not.toHaveBeenCalled();
    });

    it('T4: should propagate error and rollback when ProjectIntegration insert fails', async () => {
      const listDetails = { id: 'list-123', name: 'Imported List' };
      const decryptedModel = {
        id: 'app-123',
        user_id: 'user-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-456',
        workspace_name: 'Work',
        access_token: 'plain-token',
        refresh_token: null,
        token_expiry: null,
        metadata: null,
      };

      (ClickUpProvider as jest.Mock).mockImplementation(() => ({
        getList: jest.fn().mockResolvedValue(listDetails),
      }));
      mockConnectedAppsService.getDecrypted.mockResolvedValue(decryptedModel);
      mockPrismaTx.project.findFirst.mockResolvedValue(null);
      mockPrismaTx.project.create.mockResolvedValue({ ...mockProject, id: 'proj-new' });
      mockPrismaTx.projectIntegration.create.mockRejectedValue(new Error('DB insert failed'));

      const dto = {
        provider: PMProvider.CLICKUP,
        resourceId: 'list-123',
        accountId: TEST_ACCOUNT_UUID,
      };

      await expect(service.importProject(dto, 'user-1')).rejects.toThrow('DB insert failed');
      // Verify transaction was entered (project.create called) but integration insert caused the rollback
      expect(mockPrismaTx.project.create).toHaveBeenCalled();
      expect(mockPrismaTx.projectIntegration.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when connected app UUID is not found', async () => {
      mockConnectedAppsService.getDecrypted.mockRejectedValue(
        new NotFoundException('Connected app not found'),
      );
      const dto = {
        provider: PMProvider.CLICKUP,
        resourceId: 'list-123',
        accountId: TEST_ACCOUNT_UUID,
      };

      await expect(service.importProject(dto, 'user-1')).rejects.toThrow(NotFoundException);
      expect(mockPrismaTx.project.create).not.toHaveBeenCalled();
    });
  });
});
