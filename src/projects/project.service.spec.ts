import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { ProjectRepository } from './project.repository';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@/prisma/client';

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
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockCounter = {
    inc: jest.fn(),
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
          },
        },
        {
          provide: 'PROM_METRIC_PROJECT_OPERATIONS_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_PROJECT_LOOKUPS_TOTAL',
          useValue: mockCounter,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    repository = module.get(ProjectRepository);
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
});
