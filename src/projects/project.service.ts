import {
  Injectable,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ClickUpService } from '@/clickup/clickup.service';
import { ProjectRepository } from './project.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReassignProjectDto } from './dto/reassign-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { UpdateGithubRepoDto } from './dto/update-github-repo.dto';
import { Project } from '@/prisma/client';
import { PMProvider } from '@/prisma/enums';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '@/database/prisma.service';
import { ConfigService } from '@nestjs/config';
// Story 20.1: Provider-Agnostic Intake
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { mapClickUpToTaskEvent, TaskTriggerSource, InternalTaskStatus } from '@/ticket-intake/dto';
import { IRawTaskEvent } from '@/ticket-intake/interfaces/ticket-intake.interface';
// Story 16-5: AI Decision Logging Module
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repository: ProjectRepository,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectMetric('project_operations_total')
    private readonly operationsCounter: Counter<string>,
    @InjectMetric('project_lookups_total')
    private readonly lookupCounter: Counter<string>,
    @InjectMetric('project_deletion_total')
    private readonly deletionCounter: Counter<string>,
    @InjectMetric('project_sync_total')
    private readonly syncCounter: Counter<string>,
    @Inject(forwardRef(() => ClickUpService))
    private readonly clickupService: ClickUpService,
    // Story 20.1: Inject RabbitMQ for provider-agnostic event publishing
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    // Story 16-5: Inject AIDecisionLoggerService for audit logging
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    try {
      const project = await this.repository.create({
        name: createProjectDto.name,
        clickup_list_id: createProjectDto.clickup_list_id,
        github_repository_url: createProjectDto.github_repository_url?.trim() || '',
        default_branch: createProjectDto.default_branch || 'main',
        pm_id: createProjectDto.pm_id,
        status: createProjectDto.status || 'active',
        client_name: createProjectDto.client_name,
        ...(createProjectDto.budget_usd !== undefined && {
          budget_usd: createProjectDto.budget_usd,
        }),
      });
      this.operationsCounter.inc({ operation: 'create', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'create', status: 'error' });
      throw _error;
    }
  }

  async findAll(activeFilter?: boolean): Promise<Project[]> {
    return this.repository.findAll(activeFilter);
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

  async findUserProjects(userId: string): Promise<Project[]> {
    return this.repository.findByUserId(userId);
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
          select: { id: true, full_name: true, email: true, role: true },
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
          `Project "${project.name}" (${id}) reassigned from PM ${oldPmId} to PM ${newPm.full_name} (${reassignDto.new_pm_id}). Reason: ${reassignDto.reason || 'Not specified'}`,
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
    if (provider !== PMProvider.CLICKUP) {
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
        throw new ConflictException(
          `A project has already been imported for ClickUp List ${resourceId}`,
        );
      }

      const project = await this.repository.create({
        name: listDetails.name, // Use list name as project name
        clickup_list_id: listDetails.id,
        github_repository_url: '', // Placeholder, user can update later? Or optional?
        default_branch: 'main',
        pm_id: userId,
        status: 'active',
        client_name: 'Internal', // Default
        provider: PMProvider.CLICKUP,
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
    // Deprecated in favor of deleteProject
    return this.deleteProject(id, false);
  }

  /**
   * Delete project with safety check
   * Checks for active tickets before deletion
   */
  async deleteProject(id: string, force = false): Promise<Project> {
    try {
      const project = await this.findOne(id); // Ensure exists
      const activeTickets = await this.repository.countActiveTickets(id);

      if (activeTickets > 0 && !force) {
        throw new BadRequestException(
          `Cannot delete project with ${activeTickets} active tickets. Use force=true to bypass.`,
        );
      }

      // Perform deletion FIRST, then log the successful outcome (Fix: Issue #1 - Lying Audit Log)
      const deletedProject = await this.repository.delete(id);

      // Story 16-5: Use AIDecisionLoggerService for structured audit logging
      // Log AFTER successful deletion to ensure audit accuracy
      const logResult = await this.aiDecisionLogger.logDecision({
        agentName: ProjectService.name,
        action: force ? 'project_force_delete' : 'project_safe_delete',
        reasoning:
          `Project deleted successfully. Project: "${project.name}" (${id}), ` +
          `Active Tickets: ${activeTickets}, Force: ${force}`,
        ticketId: id, // Using project ID as ticket ID for project-level operations (entity reference)
        inputData: {
          projectId: id,
          projectName: project.name,
          activeTickets,
          force,
        },
        outputData: {
          deleted: true,
          projectId: id,
          deletedAt: new Date().toISOString(),
        },
        confidence: 1.0, // Human-initiated action has 100% confidence
      });

      // Fix: Issue #2 - Alert on audit log failure (graceful degradation with monitoring)
      if (!logResult) {
        this.logger.error(
          `CRITICAL: Failed to create audit log for project deletion. ` +
            `Project: "${project.name}" (${id}) was deleted but audit trail is incomplete.`,
        );
        // Continue with operation - audit failure should not block business operation
        // But we log the error for ops team to investigate
      }
      this.operationsCounter.inc({ operation: 'delete', status: 'success' });
      this.deletionCounter.inc({ status: 'success', force: String(force) });
      return deletedProject;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'delete', status: 'error' });
      this.deletionCounter.inc({ status: 'error', force: String(force) });
      throw _error;
    }
  }

  /**
   * Update GitHub repository URL
   */
  async updateGitHubRepository(id: string, repositoryUrl: string): Promise<Project> {
    try {
      await this.findOne(id);
      const project = await this.repository.updateRepository(id, repositoryUrl.trim());
      this.operationsCounter.inc({ operation: 'update_repo', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'update_repo', status: 'error' });
      throw _error;
    }
  }

  /**
   * Update GitHub account and repository URL
   */
  async updateGithubRepo(id: string, dto: UpdateGithubRepoDto, userId: string): Promise<Project> {
    try {
      await this.findOne(id);

      // Verify that the GitHub account belongs to the user
      const account = await this.prisma.gitHubAccount.findUnique({
        where: { id: dto.githubAccountId },
      });

      if (!account || account.userId !== userId) {
        throw new ForbiddenException('Not your GitHub account');
      }

      const project = await this.repository.updateGithubRepo(
        id,
        dto.githubAccountId,
        `https://github.com/${dto.repositoryFullName}`,
      );
      this.operationsCounter.inc({ operation: 'update_github_repo', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'update_github_repo', status: 'error' });
      throw _error;
    }
  }

  /**
   * Update project active status
   */
  async updateStatus(id: string, isActive: boolean): Promise<Project> {
    try {
      await this.findOne(id);
      const project = await this.repository.updateStatus(id, isActive);
      this.operationsCounter.inc({ operation: 'update_status', status: 'success' });
      return project;
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'update_status', status: 'error' });
      throw _error;
    }
  }

  /**
   * Sync project details from ClickUp
   * Story 20.1: Now uses provider-agnostic flow - publishes ITaskEvent to queue
   *
   * Uses batch processing with pagination to prevent memory issues with large projects.
   * Batch size: 50 tasks, delay: 100ms between batches.
   */
  async syncFromClickUp(id: string): Promise<Project & { syncedTasksCount: number }> {
    const project = await this.findOne(id);

    if (project.provider !== PMProvider.CLICKUP || !project.clickup_list_id) {
      throw new BadRequestException('Project is not linked to ClickUp');
    }

    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 100;

    try {
      // 1. Sync List Details
      const listDetails = await this.clickupService.getList(project.clickup_list_id);

      // Update name if changed
      const updated = await this.repository.update(id, {
        name: listDetails.name,
      });

      // 2. Sync Tasks with pagination - Story 20.1: Provider-agnostic flow
      let page = 0;
      let hasMoreTasks = true;
      let totalSyncedCount = 0;
      let totalPublishedCount = 0;

      this.logger.log(`Starting sync for project ${id} with batch size ${BATCH_SIZE}`);

      while (hasMoreTasks) {
        // Fetch tasks in batches to prevent memory issues
        const { tasks } = await this.clickupService.getTasks({
          list_id: project.clickup_list_id,
          page,
          limit: BATCH_SIZE,
        });

        if (tasks.length === 0) {
          hasMoreTasks = false;
          break;
        }

        this.logger.log(`Processing batch ${page + 1}: ${tasks.length} tasks`);

        // Process this batch
        let batchPublishedCount = 0;
        for (const task of tasks) {
          // Story 20.1: Convert ClickUp API task to IRawTaskEvent, then map to ITaskEvent
          const correlationId = `sync-${project.id}-${task.id}-${Date.now()}`;

          const rawEvent: Partial<IRawTaskEvent> = {
            taskId: task.id,
            taskName: task.name,
            taskDescription: task.description || task.text_content || '',
            taskStatus: task.status?.status || 'to do',
            listId: project.clickup_list_id!,
            taskUrl: task.url || `https://app.clickup.com/t/${task.id}`,
            tags: task.tags?.map((t) => t.name) || [],
            customFields:
              task.custom_fields?.reduce(
                (acc, field) => {
                  acc[field.name] = field.value;
                  return acc;
                },
                {} as Record<string, unknown>,
              ) || {},
            creatorEmail: task.creator?.email || '',
            eventTimestamp: task.date_created || new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            correlationId,
            projectId: project.id,
            listName: listDetails.name,
            projectName: project.name,
            spaceId: task.space?.id || '',
            eventType: 'taskCreated',
            webhookEventId: '',
          };

          const taskEvent = mapClickUpToTaskEvent(
            rawEvent as IRawTaskEvent,
            TaskTriggerSource.SYNC,
          );

          // Story 20.1 (AC#1, AC#2): Only process AI-actionable tasks
          if (
            (['AI_PROCESSING', 'QUEUED', 'VALIDATED'] as InternalTaskStatus[]).includes(
              taskEvent.internalStatus,
            )
          ) {
            try {
              // Publish to ticket-intake-queue for processing
              await this.rabbitMQPublisher.publishToQueue(
                QUEUE_NAMES.TICKET_INTAKE,
                taskEvent,
                taskEvent.correlationId,
              );
              batchPublishedCount++;
              this.logger.debug(
                `Published task ${task.id} to intake queue (status: ${taskEvent.internalStatus})`,
              );
            } catch (error) {
              const publishError = error as Error;
              this.logger.error(
                `Failed to publish task ${task.id} to queue: ${publishError.message}`,
                publishError.stack,
              );
              // Continue with other tasks instead of failing entire sync
              this.logger.warn(`Continuing sync despite publish error for task ${task.id}`);
            }
          } else {
            this.logger.debug(
              `Skipped non-actionable task ${task.id} (status: ${taskEvent.internalStatus})`,
            );
          }

          totalSyncedCount++;
        }

        totalPublishedCount += batchPublishedCount;
        this.logger.log(
          `Batch ${page + 1} complete: ${batchPublishedCount}/${tasks.length} tasks published`,
        );

        // Check if we need to fetch more tasks
        if (tasks.length < BATCH_SIZE) {
          hasMoreTasks = false;
        } else {
          page++;
          // Small delay between batches to prevent overwhelming RabbitMQ
          if (BATCH_DELAY_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
      }

      this.operationsCounter.inc({ operation: 'sync', status: 'success' });
      this.syncCounter.inc({ status: 'success' });

      this.logger.log(
        `Successfully synced project ${id}: ${totalSyncedCount} tasks fetched, ${totalPublishedCount} published to intake queue`,
      );

      return { ...updated, syncedTasksCount: totalPublishedCount };
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'sync', status: 'error' });
      this.syncCounter.inc({ status: 'error' });
      throw _error;
    }
  }
}
