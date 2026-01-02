import { Injectable, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
import { ClickUpService } from '@/clickup/clickup.service';
import { ProjectRepository } from './project.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReassignProjectDto } from './dto/reassign-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { Project } from '@/prisma/client';
import { ProjectProvider } from '@/prisma/enums';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repository: ProjectRepository,
    private readonly prisma: PrismaService,
    @InjectMetric('project_operations_total')
    private readonly operationsCounter: Counter<string>,
    @InjectMetric('project_lookups_total')
    private readonly lookupCounter: Counter<string>,
    @Inject(forwardRef(() => ClickUpService))
    private readonly clickupService: ClickUpService,
  ) {}

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    try {
      const project = await this.repository.create({
        name: createProjectDto.name,
        clickup_list_id: createProjectDto.clickup_list_id,
        github_repository_url: createProjectDto.github_repository_url,
        default_branch: createProjectDto.default_branch || 'main',
        pm_id: createProjectDto.pm_id,
        status: createProjectDto.status || 'active',
        client_name: createProjectDto.client_name,
      });
      this.operationsCounter.inc({ operation: 'create', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'create', status: 'error' });
      throw _error;
    }
  }

  async findAll(): Promise<Project[]> {
    return this.repository.findAll();
  }

  async findOne(id: string): Promise<Project> {
    this.lookupCounter.inc({ type: 'id' });
    const project = await this.repository.findById(id);
    if (!project) {
      this.lookupCounter.inc({ type: 'id', status: 'not_found' });
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }
    this.lookupCounter.inc({ type: 'id', status: 'success' });
    return project;
  }

  async findByListId(listId: string): Promise<Project | null> {
    this.lookupCounter.inc({ type: 'list_id' });
    const project = await this.repository.findByListId(listId);
    if (project) {
      this.lookupCounter.inc({ type: 'list_id', status: 'success' });
    } else {
      this.lookupCounter.inc({ type: 'list_id', status: 'not_found' });
    }
    return project;
  }

  async update(id: string, updateProjectDto: UpdateProjectDto): Promise<Project> {
    try {
      await this.findOne(id); // Ensure exists
      const project = await this.repository.update(id, updateProjectDto);
      this.operationsCounter.inc({ operation: 'update', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'update', status: 'error' });
      throw _error;
    }
  }

  /**
   * Reassign project to a different PM for workload balancing
   * AC#5: Managers can reassign projects to balance capacity
   * Uses transaction to ensure atomicity between project update and audit log
   */
  async reassign(id: string, reassignDto: ReassignProjectDto): Promise<Project> {
    try {
      // Use Prisma transaction to ensure atomicity
      return await this.prisma.$transaction(async (tx) => {
        // Verify project exists
        const project = await tx.project.findUnique({
          where: { id },
          select: { id: true, name: true, pm_id: true },
        });

        if (!project) {
          throw new NotFoundException(`Project with ID "${id}" not found`);
        }

        const oldPmId = project.pm_id;

        // Verify new PM exists and is actually a PM
        const newPm = await tx.user.findUnique({
          where: { id: reassignDto.new_pm_id },
          select: { id: true, name: true, email: true, role: true },
        });

        if (!newPm) {
          throw new NotFoundException(`PM with ID "${reassignDto.new_pm_id}" not found`);
        }

        if (newPm.role !== 'PM') {
          throw new NotFoundException(`User "${reassignDto.new_pm_id}" is not a PM`);
        }

        // Update project with new PM
        const updatedProject = await tx.project.update({
          where: { id },
          data: { pm_id: reassignDto.new_pm_id },
        });

        // Create audit log entry (within transaction)
        await tx.auditLog.create({
          data: {
            entity_type: 'project',
            entity_id: id,
            action: 'reassigned',
            actor_type: 'system', // TODO: Get actual user from request context
            actor_id: null,
            before_state: { pm_id: oldPmId },
            after_state: {
              pm_id: reassignDto.new_pm_id,
              reason: reassignDto.reason || 'Not specified',
            },
          },
        });

        this.logger.log(
          `Project "${project.name}" (${id}) reassigned from PM ${oldPmId} to PM ${newPm.name} (${reassignDto.new_pm_id}). Reason: ${reassignDto.reason || 'Not specified'}`,
        );

        this.operationsCounter.inc({ operation: 'reassign', status: 'success' });
        return updatedProject;
      });
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'reassign', status: 'error' });
      throw _error;
    }
  }

  /**
   * Import a project from an external provider
   * AC#3: Import API accepts provider and resourceId
   * Fetches list details from ClickUp and creates project record
   */
  async importProject(importDto: ImportProjectDto, userId: string): Promise<Project> {
    const { provider, resourceId } = importDto;

    // Validate provider (currently on ClickUp supported per AC#2)
    if (provider !== ProjectProvider.CLICKUP) {
      throw new Error(`Provider ${provider} import not yet supported`);
    }

    try {
      // 1. Fetch details from provider to validate and get name
      const listDetails = await this.clickupService.getList(resourceId);

      this.logger.log(`Importing ClickUp list: ${listDetails.name} (${listDetails.id})`);

      // 2. Create Project Record
      // Check if already exists first? repository.create might fail or we should check.
      const existing = await this.repository.findByListId(resourceId);
      if (existing) {
        throw new Error(`Project already imported for ClickUp List ${resourceId}`);
      }

      const project = await this.repository.create({
        name: listDetails.name, // Use list name as project name
        clickup_list_id: listDetails.id,
        github_repository_url: '', // Placeholder, user can update later? Or optional?
        default_branch: 'main',
        pm_id: userId,
        status: 'active',
        client_name: 'Internal', // Default
        provider: ProjectProvider.CLICKUP,
        monitor_tasks: true, // Auto-enable monitoring for imports
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      this.operationsCounter.inc({ operation: 'import', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'import', status: 'error' });
      const msg = _error instanceof Error ? _error.message : String(_error);
      this.logger.error(`Failed to import project: ${msg}`);
      throw _error;
    }
  }

  async remove(id: string): Promise<Project> {
    try {
      await this.findOne(id); // Ensure exists
      const project = await this.repository.delete(id);
      this.operationsCounter.inc({ operation: 'delete', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'delete', status: 'error' });
      throw _error;
    }
  }
}
