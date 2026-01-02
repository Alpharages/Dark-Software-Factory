import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { ClickUpService } from '@/clickup/clickup.service';
import { ProjectProvider } from '@/prisma/enums';

import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;
  let clickUpService: ClickUpService;

  const mockClickUpService = {
    getHierarchy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        {
          provide: ClickUpService,
          useValue: mockClickUpService,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
    clickUpService = module.get<ClickUpService>(ClickUpService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHierarchy', () => {
    it('should return hierarchy for ClickUp provider', async () => {
      const mockHierarchy = {
        spaces: [
          {
            id: 'space1',
            name: 'Space 1',
            lists: [{ id: 'list1', name: 'List 1' }],
          },
        ],
      };
      mockClickUpService.getHierarchy.mockResolvedValue(mockHierarchy);

      const result = await controller.getHierarchy(ProjectProvider.CLICKUP);

      expect(result).toEqual(mockHierarchy);
      expect(clickUpService.getHierarchy).toHaveBeenCalled();
    });

    it('should throw error for unsupported provider', async () => {
      await expect(controller.getHierarchy('JIRA' as Record<string, unknown>)).rejects.toThrow(
        'Provider "JIRA" not supported',
      );
    });
  });
});
