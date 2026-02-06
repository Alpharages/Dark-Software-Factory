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
   * Find projects by User ID (PM)
   */
  async findByUserId(userId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { pm_id: userId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Find all projects with optional active status filter
   * @param activeFilter - true for active only, false for inactive only, undefined for all
   */
  async findAll(activeFilter?: boolean): Promise<Project[]> {
    const where: Prisma.ProjectWhereInput = {};
    if (activeFilter !== undefined) {
      where.is_active = activeFilter;
    }
    return this.prisma.project.findMany({
      where,
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

  /**
   * Update GitHub repository URL
   */
  async updateRepository(id: string, repositoryUrl: string): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id },
      data: { github_repository_url: repositoryUrl },
    });
    this.logger.log(`Updated repository for project ${id} to ${repositoryUrl}`);
    return project;
  }

  /**
   * Count active tickets for a project
   * Active = Not in terminal state (COMPLETED, FAILED, REJECTED)
   */
  async countActiveTickets(id: string): Promise<number> {
    return this.prisma.ticket.count({
      where: {
        project_id: id,
        status: {
          notIn: ['COMPLETED', 'FAILED', 'REJECTED'],
        },
      },
    });
  }

  /**
   * Update project active status
   */
  async updateStatus(id: string, isActive: boolean): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        is_active: isActive,
        deactivated_at: isActive ? null : new Date(),
      },
    });
    this.logger.log(`Updated project ${id} status to ${isActive ? 'active' : 'inactive'}`);
    return project;
  }
}
