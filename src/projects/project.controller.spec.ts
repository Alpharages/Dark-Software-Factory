import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { UpdateSyncConfigDto } from './dto/update-sync-config.dto';
import { UpdateQaStatusConfigDto } from './dto/update-qa-status-config.dto';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '@/prisma/client';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: jest.Mocked<ProjectService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;

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
    created_at: new Date(),
    updated_at: new Date(),
    is_active: true,
    deactivated_at: null,
    qa_failure_status: null,
    manual_review_status: null,
    code_review_status: null,
    qa_max_retries: 3,
    max_execution_retries: 3,
    require_pr_approval: null,
    dependency_block_behavior: 'auto_resume' as const,
  };

  const mockIntegration = {
    id: 'int-123',
    project_id: 'project-123',
    provider: 'CLICKUP',
    workspace_id: 'ws-123',
    workspace_name: 'Test Workspace',
    bot_user_id: 'bot-1',
    bot_username: 'dsf-bot',
    ai_trigger_status: 'In Review',
    polling_enabled: true,
    polling_interval_min: 15,
    polling_last_run_at: null,
    webhook_enabled: true,
    webhook_id: 'wh-123',
    webhook_secret: null,
    access_token: null,
    refresh_token: null,
    token_expiry: null,
    provider_config: { workspaceId: 'ws-123' },
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        {
          provide: ProjectService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            importProject: jest.fn(),
            reassign: jest.fn(),
            updateGitHubRepository: jest.fn(),
            updateStatus: jest.fn(),
            updateQaStatusConfig: jest.fn(),
            syncFromClickUp: jest.fn(),
            deleteProject: jest.fn(),
            updateGithubRepo: jest.fn(),
          },
        },
        {
          provide: ProjectIntegrationService,
          useValue: {
            findByProjectId: jest.fn(),
            findByProjectAndProvider: jest.fn(),
            updateIntegration: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProjectController>(ProjectController);
    service = module.get(ProjectService);
    integrationService = module.get(ProjectIntegrationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a project', async () => {
      const dto = {
        name: 'Test Project',
        clickup_list_id: 'list-123',
        github_repository_url: 'https://github.com/test/repo',
        pm_id: 'pm-123',
        client_name: 'Test Client',
      };
      service.create.mockResolvedValue(mockProject);

      const result = await controller.create(dto);

      expect(result).toEqual(mockProject);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('should require ADMIN, MANAGER, and PM roles (AC3)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, ProjectController.prototype.create);
      expect(roles).toContain(Role.ADMIN);
      expect(roles).toContain(Role.MANAGER);
      expect(roles).toContain(Role.PM);
    });
  });

  describe('findAll', () => {
    it('should return all projects', async () => {
      service.findAll.mockResolvedValue([mockProject]);

      const result = await controller.findAll();

      expect(result).toEqual([mockProject]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return one project', async () => {
      service.findOne.mockResolvedValue(mockProject);

      const result = await controller.findOne('project-123');

      expect(result).toEqual(mockProject);
      expect(service.findOne).toHaveBeenCalledWith('project-123');
    });
  });

  describe('updateRepository', () => {
    it('should update repository url', async () => {
      service.updateGitHubRepository.mockResolvedValue(mockProject);
      const dto = { repositoryUrl: 'https://github.com/owner/new-repo' };
      const result = await controller.updateRepository('project-123', dto);
      expect(result).toEqual(mockProject);
      expect(service.updateGitHubRepository).toHaveBeenCalledWith('project-123', dto.repositoryUrl);
    });
  });

  describe('updateGithubRepo', () => {
    it('should update github account and repository url', async () => {
      service.updateGithubRepo.mockResolvedValue(mockProject);
      const dto = { githubAccountId: 'acc-123', repositoryFullName: 'test/repo' };
      const reqUser = { id: 'pm-123' } as unknown as any;

      const result = await controller.updateGithubRepo('project-123', dto, reqUser);

      expect(result).toEqual(mockProject);
      expect(service.updateGithubRepo).toHaveBeenCalledWith('project-123', dto, 'pm-123');
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      service.updateStatus.mockResolvedValue(mockProject);
      const dto = { isActive: false };
      const result = await controller.updateStatus('project-123', dto);
      expect(result).toEqual(mockProject);
      expect(service.updateStatus).toHaveBeenCalledWith('project-123', false);
    });
  });

  describe('syncClickUp', () => {
    it('should sync project', async () => {
      const mockResult = { ...mockProject, syncedTasksCount: 5 };
      service.syncFromClickUp.mockResolvedValue(mockResult);
      const result = await controller.syncClickUp('project-123');
      expect(result).toEqual(mockResult);
      expect(service.syncFromClickUp).toHaveBeenCalledWith('project-123');
    });
  });

  describe('remove', () => {
    it('should delete project without force', async () => {
      service.deleteProject.mockResolvedValue(mockProject);
      await controller.remove('project-123');
      expect(service.deleteProject).toHaveBeenCalledWith('project-123', false);
    });

    it('should delete project with force=true', async () => {
      service.deleteProject.mockResolvedValue(mockProject);
      await controller.remove('project-123', true);
      expect(service.deleteProject).toHaveBeenCalledWith('project-123', true);
    });
  });

  describe('getIntegrations', () => {
    it('should return all integrations for a project', async () => {
      integrationService.findByProjectId.mockResolvedValue([mockIntegration as any]);
      const result = await controller.getIntegrations('project-123');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockIntegration.id);
      expect(integrationService.findByProjectId).toHaveBeenCalledWith('project-123');
    });

    it('should return empty array when no integrations found', async () => {
      integrationService.findByProjectId.mockResolvedValue([]);
      const result = await controller.getIntegrations('project-123');
      expect(result).toEqual([]);
    });
  });

  describe('getSyncConfig', () => {
    it('should return CLICKUP sync config', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(mockIntegration as any);
      const result = await controller.getSyncConfig('project-123');
      expect(result.ai_trigger_status).toBe('In Review');
    });

    it('should throw NotFoundException if no CLICKUP integration found', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(null);
      await expect(controller.getSyncConfig('project-123')).rejects.toThrow(
        'No CLICKUP integration found',
      );
    });
  });

  describe('updateSyncConfig', () => {
    it('should update ai_trigger_status', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(mockIntegration as any);

      integrationService.updateIntegration.mockResolvedValue({
        ...mockIntegration,
        ai_trigger_status: 'Ready',
      } as any);

      const result = await controller.updateSyncConfig('project-123', {
        ai_trigger_status: 'Ready',
      });
      expect(result.ai_trigger_status).toBe('Ready');
      expect(integrationService.updateIntegration).toHaveBeenCalledWith(mockIntegration.id, {
        ai_trigger_status: 'Ready',
      });
    });

    it('should clear ai_trigger_status when null is passed', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(mockIntegration as any);
      integrationService.updateIntegration.mockResolvedValue({
        ...mockIntegration,
        ai_trigger_status: null,
      } as any);

      const result = await controller.updateSyncConfig('project-123', { ai_trigger_status: null });
      expect(result.ai_trigger_status).toBeNull();
    });

    it('should reject empty ai_trigger_status string with a validation error', async () => {
      const dto = plainToInstance(UpdateSyncConfigDto, { ai_trigger_status: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'ai_trigger_status')).toBe(true);
    });

    it('should merge container_id into provider_config', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(mockIntegration as any);
      integrationService.updateIntegration.mockResolvedValue({
        ...mockIntegration,
        provider_config: { workspaceId: 'ws-123', containerId: 'list-456' },
      } as any);

      const result = await controller.updateSyncConfig('project-123', {
        container_id: 'list-456',
      });

      expect(result.container_id).toBe('list-456');
      expect(integrationService.updateIntegration).toHaveBeenCalledWith(
        mockIntegration.id,
        expect.objectContaining({
          provider_config: { workspaceId: 'ws-123', containerId: 'list-456' },
        }),
      );
    });

    it('should not touch provider_config when container_id is undefined', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(mockIntegration as any);

      integrationService.updateIntegration.mockResolvedValue(mockIntegration as any);

      await controller.updateSyncConfig('project-123', {
        ai_trigger_status: 'Ready',
      });

      expect(integrationService.updateIntegration).toHaveBeenCalledWith(
        mockIntegration.id,
        expect.not.objectContaining({
          provider_config: expect.anything(),
        }),
      );
    });

    it('should reject empty container_id string with a validation error', async () => {
      const dto = plainToInstance(UpdateSyncConfigDto, { container_id: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'container_id')).toBe(true);
    });
  });

  describe('updateQaStatusConfig', () => {
    it('should update QA status configuration fields', async () => {
      const dto = {
        qa_failure_status: 'QA Failed',
        manual_review_status: 'Needs PM',
        code_review_status: 'Code Review',
      };
      service.updateQaStatusConfig.mockResolvedValue({
        ...mockProject,
        ...dto,
      } as any);

      const result = await controller.updateQaStatusConfig('project-123', dto);

      expect((result as any).qa_failure_status).toBe('QA Failed');
      expect((result as any).manual_review_status).toBe('Needs PM');
      expect((result as any).code_review_status).toBe('Code Review');
      expect(service.updateQaStatusConfig).toHaveBeenCalledWith('project-123', dto);
    });

    it('should validate empty strings as invalid', async () => {
      const dto = plainToInstance(UpdateQaStatusConfigDto, { qa_failure_status: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'qa_failure_status')).toBe(true);
    });

    it('should allow null to pass DTO validation (clears the field)', async () => {
      const dto = plainToInstance(UpdateQaStatusConfigDto, { qa_failure_status: null });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should allow clearing config with null', async () => {
      const dto = { qa_failure_status: null };
      service.updateQaStatusConfig.mockResolvedValue({
        ...mockProject,
        qa_failure_status: null,
      } as any);

      const result = await controller.updateQaStatusConfig('project-123', dto);

      expect((result as any).qa_failure_status).toBeNull();
      expect(service.updateQaStatusConfig).toHaveBeenCalledWith('project-123', dto);
    });

    it('should update qaMaxRetries when provided in valid range (WR-5.1)', async () => {
      const dto = { qaMaxRetries: 5 };
      service.updateQaStatusConfig.mockResolvedValue({
        ...mockProject,
        qa_max_retries: 5,
      } as any);

      const result = await controller.updateQaStatusConfig('project-123', dto);

      expect((result as any).qa_max_retries).toBe(5);
      expect(service.updateQaStatusConfig).toHaveBeenCalledWith('project-123', dto);
    });

    it('should propagate UnprocessableEntityException when service rejects out-of-range qaMaxRetries (WR-5.1)', async () => {
      service.updateQaStatusConfig.mockRejectedValue(
        new UnprocessableEntityException('qaMaxRetries must be between 1 and 10'),
      );

      await expect(
        controller.updateQaStatusConfig('project-123', { qaMaxRetries: 0 } as any),
      ).rejects.toThrow('qaMaxRetries must be between 1 and 10');
    });
  });
});
