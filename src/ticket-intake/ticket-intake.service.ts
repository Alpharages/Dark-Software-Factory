import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { TicketStatus } from '@/prisma/client';
import { DispatcherService } from '@/dispatcher/dispatcher.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
// Story 4.9: Project Mapping
import { ProjectService } from '../projects/project.service';
// Story 20.1: Provider-Agnostic Intake
import { ITaskEvent, TaskTriggerSource, mapClickUpToTaskEvent } from './dto';
import { IRawTaskEvent, IParsedTicket, ITicketProcessingResult } from './interfaces';
import { ValidationResultDto, QualityScoreDto } from './dto';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
// Story 12.5: V3 Dependency Management
import { CircularDependencyDetectorService } from '../dependencies/circular-dependency-detector.service';
import { DependencyManagerService } from '../dependencies/dependency-manager.service';

// Metric names
const METRICS = {
  INTAKE_TOTAL: 'dsf_ticket_intake_total',
  INTAKE_DURATION: 'dsf_ticket_intake_duration_seconds',
  VALIDATION_TOTAL: 'dsf_ticket_validation_total',
  QUALITY_SCORE: 'dsf_ticket_quality_score',
  WAITING_DEPENDENCIES: 'dsf_ticket_waiting_dependencies_total',
  CIRCULAR_DEPENDENCIES: 'dsf_circular_dependencies_detected_total',
};

/**
 * Ticket Intake Service
 * FR57: Parse ticket details from ClickUp
 * FR58: Validate ticket quality
 *
 * Story 20.1: Provider-Agnostic Intake
 * AC#3: Now accepts ITaskEvent (provider-agnostic) for core processing
 *
 * Main orchestration service for processing incoming tickets:
 * 1. Parse task events (provider-agnostic via ITaskEvent)
 * 2. Validate ticket data quality
 * 3. Calculate quality scores
 * 4. Store in database
 * 5. Route validated tickets to AI processing
 */
