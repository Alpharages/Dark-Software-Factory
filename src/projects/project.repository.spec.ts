import { Test, TestingModule } from '@nestjs/testing';
import { ProjectRepository } from './project.repository';
import { PrismaService } from '../database/prisma.service';

describe('ProjectRepository', () => {
  let repository: ProjectRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      project: {
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<ProjectRepository>(ProjectRepository);
    prisma = module.get(PrismaService);

    // clear mocks
    jest.clearAllMocks();
  });

  describe('updateGithubRepo', () => {
    it('should update github_account_id and github_repository_url', async () => {
      const mockUpdatedProject = {
        id: 'project-1',
        github_account_id: 'acc-1',
        github_repository_url: 'https://github.com/owner/repo',
      };

      (prisma.project.update as jest.Mock).mockResolvedValue(mockUpdatedProject as unknown as any);

      const result = await repository.updateGithubRepo(
        'project-1',
        'acc-1',
        'https://github.com/owner/repo',
      );

      expect(prisma.project.update as jest.Mock).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: {
          github_account_id: 'acc-1',
          github_repository_url: 'https://github.com/owner/repo',
        },
      });
      expect(result).toEqual(mockUpdatedProject);
    });
  });
});
