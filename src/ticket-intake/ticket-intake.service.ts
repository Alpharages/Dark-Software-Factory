import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { TicketStatus } from '@/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
// Story 4.9: Project Mapping
import { ProjectService } from '../projects/project.service';
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
 * Main orchestration service for processing incoming tickets:
 * 1. Parse raw task events from webhook queue
 * 2. Validate ticket data quality
 * 3. Calculate quality scores
 * 4. Store in database
 * 5. Route validated tickets to AI processing
 */
@Injectable()
export class TicketIntakeService {
  private readonly logger = new Logger(TicketIntakeService.name);
  private readonly clickupApiUrl: string;
  private readonly clickupApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    private readonly configService: ConfigService,
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
  ) {
    this.clickupApiUrl =
      this.configService.get<string>('clickup.apiUrl') || 'https://api.clickup.com/api/v2';
    this.clickupApiKey = this.configService.get<string>('clickup.apiKey') || '';
  }

  /**
   * Process a task event from the webhook queue
   */
  async processTaskEvent(event: IRawTaskEvent): Promise<ITicketProcessingResult> {
    const endTimer = this.durationHistogram.startTimer();
    const correlationId = event.correlationId;

    this.logger.log(`[${correlationId}] Processing ticket: ${event.taskId} (${event.eventType})`);
    this.intakeCounter.inc({ event_type: event.eventType });

    try {
      // For taskUpdated: handle dependency re-triggering and re-validation
      if (event.eventType === 'taskUpdated') {
        // AC#8: Re-trigger dependent tickets if this one is resolved
        if (this.dependencyManager.isStatusResolved(event.taskStatus)) {
          this.logger.log(
            `[${correlationId}] Ticket ${event.taskId} resolved (${event.taskStatus}), notifying dependents`,
          );
          await this.dependencyManager.notifyDependentTickets(event.taskId);
        }

        const existing = await this.prisma.ticket.findUnique({
          where: { clickup_task_id: event.taskId },
          select: { status: true },
        });

        if (existing && existing.status !== TicketStatus.VALIDATION_FAILED) {
          this.logger.debug(
            `[${correlationId}] Skipping re-validation - ticket already validated or in final state`,
          );
          return { success: true, status: existing.status };
        }
      }

      // Parse the task event
      const parsed = this.parseTaskEvent(event);

      // Story 4.9: Resolve Project from listId
      const clickupListId = parsed.projectId;
      const project = await this.projectService.findByListId(clickupListId);

      if (!project) {
        this.logger.error(
          `[${correlationId}] CRITICAL: No project mapping found for ClickUp list ${clickupListId}. ` +
            `Ticket cannot be processed. Admin must create project mapping via POST /api/v1/projects`,
        );

        // Log project resolution failure
        await this.aiDecisionLogger.logDecision({
          agentName: 'TicketIntakeService',
          action: 'project_resolution_failed',
          reasoning: `No project mapping exists for ClickUp list ${clickupListId}. Ticket rejected. Admin must create project via API.`,
          ticketId: parsed.clickupTaskId,
          inputData: { listId: clickupListId },
          outputData: {
            error: 'NO_PROJECT_MAPPING',
            listId: clickupListId,
            resolution: 'Create project mapping via POST /api/v1/projects with this listId',
          },
          confidence: 1.0,
        });

        // Return validation failure with actionable error
        return {
          success: false,
          status: TicketStatus.VALIDATION_FAILED,
          errors: [
            `No project mapping found for ClickUp list "${clickupListId}". ` +
              `Admin must create a project mapping via POST /api/v1/projects API with clickup_list_id="${clickupListId}".`,
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
        reasoning: `Successfully mapped ClickUp list ${clickupListId} to project "${project.name}" (${project.id}).`,
        ticketId: parsed.clickupTaskId,
        inputData: { listId: clickupListId },
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

        // Comment on ClickUp with ETA
        const etaMsg = depCheck.estimatedETA
          ? `Waiting for ${depCheck.unresolvedDependencies.length} dependencies. Estimated start: ${depCheck.estimatedETA.toLocaleString()}`
          : `Waiting for ${depCheck.unresolvedDependencies.length} dependencies.`;

        await this.commentOnClickUpTask(
          parsed.clickupTaskId,
          `⏳ **Ticket Waiting:** ${etaMsg}`,
          correlationId,
        );

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
        `[${correlationId}] Error processing ticket: ${(_error as Error).message}`,
        (_error as Error).stack,
      );
      this.intakeCounter.inc({ event_type: event.eventType, status: 'error' });
      throw _error;
    } finally {
      endTimer();
    }
  }

  /**
   * Parse raw task event into structured ticket data
   */
  private parseTaskEvent(event: IRawTaskEvent): IParsedTicket {
    return {
      clickupTaskId: event.taskId,
      projectId:
        (event.customFields?.['project_id'] as string) || event.projectId || event.listId || '',
      title: event.taskName,
      description: event.taskDescription || '',
      acceptanceCriteria: this.extractAcceptanceCriteria(event.taskDescription || ''),
      tags: event.tags || [],
      priority: null,
      creatorEmail: event.creatorEmail,
      taskUrl: event.taskUrl,
      rawEvent: event,
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

    // Comment on ClickUp task with validation errors
    await this.commentOnClickUpTask(
      ticket.clickupTaskId,
      this.validator.formatErrorsForComment(validation),
      correlationId,
    );

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
   * Post comment on ClickUp task
   */
  private async commentOnClickUpTask(
    taskId: string,
    comment: string,
    correlationId: string,
  ): Promise<void> {
    if (!this.clickupApiKey) {
      this.logger.warn(`[${correlationId}] ClickUp API key not configured - skipping comment`);
      return;
    }

    try {
      const response = await fetch(`${this.clickupApiUrl}/task/${taskId}/comment`, {
        method: 'POST',
        headers: {
          Authorization: this.clickupApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment_text: comment,
          notify_all: true,
        }),
      });

      if (!response.ok) {
        this.logger.error(`[${correlationId}] ClickUp comment failed: ${response.status}`);
      } else {
        this.logger.debug(`[${correlationId}] Posted validation comment to ClickUp task ${taskId}`);
      }
    } catch (_error) {
      this.logger.error(`[${correlationId}] ClickUp API error: ${(_error as Error).message}`);
    }
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
