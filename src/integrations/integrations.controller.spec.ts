import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { ClickUpService } from '@/clickup/clickup.service';
import { PMStatusService } from './pm-status.service';
import { ProjectIntegrationService } from './project-integration.service';
import { UpdateSyncSettingsDto } from './dto/update-sync-settings.dto';
import { PMProvider, Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

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
    updateIntegration: jest.fn(),
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

      const result = await controller.getHierarchy(PMProvider.CLICKUP);

      expect(result).toEqual(mockHierarchy);
      expect(clickUpService.getHierarchy).toHaveBeenCalled();
    });

    it('should throw error for unsupported provider', async () => {
      await expect(controller.getHierarchy('JIRA' as any)).rejects.toThrow(
        'Provider "JIRA" not supported',
      );
    });
  });

  describe('getStatuses', () => {
    const integrationId = 'int-123';
    const containerId = 'list-123';
    const mockIntegration = { id: integrationId, provider: PMProvider.CLICKUP };
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

  describe('updateSyncSettings', () => {
    const validDto: UpdateSyncSettingsDto = {
      polling_enabled: true,
      polling_interval_min: 15,
      webhook_enabled: false,
    };

    const mockUpdatedIntegration = {
      id: 'int-123',
      provider: 'CLICKUP',
      ai_trigger_status: null,
      polling_enabled: true,
      polling_interval_min: 15,
      webhook_enabled: false,
      webhook_id: null,
    };

    it('should return updated SyncConfigResponseDto for valid data', async () => {
      mockIntegrationService.updateIntegration.mockResolvedValue(mockUpdatedIntegration);

      const result = await controller.updateSyncSettings('int-123', validDto);

      expect(result.polling_enabled).toBe(true);
      expect(result.polling_interval_min).toBe(15);
      expect(result.webhook_enabled).toBe(false);
      expect(mockIntegrationService.updateIntegration).toHaveBeenCalledWith('int-123', validDto);
    });

    it('should reject polling_interval_min: 0 with a validation error', async () => {
      const dto = plainToInstance(UpdateSyncSettingsDto, {
        polling_enabled: true,
        polling_interval_min: 0,
        webhook_enabled: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'polling_interval_min')).toBe(true);
    });

    it('should reject polling_interval_min: 1441 with a validation error', async () => {
      const dto = plainToInstance(UpdateSyncSettingsDto, {
        polling_enabled: true,
        polling_interval_min: 1441,
        webhook_enabled: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'polling_interval_min')).toBe(true);
    });

    it('should throw NotFoundException for unknown integration id (P2025)', async () => {
      const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
      mockIntegrationService.updateIntegration.mockRejectedValue(p2025);

      await expect(controller.updateSyncSettings('unknown-id', validDto)).rejects.toThrow(
        'Integration unknown-id not found',
      );
    });
  });
});
