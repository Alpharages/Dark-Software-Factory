import { Injectable, Logger } from '@nestjs/common';
import { Project, Prisma } from '@/prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Project Repository
 *
 * Data access layer for project records using Prisma.
 */
@Injectable()
export class ProjectRepository {
  private readonly logger = new Logger(ProjectRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new project record
   */
  async create(data: Prisma.ProjectCreateInput): Promise<Project> {
    const project = await this.prisma.project.create({
      data,
    });
    this.logger.log(`Created project ${project.id} (${project.name})`);
    return project;
  }

  /**
   * Find project by ID
   */
  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { id },
    });
  }

  /**
   * Find project by ClickUp List ID
   */
  async findByListId(clickupListId: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { clickup_list_id: clickupListId },
    });
  }

  /**
   * Find all projects
   */
  async findAll(): Promise<Project[]> {
    return this.prisma.project.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Update project record
   */
  async update(id: string, data: Prisma.ProjectUpdateInput): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id },
      data,
    });
    this.logger.log(`Updated project ${id} (${project.name})`);
    return project;
  }

  /**
   * Delete project record
   */
  async delete(id: string): Promise<Project> {
    const project = await this.prisma.project.delete({
      where: { id },
    });
    this.logger.log(`Deleted project ${id} (${project.name})`);
    return project;
  }
}
