import {
  Injectable,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { ClickUpService } from '@/clickup/clickup.service';
import { ProjectRepository } from './project.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ReassignProjectDto } from './dto/reassign-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { Project, TicketStatus } from '@/prisma/client';
import { ProjectProvider } from '@/prisma/enums';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '@/database/prisma.service';
// Story 20.1: Provider-Agnostic Intake
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { mapClickUpToTaskEvent, isActionableStatus, TaskTriggerSource } from '@/ticket-intake/dto';
import { IRawTaskEvent } from '@/ticket-intake/interfaces/ticket-intake.interface';
// TODO: Uncomment when ai-decision-logging module is implemented (AC#2)
// import { AIDecisionLoggerService } from '@/ai-decision-logging/ai-decision-logger.service';

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
    @InjectMetric('project_deletion_total')
    private readonly deletionCounter: Counter<string>,
    @InjectMetric('project_sync_total')
    private readonly syncCounter: Counter<string>,
    @Inject(forwardRef(() => ClickUpService))
    private readonly clickupService: ClickUpService,
    // Story 20.1: Inject RabbitMQ for provider-agnostic event publishing
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    // TODO: Inject AIDecisionLoggerService when module is implemented (AC#2)
    // private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    try {
      const project = await this.repository.create({
        name: createProjectDto.name,
        clickup_list_id: createProjectDto.clickup_list_id,
        github_repository_url: createProjectDto.github_repository_url.trim(),
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

      // Log AI decision for deletion (AC#2)
      // TODO: Use AIDecisionLoggerService when module is implemented
      this.logger.log(
        `Project deletion decision - Operation: ${force ? 'force_delete' : 'safe_delete'}, ` +
          `Project: "${project.name}" (${id}), Active Tickets: ${activeTickets}, Force: ${force}`,
      );

      const deletedProject = await this.repository.delete(id);
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
   */
  async syncFromClickUp(id: string): Promise<Project & { syncedTasksCount: number }> {
    const project = await this.findOne(id);

    if (project.provider !== ProjectProvider.CLICKUP || !project.clickup_list_id) {
      throw new BadRequestException('Project is not linked to ClickUp');
    }

    try {
      // 1. Sync List Details
      const listDetails = await this.clickupService.getList(project.clickup_list_id);

      // Update name if changed
      const updated = await this.repository.update(id, {
        name: listDetails.name,
      });

      // 2. Sync Tasks - Story 20.1: Provider-agnostic flow
      const { tasks } = await this.clickupService.getTasks({
        list_id: project.clickup_list_id,
      });

      this.logger.log(`Syncing ${tasks.length} tasks for project ${id}`);

      let syncedCount = 0;
      let publishedCount = 0;

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

        const taskEvent = mapClickUpToTaskEvent(rawEvent as IRawTaskEvent, TaskTriggerSource.SYNC);

        // Story 20.1 (AC#1, AC#2): Only process AI-actionable tasks
        if (isActionableStatus(taskEvent.internalStatus)) {
          try {
            // Publish to ticket-intake-queue for processing
            await this.rabbitMQPublisher.publishToQueue(
              QUEUE_NAMES.TICKET_INTAKE,
              taskEvent,
              taskEvent.correlationId,
            );
            publishedCount++;
            this.logger.debug(
              `Published task ${task.id} to intake queue (status: ${taskEvent.internalStatus})`,
            );
          } catch (error) {
            const publishError = error as Error;
            this.logger.error(
              `Failed to publish task ${task.id} to queue: ${publishError.message}`,
              publishError.stack,
            );
            // Re-throw to inform the user that sync failed
            throw new Error(`Failed to publish task ${task.id} to queue: ${publishError.message}`);
          }
        } else {
          this.logger.debug(
            `Skipped non-actionable task ${task.id} (status: ${taskEvent.internalStatus})`,
          );
        }

        syncedCount++;
      }

      this.operationsCounter.inc({ operation: 'sync', status: 'success' });
      this.syncCounter.inc({ status: 'success' });

      this.logger.log(
        `Successfully synced project ${id}: ${syncedCount} tasks fetched, ${publishedCount} published to intake queue`,
      );

      return { ...updated, syncedTasksCount: publishedCount };
    } catch (_error) {
      this.operationsCounter.inc({ operation: 'sync', status: 'error' });
      this.syncCounter.inc({ status: 'error' });
      throw _error;
    }
  }

  private mapClickUpStatus(status: string): TicketStatus {
    const s = status.toLowerCase();
    switch (s) {
      case 'open':
      case 'to do':
      case 'todo':
        return TicketStatus.RECEIVED;
      case 'in progress':
      case 'doing':
        return TicketStatus.AI_PROCESSING;
      case 'review':
      case 'qa':
        return TicketStatus.QA_REVIEW;
      case 'complete':
      case 'completed':
      case 'done':
      case 'closed':
        return TicketStatus.COMPLETED;
      default:
        // Try to match exact enum key
        if (Object.values(TicketStatus).includes(status as TicketStatus)) {
          return status as TicketStatus;
        }
        return TicketStatus.RECEIVED;
    }
  }
}
