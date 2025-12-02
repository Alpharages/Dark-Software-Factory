import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { IRawTaskEvent, IParsedTicket, ITicketProcessingResult } from './interfaces';
import { ValidationResultDto, QualityScoreDto } from './dto';

// Metric names
const METRICS = {
  INTAKE_TOTAL: 'dsf_ticket_intake_total',
  INTAKE_DURATION: 'dsf_ticket_intake_duration_seconds',
  VALIDATION_TOTAL: 'dsf_ticket_validation_total',
  QUALITY_SCORE: 'dsf_ticket_quality_score',
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
    @InjectMetric(METRICS.INTAKE_TOTAL)
    private readonly intakeCounter: Counter<string>,
    @InjectMetric(METRICS.INTAKE_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(METRICS.VALIDATION_TOTAL)
    private readonly validationCounter: Counter<string>,
    @InjectMetric(METRICS.QUALITY_SCORE)
    private readonly qualityHistogram: Histogram<string>,
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
      // For taskUpdated: only re-validate if previously failed
      if (event.eventType === 'taskUpdated') {
        const existing = await this.prisma.ticket.findUnique({
          where: { clickup_task_id: event.taskId },
          select: { status: true },
        });

        if (existing && existing.status !== TicketStatus.VALIDATION_FAILED) {
          this.logger.debug(
            `[${correlationId}] Skipping update - ticket not in VALIDATION_FAILED state`,
          );
          return { success: true, status: existing.status };
        }
      }

      // Parse the task event
      const parsed = this.parseTaskEvent(event);

      // Validate the ticket
      const validation = await this.validator.validate(parsed, correlationId);
      this.validationCounter.inc({
        result: validation.isValid ? 'success' : 'failure',
      });

      if (!validation.isValid) {
        return await this.handleValidationFailure(parsed, validation, correlationId);
      }

      // Calculate quality score
      const qualityScore = this.qualityService.calculateScore(parsed, correlationId);
      this.qualityHistogram.observe({ grade: qualityScore.grade }, qualityScore.totalScore);

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
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Error processing ticket: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.intakeCounter.inc({ event_type: event.eventType, status: 'error' });
      throw error;
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
    } catch (error) {
      this.logger.error(`[${correlationId}] ClickUp API error: ${(error as Error).message}`);
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
    } catch (error) {
      this.logger.error(`[${correlationId}] Audit log failed: ${(error as Error).message}`);
    }
  }
}
