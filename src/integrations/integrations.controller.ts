import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Logger,
  Patch,
  Body,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ClickUpService } from '@/clickup/clickup.service';
import { PMStatusService } from './pm-status.service';
import { ProjectIntegrationService } from './project-integration.service';
import { UpdateSyncSettingsDto } from './dto/update-sync-settings.dto';
import {
  toSyncConfigResponse,
  SyncConfigResponseDto,
} from '@/projects/dto/sync-config-response.dto';

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly clickupService: ClickUpService,
    private readonly statusService: PMStatusService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  @Get(':id/statuses')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get live workflow statuses for a PM tool integration' })
  @ApiParam({ name: 'id', description: 'ProjectIntegration UUID' })
  @ApiQuery({
    name: 'containerId',
    required: true,
    description: 'List/board/project ID from the PM tool (for ClickUp: list ID)',
  })
  @ApiResponse({ status: 200, description: 'Array of workflow statuses (NormalizedStatus[])' })
  @ApiResponse({ status: 400, description: 'containerId query param is required' })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  async getStatuses(@Param('id') id: string, @Query('containerId') containerId?: string) {
    if (!containerId) {
      throw new BadRequestException('containerId query parameter is required');
    }

    const integration = await this.integrationService.getDecryptedIntegration(id);
    if (!integration) {
      throw new NotFoundException(`Integration with ID "${id}" not found`);
    }

    return this.statusService.getStatuses(integration, containerId);
  }

  @Get(':provider/hierarchy')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: 'Get provider hierarchy',
    description:
      'Fetches hierarchy (Spaces > Lists) from the integration provider for discovery. Currently supports "clickup".',
  })
  @ApiParam({
    name: 'provider',
    description: 'Integration provider name (case-insensitive)',
    example: 'clickup',
    enum: ['clickup'],
  })
  @ApiQuery({
    name: 'teamId',
    required: false,
    description:
      'ClickUp Team (Organization) ID to filter results. If omitted, returns all accessible organizations.',
    type: String,
  })
  @ApiResponse({ status: 200, description: 'Return hierarchy structure' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getHierarchy(@Param('provider') provider: string, @Query('teamId') teamId?: string) {
    const providerKey = provider.toLowerCase();

    if (providerKey === 'clickup') {
      return this.clickupService.getHierarchy({ teamId });
    }

    throw new NotFoundException(`Provider "${provider}" not supported`);
  }

  @Patch(':id/sync-settings')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Update polling and webhook settings for an integration' })
  @ApiParam({ name: 'id', description: 'ProjectIntegration UUID' })
  @ApiResponse({ status: 200, type: SyncConfigResponseDto })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  async updateSyncSettings(@Param('id') id: string, @Body() dto: UpdateSyncSettingsDto) {
    try {
      const updated = await this.integrationService.updateIntegration(id, dto);
      return toSyncConfigResponse(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Integration ${id} not found`);
      }
      throw error;
    }
  }
}
