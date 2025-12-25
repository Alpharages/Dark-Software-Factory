import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ProjectRepository } from './project.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from '@/prisma/client';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repository: ProjectRepository,
    @InjectMetric('project_operations_total')
    private readonly operationsCounter: Counter<string>,
    @InjectMetric('project_lookups_total')
    private readonly lookupCounter: Counter<string>,
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
    } catch (error) {
      this.operationsCounter.inc({ operation: 'create', status: 'error' });
      throw error;
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
    } catch (error) {
      this.operationsCounter.inc({ operation: 'update', status: 'error' });
      throw error;
    }
  }

  async remove(id: string): Promise<Project> {
    try {
      await this.findOne(id); // Ensure exists
      const project = await this.repository.delete(id);
      this.operationsCounter.inc({ operation: 'delete', status: 'success' });
      return project;
    } catch (error) {
      this.operationsCounter.inc({ operation: 'delete', status: 'error' });
      throw error;
    }
  }
}
