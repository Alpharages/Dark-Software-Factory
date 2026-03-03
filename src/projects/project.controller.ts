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
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { User } from '@/prisma/client';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReassignProjectDto } from './dto/reassign-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';
import { UpdateGithubRepoDto } from './dto/update-github-repo.dto';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto';
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

  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM) // Changed to use Role enum for consistency with existing code
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'The project has been successfully created.' })
  create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.MANAGER) // Changed to use Role enum for consistency with existing code
  @ApiOperation({ summary: 'Import a project from a provider (e.g., ClickUp)' })
  @ApiResponse({ status: 201, description: 'The project has been successfully imported.' })
  importProject(@Body() importDto: ImportProjectDto, @CurrentUser() user: User) {
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
    return this.projectService.findUserProjects(user.id);
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
    return this.projectService.findAll(activeFilter);
  }

  @Get(':id')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get project details' })
  @ApiResponse({ status: 200, description: 'Return project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id') id: string) {
    return this.projectService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update project details' })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  update(@Param('id') id: string, @Body() updateProjectDto: UpdateProjectDto) {
    return this.projectService.update(id, updateProjectDto);
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
}
