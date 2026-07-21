import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { User } from '@/prisma/client';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReassignProjectDto } from './dto/reassign-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { ImportProjectResponseDto } from './dto/import-project-response.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';
import { UpdateGithubRepoDto } from './dto/update-github-repo.dto';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto';
import {
  SyncConfigResponseDto,
  toSyncConfigResponse,
  toPmIntegrationResponse,
} from './dto/sync-config-response.dto';
import { UpdateSyncConfigDto } from './dto/update-sync-config.dto';
import { UpdateQaStatusConfigDto } from './dto/update-qa-status-config.dto';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { PMProvider, Prisma } from '@prisma/client';
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

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class ProjectController {
  private readonly logger = new Logger(ProjectController.name);

  constructor(
    private readonly projectService: ProjectService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  /**
   * Trust boundary to the client: never expose the encrypted Lore key. Replace it
   * with a `lore_configured` boolean so the UI can show set/unset without ever
   * receiving the ciphertext.
   */
  private redactLoreSecret<T extends { lore_api_key?: string | null }>(project: T) {
    const { lore_api_key, ...rest } = project;
    return { ...rest, lore_configured: lore_api_key != null && lore_api_key !== '' };
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM) // Changed to use Role enum for consistency with existing code
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'The project has been successfully created.' })
  create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Import a project from a provider (e.g., ClickUp)' })
  @ApiResponse({
    status: 201,
    description: 'The project has been successfully imported.',
    type: ImportProjectResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden - connected account not owned by user' })
  @ApiResponse({ status: 404, description: 'Not Found - connected account or resource not found' })
  importProject(
    @Body() importDto: ImportProjectDto,
    @CurrentUser() user: User,
  ): Promise<ImportProjectResponseDto> {
    if (!user || !user.id) {
      throw new BadRequestException('User context required for import');
    }
    return this.projectService.importProject(importDto, user.id);
  }

  @Get('my-projects')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get projects assigned to current user' })
  @ApiResponse({ status: 200, description: 'Return user projects' })
  findUserProjects(@CurrentUser() user: User) {
    if (!user || !user.id) {
      throw new BadRequestException('User context required');
    }
    return this.projectService
      .findUserProjects(user.id)
      .then((projects) => projects.map((p) => this.redactLoreSecret(p)));
  }

  @Get()
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'List all projects' })
  @ApiQuery({
    name: 'active',
    required: false,
    enum: ['true', 'false', 'all'],
    description:
      'Filter by active status (true=active only, false=inactive only, all=all projects)',
  })
  @ApiResponse({ status: 200, description: 'Return all projects' })
  findAll(@Query('active') active?: string) {
    let activeFilter: boolean | undefined;
    if (active === 'true') activeFilter = true;
    else if (active === 'false') activeFilter = false;
    // If 'all' or undefined, activeFilter remains undefined (fetch all)
    return this.projectService
      .findAll(activeFilter)
      .then((projects) => projects.map((p) => this.redactLoreSecret(p)));
  }

  @Get(':id')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get project details' })
  @ApiResponse({ status: 200, description: 'Return project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id') id: string) {
    return this.projectService.findOne(id).then((p) => this.redactLoreSecret(p));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update project details' })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  update(@Param('id') id: string, @Body() updateProjectDto: UpdateProjectDto) {
    return this.projectService.update(id, updateProjectDto).then((p) => this.redactLoreSecret(p));
  }

  @Post(':id/reassign')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: 'Reassign project to a different PM',
    description: 'Managers can reassign projects to balance team capacity. AC#5 for Story 5.4.',
  })
  @ApiParam({
    name: 'id',
    description: 'Project ID to reassign',
    example: 'proj-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Project reassigned successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Project or PM not found',
  })
  async reassign(@Param('id') id: string, @Body() reassignDto: ReassignProjectDto) {
    this.logger.log(
      `Reassigning project ${id} to PM ${reassignDto.new_pm_id}. Reason: ${reassignDto.reason || 'Not specified'}`,
    );
    return this.projectService.reassign(id, reassignDto);
  }

  @Patch(':id/repository')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update GitHub repository for project' })
  @ApiResponse({ status: 200, description: 'Repository updated successfully' })
  updateRepository(@Param('id') id: string, @Body() dto: UpdateRepositoryDto) {
    return this.projectService.updateGitHubRepository(id, dto.repositoryUrl);
  }

  @Patch(':id/github-repo')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Set GitHub account and repository for project' })
  @ApiResponse({ status: 200, description: 'Repository updated successfully' })
  updateGithubRepo(
    @Param('id') id: string,
    @Body() dto: UpdateGithubRepoDto,
    @CurrentUser() user: User,
  ) {
    return this.projectService.updateGithubRepo(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update project active status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto) {
    // Accept either `isActive` (boolean) or `status` ("active"|"inactive")
    if (dto.isActive === undefined && dto.status === undefined) {
      throw new BadRequestException(
        'Provide either "isActive" (boolean) or "status" ("active"|"inactive")',
      );
    }
    const resolvedIsActive = dto.isActive ?? dto.status === 'active';
    return this.projectService.updateStatus(id, resolvedIsActive);
  }

  @Patch(':id/qa-status-config')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Update per-project QA failure and manual review ClickUp status names' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'QA status configuration updated successfully' })
  @ApiResponse({ status: 400, description: 'Empty string not accepted — use null to clear' })
  @ApiResponse({ status: 422, description: 'qaMaxRetries out of range — must be 1–10' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  updateQaStatusConfig(@Param('id') id: string, @Body() dto: UpdateQaStatusConfigDto) {
    return this.projectService.updateQaStatusConfig(id, dto);
  }

  @Post(':id/sync')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Sync project details from ClickUp' })
  @ApiResponse({ status: 200, description: 'Project synced successfully' })
  syncClickUp(@Param('id') id: string) {
    return this.projectService.syncFromClickUp(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiQuery({
    name: 'force',
    required: false,
    type: Boolean,
    description: 'Force delete even if active tickets exist',
  })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete active project (unless force=true)',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  remove(@Param('id') id: string, @Query('force') force?: boolean) {
    // Handle string 'true' from query param
    const forceDelete = force === true || String(force) === 'true';
    return this.projectService.deleteProject(id, forceDelete);
  }

  @Get(':id/integrations')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'List project integrations' })
  @ApiResponse({ status: 200, type: [SyncConfigResponseDto] })
  async getIntegrations(@Param('id') id: string) {
    const integrations = await this.integrationService.findByProjectId(id);
    return integrations.map((i) => toPmIntegrationResponse(i));
  }

  @Get(':id/integration/sync-config')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get CLICKUP integration sync configuration' })
  @ApiResponse({ status: 200, type: SyncConfigResponseDto })
  @ApiResponse({ status: 404, description: 'No CLICKUP integration found' })
  async getSyncConfig(@Param('id') id: string) {
    const integration = await this.integrationService.findByProjectAndProvider(
      id,
      PMProvider.CLICKUP,
    );

    if (!integration) {
      throw new NotFoundException(`No CLICKUP integration found for project ${id}`);
    }

    return toSyncConfigResponse(integration);
  }

  @Patch(':id/integration/sync-config')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Update ai_trigger_status and/or container_id for CLICKUP integration' })
  @ApiResponse({ status: 200, type: SyncConfigResponseDto })
  @ApiResponse({ status: 404, description: 'No CLICKUP integration found' })
  async updateSyncConfig(@Param('id') id: string, @Body() dto: UpdateSyncConfigDto) {
    const integration = await this.integrationService.findByProjectAndProvider(
      id,
      PMProvider.CLICKUP,
    );

    if (!integration) {
      throw new NotFoundException(`No CLICKUP integration found for project ${id}`);
    }

    const updatePayload: Prisma.ProjectIntegrationUncheckedUpdateInput = {};

    if (dto.ai_trigger_status !== undefined) {
      updatePayload.ai_trigger_status = dto.ai_trigger_status;
    }

    if (dto.container_id !== undefined) {
      const existingCfg = (integration.provider_config as Record<string, unknown>) ?? {};
      updatePayload.provider_config = {
        ...existingCfg,
        containerId: dto.container_id,
      } as Prisma.InputJsonValue;
    }

    const updated = await this.integrationService.updateIntegration(integration.id, updatePayload);

    return toSyncConfigResponse(updated);
  }
}