@Injectable()
export class TicketIntakeService {
  private readonly logger = new Logger(TicketIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    private readonly validator: TicketValidatorService,
    private readonly qualityService: TicketQualityService,
    // Story 4.9: Project Mapping
    private readonly projectService: ProjectService,
    // Story 11.4: AI Decision Audit Logging
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    @InjectMetric(METRICS.INTAKE_TOTAL)
    private readonly intakeCounter: Counter<string>,
    @InjectMetric(METRICS.INTAKE_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(METRICS.VALIDATION_TOTAL)
    private readonly validationCounter: Counter<string>,
    @InjectMetric(METRICS.QUALITY_SCORE)
    private readonly qualityHistogram: Histogram<string>,
    // Story 12.5: V3 Services
    private readonly circularDetector: CircularDependencyDetectorService,
    private readonly dependencyManager: DependencyManagerService,
    @InjectMetric(METRICS.WAITING_DEPENDENCIES)
    private readonly waitingCounter: Counter<string>,
    @InjectMetric(METRICS.CIRCULAR_DEPENDENCIES)
    private readonly circularCounter: Counter<string>,
    private readonly dispatcher: DispatcherService,
  ) {}

  /**
   * Story 20.1: Backward-compatible adapter
   * Converts IRawTaskEvent (legacy ClickUp-specific) to ITaskEvent (provider-agnostic)
   * This maintains compatibility with existing webhook consumers during transition
   *
   * @deprecated Use processTaskEvent(ITaskEvent) directly for new code
   */
  async processTaskEvent(event: IRawTaskEvent): Promise<ITicketProcessingResult>;
  async processTaskEvent(event: ITaskEvent): Promise<ITicketProcessingResult>;
  async processTaskEvent(event: IRawTaskEvent | ITaskEvent): Promise<ITicketProcessingResult> {
    // AC#3: Detect if event is legacy IRawTaskEvent or new ITaskEvent
    const isLegacyEvent = 'taskId' in event && !('externalId' in event);

    let taskEvent: ITaskEvent;
    if (isLegacyEvent) {
      // Convert legacy IRawTaskEvent to ITaskEvent using mapper
      this.logger.debug(`[${event.correlationId}] Converting legacy IRawTaskEvent to ITaskEvent`);
      taskEvent = mapClickUpToTaskEvent(
        event as IRawTaskEvent,
        TaskTriggerSource.WEBHOOK, // Legacy events are assumed to be webhooks
      );
    } else {
      // Already an ITaskEvent
      taskEvent = event as ITaskEvent;
    }

    return this.processNormalizedTaskEvent(taskEvent);
  }

  /**
   * Story 20.1 AC#3: Core intake logic now uses provider-agnostic ITaskEvent
   * This method processes normalized events regardless of provider (ClickUp, Asana, Jira)
   */
  private async processNormalizedTaskEvent(event: ITaskEvent): Promise<ITicketProcessingResult> {
    const endTimer = this.durationHistogram.startTimer();
    const correlationId = event.correlationId;

    this.logger.log(
      `[${correlationId}] Processing task: ${event.externalId} (provider: ${event.providerType}, trigger: ${event.triggerSource})`,
    );
    this.intakeCounter.inc({ provider: event.providerType, trigger: event.triggerSource });

    try {
      // Story 20.1 AC#4: Idempotency check - prevent duplicate processing
      const existingExecution = await this.checkActiveExecution(event.externalId);
      if (existingExecution) {
        this.logger.debug(
          `[${correlationId}] Task ${event.externalId} is already being processed (execution ${existingExecution.id}), skipping duplicate`,
        );
        return {
          success: true,
          status: 'AI_PROCESSING',
          ticketId: existingExecution.ticket_id,
        };
      }

      // For taskUpdated: handle dependency re-triggering and re-validation
      // Note: We need to determine event type from trigger source or add eventType to ITaskEvent
      const existing = await this.prisma.ticket.findFirst({
        where: { clickup_task_id: event.externalId },
        select: { status: true },
      });

      if (existing) {
        // Re-trigger dependent tickets if this one is resolved
        if (this.dependencyManager.isStatusResolved(event.internalStatus)) {
          this.logger.log(
            `[${correlationId}] Task ${event.externalId} resolved (${event.internalStatus}), notifying dependents`,
          );
          await this.dependencyManager.notifyDependentTickets(event.externalId);
        }

        if (existing.status !== TicketStatus.VALIDATION_FAILED) {
          await this.dispatcher.dispatch(event);
          this.logger.debug(
            `[${correlationId}] Skipping re-validation - ticket already validated or in final state`,
          );
          return { success: true, status: existing.status };
        }
      }

      // Parse the task event into structured ticket data
      const parsed = this.parseTaskEvent(event);

      // Story 4.9: Resolve Project from projectIdentifier
      const clickupListId = parsed.projectId;
      const project = await this.projectService.findByListId(clickupListId);

      if (!project) {
        this.logger.error(
          `[${correlationId}] CRITICAL: No project mapping found for identifier ${clickupListId}. ` +
            `Ticket cannot be processed. Admin must create project mapping via POST /api/v1/projects`,
        );

        // Log project resolution failure
        await this.aiDecisionLogger.logDecision({
          agentName: 'TicketIntakeService',
          action: 'project_resolution_failed',
          reasoning: `No project mapping exists for project identifier ${clickupListId}. Ticket rejected. Admin must create project via API.`,
          ticketId: parsed.clickupTaskId,
          inputData: { projectIdentifier: clickupListId, provider: event.providerType },
          outputData: {
            error: 'NO_PROJECT_MAPPING',
            projectIdentifier: clickupListId,
            resolution: 'Create project mapping via POST /api/v1/projects with this identifier',
          },
          confidence: 1.0,
        });

        return {
          success: false,
          status: TicketStatus.VALIDATION_FAILED,
          errors: [
            `No project mapping found for project identifier "${clickupListId}". ` +
              `Admin must create a project mapping via POST /api/v1/projects API.`,
          ],
        };
      }

      // Story 19.4: Check if project is active
      if (project.is_active === false) {
        this.logger.warn(
          `[${correlationId}] Project "${project.name}" is inactive. Rejecting ticket.`,
        );

        await this.aiDecisionLogger.logDecision({
          agentName: 'TicketIntakeService',
          action: 'ticket_rejection',
          reasoning: `Project "${project.name}" is inactive. Tickets cannot be processed until project is reactivated.`,
          ticketId: parsed.clickupTaskId,
          inputData: { projectId: project.id, is_active: project.is_active },
          outputData: {
            decision: 'rejected',
            reason: 'project_inactive',
            status: TicketStatus.VALIDATION_FAILED,
          },
          confidence: 1.0,
        });

        return {
          success: false,
          status: TicketStatus.VALIDATION_FAILED,
          errors: [
            `Project "${project.name}" is inactive. Please reactivate project to process tickets.`,
          ],
        };
      }

      // Store resolved project ID back into parsed ticket for DB storage
      parsed.projectId = project.id;

      // Story 4.9: Log successful project resolution
      await this.aiDecisionLogger.logDecision({
        agentName: 'TicketIntakeService',
        action: 'project_resolution',
        reasoning: `Successfully mapped project identifier ${clickupListId} to project "${project.name}" (${project.id}).`,
        ticketId: parsed.clickupTaskId,
        inputData: { projectIdentifier: clickupListId, provider: event.providerType },
        outputData: {
          projectId: project.id,
          projectName: project.name,
          repositoryUrl: project.github_repository_url,
        },
        confidence: 1.0,
      });

      // Validate the ticket
      const validation = await this.validator.validate(parsed, correlationId);
      this.validationCounter.inc({
        result: validation.isValid ? 'success' : 'failure',
      });

      if (!validation.isValid) {
        return await this.handleValidationFailure(parsed, validation, correlationId);
      }

      // AC#1: Circular Dependency Check
      const cycleResult = await this.circularDetector.detectCircularDependencies(
        parsed.clickupTaskId,
      );
      if (cycleResult.hasCycle) {
        this.circularCounter.inc();
        await this.circularDetector.markTicketsAsCircular(cycleResult.affectedTickets);
        await this.circularDetector.alertPM(
          cycleResult.cycle,
          await this.circularDetector.buildDependencyGraph(parsed.clickupTaskId),
        );

        // Store as BLOCKED_CIRCULAR
        await this.prisma.ticket.upsert({
          where: { clickup_task_id: parsed.clickupTaskId },
          create: {
            clickup_task_id: parsed.clickupTaskId,
            project_id: parsed.projectId,
            title: parsed.title,
            description: parsed.description,
            acceptance_criteria: parsed.acceptanceCriteria,
            ticket_quality_score: 0,
            status: TicketStatus.BLOCKED_CIRCULAR,
          },
          update: {
            status: TicketStatus.BLOCKED_CIRCULAR,
            updated_at: new Date(),
          },
        });

        return {
          success: false,
          status: TicketStatus.BLOCKED_CIRCULAR,
          errors: [`Circular dependency detected: ${cycleResult.cycle.join(' → ')}`],
        };
      }

      // AC#4: Dependency Blocker Check
      const depCheck = await this.dependencyManager.checkDependencies(parsed.clickupTaskId);
      if (!depCheck.canProceed) {
        this.waitingCounter.inc();

        // Store as WAITING
        await this.prisma.ticket.upsert({
          where: { clickup_task_id: parsed.clickupTaskId },
          create: {
            clickup_task_id: parsed.clickupTaskId,
            project_id: parsed.projectId,
            title: parsed.title,
            description: parsed.description,
            acceptance_criteria: parsed.acceptanceCriteria,
            ticket_quality_score: 0,
            status: TicketStatus.WAITING,
          },
          update: {
            status: TicketStatus.WAITING,
            updated_at: new Date(),
          },
        });

        return {
          success: false,
          status: TicketStatus.WAITING,
          estimatedETA: depCheck.estimatedETA,
          errors: [
            `Blocked by unresolved dependencies: ${depCheck.unresolvedDependencies.join(', ')}`,
          ],
        };
      }

      // Calculate quality score
      const qualityScore = this.qualityService.calculateScore(parsed, correlationId);
      this.qualityHistogram.observe({ grade: qualityScore.grade }, qualityScore.totalScore);

      // Story 11.4: Log quality score calculation decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'TicketIntakeService',
        action: 'quality_score_calculation',
        reasoning: `Quality score calculated: ${qualityScore.totalScore}/100 (${qualityScore.grade}). Factors: title clarity, description completeness, acceptance criteria presence, context documents.`,
        ticketId: parsed.clickupTaskId,
        inputData: {
          ticketTitle: parsed.title,
          descriptionLength: parsed.description?.length || 0,
          hasAcceptanceCriteria: (parsed.acceptanceCriteria?.length || 0) > 0,
          tags: parsed.tags || [],
        },
        outputData: {
          qualityScore: qualityScore.totalScore,
          grade: qualityScore.grade,
          threshold: 70,
          passed: qualityScore.totalScore >= 70,
        },
        confidence:
          qualityScore.totalScore >= 80 ? 0.95 : qualityScore.totalScore >= 70 ? 0.8 : 0.6,
      });

      // Story 11.4: Log ticket acceptance decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'TicketIntakeService',
        action: 'ticket_acceptance',
        reasoning: `Ticket accepted with quality score ${qualityScore.totalScore}/100. All validation checks passed. Proceeding to AI execution.`,
        ticketId: parsed.clickupTaskId,
        inputData: { qualityScore: qualityScore.totalScore },
        outputData: {
          decision: 'accepted',
          status: TicketStatus.VALIDATED,
          queuedFor: 'ai_execution',
        },
        confidence: 0.95,
      });

      // Create/update ticket in database
      const ticket = await this.createOrUpdateTicket(parsed, qualityScore, correlationId);

      // Route to AI processing
      await this.routeToAIProcessing(ticket.id, parsed, qualityScore, correlationId);
      await this.dispatcher.dispatch(event);

      this.logger.log(
        `[${correlationId}] Ticket validated and routed: ${ticket.id} (score: ${qualityScore.totalScore})`,
      );

      return {
        success: true,
        ticketId: ticket.id,
        status: TicketStatus.VALIDATED,
        qualityScore: qualityScore.totalScore,
      };
    } catch (_error) {
      this.logger.error(
        `[${correlationId}] Error processing task: ${(_error as Error).message}`,
        (_error as Error).stack,
      );
      this.intakeCounter.inc({
        provider: event.providerType,
        trigger: event.triggerSource,
        status: 'error',
      });
      throw _error;
    } finally {
      endTimer();
    }
  }

  /**
   * Story 20.1 AC#4: Idempotency check
   * Prevents duplicate AI executions for the same task
   */
  private async checkActiveExecution(externalId: string) {
    return await this.prisma.execution.findFirst({
      where: {
        ticket: {
          clickup_task_id: externalId,
        },
        status: {
          in: ['QUEUED', 'IN_PROGRESS'],
        },
      },
      select: {
        id: true,
        ticket_id: true,
        status: true,
      },
    });
  }

  /**
   * Parse task event into structured ticket data
   * Story 20.1: Now accepts ITaskEvent (provider-agnostic)
   */
  private parseTaskEvent(event: ITaskEvent): IParsedTicket {
    return {
      clickupTaskId: event.externalId,
      projectId: event.projectIdentifier,
      title: event.title,
      description: event.description || '',
      acceptanceCriteria: this.extractAcceptanceCriteria(event.description || ''),
      tags: event.tags || [],
      priority: null,
      creatorEmail: event.creatorEmail || '',
      taskUrl: event.taskUrl,
      rawEvent: event as unknown as IRawTaskEvent, // Type cast for backward compatibility
    };
  }

  /**
   * Extract acceptance criteria from description using patterns
   */
  private extractAcceptanceCriteria(description: string): string {
    // Try common patterns for acceptance criteria
    const patterns = [
      // Markdown header pattern
      /##?\s*acceptance\s*criteria[:\s]*\n?([\s\S]*?)(?=\n##|\n\*\*[A-Z]|$)/i,
      // Bold label pattern
      /\*\*acceptance\s*criteria\*\*[:\s]*\n?([\s\S]*?)(?=\n\*\*|$)/i,
      // Given/When/Then pattern
      /given[\s\S]*?then[\s\S]*?(?=\n##|$)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
      if (match?.[0]?.trim()) return match[0].trim();
    }

    return '';
  }

  /**
   * Handle validation failure
   */
  private async handleValidationFailure(
    ticket: IParsedTicket,
    validation: ValidationResultDto,
    correlationId: string,
  ): Promise<ITicketProcessingResult> {
    this.logger.warn(`[${correlationId}] Validation failed for ${ticket.clickupTaskId}`);

    // Story 11.4: Log ticket rejection decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'TicketIntakeService',
      action: 'ticket_rejection',
      reasoning: `Ticket rejected due to validation failures: ${validation.errors.map((e) => e.message).join(', ')}`,
      ticketId: ticket.clickupTaskId,
      inputData: {
        validationErrors: validation.errors.map((e) => ({
          field: e.field,
          message: e.message,
        })),
      },
      outputData: {
        decision: 'rejected',
        reason: 'validation_failed',
        status: TicketStatus.VALIDATION_FAILED,
        errorCount: validation.errors.length,
      },
      confidence: 0.9, // High confidence in rejection decision
    });

    // Store ticket with VALIDATION_FAILED status
    await this.prisma.ticket.upsert({
      where: { clickup_task_id: ticket.clickupTaskId },
      create: {
        clickup_task_id: ticket.clickupTaskId,
        project_id: ticket.projectId || 'unknown',
        title: ticket.title || 'Untitled',
        description: ticket.description || '',
        acceptance_criteria: ticket.acceptanceCriteria || '',
        ticket_quality_score: 0,
        status: TicketStatus.VALIDATION_FAILED,
      },
      update: {
        status: TicketStatus.VALIDATION_FAILED,
        updated_at: new Date(),
      },
    });

    // Log audit entry
    await this.logAudit(
      ticket.clickupTaskId,
      'validation_failed',
      { errors: validation.errors },
      correlationId,
    );

    return {
      success: false,
      status: TicketStatus.VALIDATION_FAILED,
      errors: validation.errors.map((e) => e.message),
    };
  }

  /**
   * Create or update ticket in database
   */
  private async createOrUpdateTicket(
    parsed: IParsedTicket,
    qualityScore: QualityScoreDto,
    correlationId: string,
  ) {
    const ticket = await this.prisma.ticket.upsert({
      where: { clickup_task_id: parsed.clickupTaskId },
      create: {
        clickup_task_id: parsed.clickupTaskId,
        project_id: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptance_criteria: parsed.acceptanceCriteria,
        ticket_quality_score: qualityScore.totalScore,
        status: TicketStatus.VALIDATED,
      },
      update: {
        title: parsed.title,
        description: parsed.description,
        acceptance_criteria: parsed.acceptanceCriteria,
        ticket_quality_score: qualityScore.totalScore,
        status: TicketStatus.VALIDATED,
        updated_at: new Date(),
      },
    });

    await this.logAudit(
      parsed.clickupTaskId,
      'ticket_validated',
      { ticketId: ticket.id, qualityScore: qualityScore.totalScore },
      correlationId,
    );

    return ticket;
  }

  /**
   * Route validated ticket to AI processing queue
   */
  private async routeToAIProcessing(
    ticketId: string,
    parsed: IParsedTicket,
    qualityScore: QualityScoreDto,
    correlationId: string,
  ): Promise<void> {
    await this.rabbitMQPublisher.publishToQueue(
      QUEUE_NAMES.AI_ROUTING,
      {
        ticketId,
        clickupTaskId: parsed.clickupTaskId,
        projectId: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptanceCriteria: parsed.acceptanceCriteria,
        tags: parsed.tags,
        qualityScore: qualityScore.totalScore,
        qualityGrade: qualityScore.grade,
        timestamp: new Date().toISOString(),
      },
      correlationId,
    );

    this.logger.debug(`[${correlationId}] Routed ticket ${ticketId} to ${QUEUE_NAMES.AI_ROUTING}`);
  }

  /**
   * Log audit entry
   */
  private async logAudit(
    entityId: string,
    action: string,
    data: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entity_type: 'ticket',
          entity_id: entityId,
          action,
          actor_type: 'system',
          actor_id: null,
          after_state: {
            ...data,
            correlationId,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (_error) {
      this.logger.error(`[${correlationId}] Audit log failed: ${(_error as Error).message}`);
    }
  }
}
