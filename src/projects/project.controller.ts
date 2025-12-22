import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('api/v1/projects')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @Get()
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'List all projects' })
  @ApiResponse({ status: 200, description: 'Return all projects' })
  findAll() {
    return this.projectService.findAll();
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

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  remove(@Param('id') id: string) {
    return this.projectService.remove(id);
  }
}
