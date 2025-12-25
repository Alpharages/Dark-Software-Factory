import { Test, TestingModule } from '@nestjs/testing';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '@/prisma/client';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: jest.Mocked<ProjectService>;

  const mockProject = {
    id: 'project-123',
    name: 'Test Project',
    clickup_list_id: 'list-123',
    github_repository_url: 'https://github.com/test/repo',
    default_branch: 'main',
    pm_id: 'pm-123',
    status: 'active',
    client_name: 'Test Client',
    budget_usd: new Prisma.Decimal(100.0),
    created_at: new Date(),
    updated_at: new Date(),
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
});
