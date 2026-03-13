import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { ClickUpService } from '@/clickup/clickup.service';
import { ProjectProvider } from '@/prisma/enums';
import { PMStatusService } from './pm-status.service';
import { ProjectIntegrationService } from './project-integration.service';
import { IntegrationProvider } from '@prisma/client';

import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;
  let clickUpService: ClickUpService;

  const mockClickUpService = {
    getHierarchy: jest.fn(),
  };

  const mockStatusService = {
    getStatuses: jest.fn(),
  };

  const mockIntegrationService = {
    getDecryptedIntegration: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        {
          provide: ClickUpService,
          useValue: mockClickUpService,
        },
        {
          provide: PMStatusService,
          useValue: mockStatusService,
        },
        {
          provide: ProjectIntegrationService,
          useValue: mockIntegrationService,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(controller.getHierarchy('JIRA' as any)).rejects.toThrow(
        'Provider "JIRA" not supported',
      );
    });
  });

  describe('getStatuses', () => {
    const integrationId = 'int-123';
    const containerId = 'list-123';
    const mockIntegration = { id: integrationId, provider: IntegrationProvider.CLICKUP };
    const mockStatuses = [{ id: '1', name: 'Open' }];

    it('should return statuses for a valid integration and containerId', async () => {
      mockIntegrationService.getDecryptedIntegration.mockResolvedValue(mockIntegration);
      mockStatusService.getStatuses.mockResolvedValue(mockStatuses);

      const result = await controller.getStatuses(integrationId, containerId);

      expect(result).toEqual(mockStatuses);
      expect(mockIntegrationService.getDecryptedIntegration).toHaveBeenCalledWith(integrationId);
      expect(mockStatusService.getStatuses).toHaveBeenCalledWith(mockIntegration, containerId);
    });

    it('should throw BadRequestException if containerId is missing', async () => {
      await expect(controller.getStatuses(integrationId, '')).rejects.toThrow(
        'containerId query parameter is required',
      );
    });

    it('should throw NotFoundException if integration is not found', async () => {
      mockIntegrationService.getDecryptedIntegration.mockResolvedValue(null);

      await expect(controller.getStatuses(integrationId, containerId)).rejects.toThrow(
        `Integration with ID "${integrationId}" not found`,
      );
    });
  });
});
