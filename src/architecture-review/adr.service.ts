import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import {
  CreateAdrDto,
  UpdateAdrDto,
  AdrReviewQueueQueryDto,
  AdrQueueItemDto,
  ProvideGuidanceDto,
  DelegateAdrDto,
} from './dto';
import { Prisma, AdrStatus, RiskLevel } from '@/prisma/client';
import { RiskAssessmentService } from './risk-assessment.service';
import { EventBusService } from '@/common/event-bus.service';
import { AdrReviewedEvent } from './events/adr-reviewed.event';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { ConstraintValidatorService } from './constraint-validator.service';
import { EscalationDetectorService, EscalationMetadata } from './escalation-detector.service';
import { AdrMetricsService } from './metrics/adr-metrics.service';
import { AdrEscalatedEvent } from './events/adr-escalated.event';

@Injectable()
export class AdrService {
  private readonly logger = new Logger(AdrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskService: RiskAssessmentService,
    private readonly eventBus: EventBusService,
    private readonly auditLogger: AIDecisionLoggerService,
    private readonly notificationService: ArchitectureReviewNotificationService,
    private readonly constraintValidator: ConstraintValidatorService,
    private readonly escalationDetector: EscalationDetectorService,
    private readonly metricsService: AdrMetricsService,
  ) {}

  /**
   * Create a new Architecture Decision Record
   * @param createAdrDto - ADR creation data
   * @returns Created ADR
   */
  async create(createAdrDto: CreateAdrDto) {
    this.logger.log(`Creating ADR: ${createAdrDto.title}`);

    let riskLevel = createAdrDto.risk_level;
    let riskFactors: Prisma.JsonValue | undefined = createAdrDto.risk_factors as
      | Prisma.JsonValue
      | undefined;

    // Calculate risk level if factors provided but level missing
    if (!riskLevel && riskFactors) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      riskLevel = this.riskService.calculateRiskLevel(riskFactors as any);
    } else if (!riskLevel) {
      // Fallback to legacy calculation if no factors provided
      riskLevel = this.calculateRiskLevelLegacy(createAdrDto) as RiskLevel;
    }

    // Validate against architecture constraints
    const constraintViolations = await this.constraintValidator.validate({
      files: [],
      projectId: undefined, // We need to fetch project ID from ticket if possible
    });

    // If we found violations, we should add them to risk_factors
    if (constraintViolations.length > 0) {
      const violationFactors = constraintViolations.map((v) => ({
        type: 'CONSTRAINT_VIOLATION',
        severity: v.severity,
        message: v.message,
        constraintId: v.constraintId,
      }));

      // Append to existing factors
      if (riskFactors && Array.isArray(riskFactors)) {
        (riskFactors as Prisma.JsonArray).push(...violationFactors);
      } else {
        riskFactors = violationFactors as unknown as Prisma.JsonValue;
      }

      // Escalate risk level if critical
      if (constraintViolations.some((v) => v.severity === 'CRITICAL')) {
        riskLevel = RiskLevel.HIGH;
      }
    }

    const adr = await this.prisma.adr.create({
      data: {
        title: createAdrDto.title,
        context: createAdrDto.context,
        decision: createAdrDto.decision,
        consequences: createAdrDto.consequences,
        alternatives: createAdrDto.alternatives,
        ai_confidence: createAdrDto.ai_confidence,
        status: (createAdrDto.status || 'PROPOSED') as AdrStatus,
        risk_level: riskLevel as RiskLevel,
        risk_factors: riskFactors
          ? (riskFactors as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        execution_id: createAdrDto.execution_id,
        ticket_id: createAdrDto.ticket_id,
      },
    });

    this.logger.log(`ADR created successfully: ${adr.id}`);

    // Story 7.6 AC#1: Check if ADR should be escalated due to low confidence
    if (createAdrDto.ai_confidence !== undefined || createAdrDto.decision) {
      const escalationCheck = this.escalationDetector.shouldEscalate({
        aiConfidence: createAdrDto.ai_confidence,
        aiResponse: `${createAdrDto.decision}\n\n${createAdrDto.alternatives || ''}`,
        context: createAdrDto.context,
      });

      if (escalationCheck.shouldEscalate && escalationCheck.metadata) {
        this.logger.warn(`ADR ${adr.id} requires escalation. Reason: ${escalationCheck.reason}`);

        // Automatically escalate the ADR
        await this.escalateToTL(
          adr.id,
          escalationCheck.reason || 'LOW_CONFIDENCE',
          escalationCheck.metadata,
        );

        // Note: escalateToTL() will emit AdrEscalatedEvent which ExecutionService should listen to for blocking
        this.logger.log(
          `ADR ${adr.id} escalated - execution will be blocked until TL provides guidance`,
        );
      }
    }

    return adr;
  }

  /**
   * Find all ADRs with optional filtering
   * @param where - Optional filter conditions
   * @returns Array of ADRs
   */
  async findAll(where?: Prisma.AdrWhereInput) {
    return this.prisma.adr.findMany({
      where,
      include: {
        execution: true,
        ticket: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  /**
   * Find a single ADR by ID
   * @param id - ADR ID
   * @returns ADR or null
   */
  async findOne(id: string) {
    return this.prisma.adr.findUnique({
      where: { id },
      include: {
        execution: true,
        ticket: true,
      },
    });
  }

  /**
   * Update an existing ADR
   * @param id - ADR ID
   * @param updateAdrDto - Updated ADR data
   * @returns Updated ADR
   */
  async update(id: string, updateAdrDto: UpdateAdrDto) {
    this.logger.log(`Updating ADR: ${id}`);

    return this.prisma.adr.update({
      where: { id },
      data: updateAdrDto as Prisma.AdrUpdateInput,
    });
  }

  /**
   * Delete an ADR
   * @param id - ADR ID
   * @returns Deleted ADR
   */
  async remove(id: string) {
    this.logger.log(`Deleting ADR: ${id}`);

    return this.prisma.adr.delete({
      where: { id },
    });
  }

  /**
   * Get ADR review queue with filtering, sorting, and ticket context
   * @param filters - Query filters (status, risk_level, project_id, confidence range, sorting)
   * @returns Array of ADRs formatted for review queue with estimated review time
   */
  async getReviewQueue(filters: AdrReviewQueueQueryDto): Promise<AdrQueueItemDto[]> {
    this.logger.log(`Fetching ADR review queue with filters: ${JSON.stringify(filters)}`);

    // Build where clause
    const where: Prisma.AdrWhereInput = {
      status: filters.status || AdrStatus.PROPOSED,
    };

    if (filters.risk_level) {
      where.risk_level = filters.risk_level;
    }

    if (filters.project_id) {
      where.execution = {
        ticket: {
          project_id: filters.project_id,
        },
      };
    }

    // Confidence range filters
    if (filters.min_confidence !== undefined || filters.max_confidence !== undefined) {
      where.ai_confidence = {};
      if (filters.min_confidence !== undefined) {
        where.ai_confidence.gte = filters.min_confidence;
      }
      if (filters.max_confidence !== undefined) {
        where.ai_confidence.lte = filters.max_confidence;
      }
    }

    // Build orderBy clause
    const orderBy: Prisma.AdrOrderByWithRelationInput = {};
    const sortBy = filters.sort_by || 'risk_level';
    const sortOrder = filters.sort_order || 'DESC';

    if (sortBy === 'created_at' || sortBy === 'confidence') {
      orderBy[sortBy === 'confidence' ? 'ai_confidence' : sortBy] = sortOrder.toLowerCase() as
        | 'asc'
        | 'desc';
    } else {
      // For risk_level sorting
      orderBy.risk_level = sortOrder.toLowerCase() as 'asc' | 'desc';
    }

    // Fetch ADRs with nested relations
    const adrs = await this.prisma.adr.findMany({
      where,
      include: {
        execution: {
          include: {
            ticket: {
              select: {
                id: true,
                title: true,
                clickup_task_id: true,
              },
            },
          },
        },
      },
      orderBy,
    });

    // Map to queue item DTOs with calculated review time
    return adrs.map((adr) => ({
      id: adr.id,
      title: adr.title,
      status: adr.status as AdrStatus,
      risk_level: adr.risk_level as RiskLevel | null,
      ai_confidence: adr.ai_confidence ?? 0,
      created_at: adr.created_at,
      estimated_review_time_minutes: this.calculateReviewTime(adr.risk_level as RiskLevel | null),
      ticket: adr.execution?.ticket
        ? {
            id: adr.execution.ticket.id,
            title: adr.execution.ticket.title,
            clickup_task_id: adr.execution.ticket.clickup_task_id,
          }
        : null,
      execution_id: adr.execution_id,
    }));
  }

  /**
   * Calculate estimated review time based on risk level
   * @param riskLevel - Risk level of the ADR
   * @returns Estimated review time in minutes
   */
  calculateReviewTime(riskLevel: RiskLevel | null): number {
    switch (riskLevel) {
      case RiskLevel.HIGH:
        return 15;
      case RiskLevel.MEDIUM:
        return 8;
      case RiskLevel.LOW:
      default:
        return 3;
    }
  }

  /**
   * Calculate risk level based on ADR content (Legacy/Fallback)
   * Logic: High if new_dependencies or schema_changes; Medium if refactoring; Low otherwise
   * @param adr - ADR DTO
   * @returns Risk level (HIGH/MEDIUM/LOW)
   */
  calculateRiskLevelLegacy(adr: CreateAdrDto): string {
    const content = `${adr.title} ${adr.context} ${adr.decision}`.toLowerCase();

    // High risk indicators
    const highRiskKeywords = [
      'dependency',
      'dependencies',
      'schema change',
      'schema changes',
      'database migration',
      'breaking change',
      'major refactor',
      'infrastructure',
    ];

    // Medium risk indicators
    const mediumRiskKeywords = [
      'refactoring',
      'refactor',
      'code restructure',
      'module restructure',
      'api change',
    ];

    // Check for high risk
    if (highRiskKeywords.some((keyword) => content.includes(keyword))) {
      this.logger.log(`High risk ADR detected: ${adr.title}`);
      return 'HIGH';
    }

    // Check for medium risk
    if (mediumRiskKeywords.some((keyword) => content.includes(keyword))) {
      this.logger.log(`Medium risk ADR detected: ${adr.title}`);
      return 'MEDIUM';
    }

    // Default to low risk
    return 'LOW';
  }

  /**
   * Find ADRs by execution ID
   * @param executionId - Execution ID
   * @returns Array of ADRs
   */
  async findByExecution(executionId: string) {
    return this.findAll({ execution_id: executionId });
  }

  /**
   * Find ADRs by ticket ID
   * @param ticketId - Ticket ID
   * @returns Array of ADRs
   */
  async findByTicket(ticketId: string) {
    return this.findAll({ ticket_id: ticketId });
  }

  /**
   * Review an ADR (approve, reject, modify, or defer)
   * @param adrId - ADR ID
   * @param action - Review action (APPROVE, REJECT, MODIFY, DEFER)
   * @param notes - Optional notes (required for REJECT and MODIFY)
   * @returns Review response with updated ADR
   * @throws NotFoundException if ADR not found
   * @throws BadRequestException if ADR already reviewed
   */
  async reviewAdr(
    adrId: string,
    action: string,
    notes?: string,
  ): Promise<{
    success: boolean;
    message: string;
    adr: { id: string; title: string; status: AdrStatus; updated_at: Date };
  }> {
    this.logger.log(`Reviewing ADR ${adrId} with action: ${action}`);

    // Find the ADR
    const adr = await this.prisma.adr.findUnique({
      where: { id: adrId },
      include: { execution: { include: { ticket: true } } }, // Include relations for metrics
    });

    if (!adr) {
      throw new Error('ADR not found');
    }

    // Validate that ADR is in PROPOSED status
    if (adr.status !== AdrStatus.PROPOSED) {
      throw new Error('ADR has already been reviewed');
    }

    // Map action to new status (use existing Prisma enum values)
    let newStatus: AdrStatus;
    switch (action) {
      case 'APPROVE':
        newStatus = AdrStatus.ACCEPTED; // Prisma uses ACCEPTED not APPROVED
        break;
      case 'REJECT':
        newStatus = AdrStatus.REJECTED;
        break;
      case 'MODIFY':
        // MODIFY action: Re-propose for modification (back to PROPOSED with notes)
        // Since MODIFIED doesn't exist in Prisma, we keep it PROPOSED
        newStatus = AdrStatus.PROPOSED;
        this.logger.warn(
          `MODIFY action requested but MODIFIED status doesn't exist in schema. Keeping as PROPOSED.`,
        );
        break;
      case 'DEFER':
        // DEFER action: Mark as deprecated for now (closest semantic match)
        // Since DEFERRED doesn't exist in Prisma, we use DEPRECATED
        newStatus = AdrStatus.DEPRECATED;
        this.logger.warn(
          `DEFER action requested but DEFERRED status doesn't exist in schema. Using DEPRECATED.`,
        );
        break;
      default:
        throw new Error(`Invalid action: ${action}`);
    }

    // Calculate metrics
    const reviewedAt = new Date();
    const reviewDurationSeconds = Math.floor(
      (reviewedAt.getTime() - adr.created_at.getTime()) / 1000,
    );

    // Update ADR with new status and metrics
    const updatedAdr = await this.prisma.adr.update({
      where: { id: adrId },
      data: {
        status: newStatus,
        reviewed_at: reviewedAt,
        review_duration_seconds: reviewDurationSeconds,
        rejection_reason: newStatus === AdrStatus.REJECTED ? notes : null,
      },
      include: { execution: { include: { ticket: true } } },
    });

    this.logger.log(`ADR ${adrId} reviewed successfully. New status: ${newStatus}`);

    // 1. Log Decision
    await this.auditLogger.logDecision({
      agentName: 'TL/User',
      action: `ADR_${action}`,
      reasoning: notes || action,
      ticketId: adr.ticket_id || 'unknown',
      executionId: adr.execution_id || undefined,
      inputData: { adrId, action, notes },
      outputData: { newStatus, reviewDurationSeconds },
      confidence: 1.0, // Human decision = 100% confidence
    });

    // 2. Notify Stakeholders
    await this.notificationService.notifyDecision(
      { ...adr } as Prisma.AdrGetPayload<{ include: { execution: { include: { ticket: true } } } }>,
      action,
      notes,
    );

    // 3. Track Metrics (Pre-Implementation Verification Backfill)
    await this.metricsService.trackReviewCompleted(updatedAdr, action, notes);

    // 4. Emit Event for Side Effects (e.g. Retry Logic)
    this.eventBus.emit(
      'adr.reviewed',
      new AdrReviewedEvent(
        adrId,
        adr.ticket_id || '',
        action,
        notes,
        adr.execution_id || undefined,
      ),
    );

    const actionPastTense =
      // eslint-disable-next-line security/detect-object-injection
      {
        APPROVE: 'approved',
        REJECT: 'rejected',
        MODIFY: 'modified',
        DEFER: 'deferred',
      }[action] || action.toLowerCase() + 'ed';

    return {
      success: true,
      message: `ADR ${actionPastTense} successfully`,
      adr: {
        id: updatedAdr.id,
        title: updatedAdr.title,
        status: updatedAdr.status,
        updated_at: updatedAdr.updated_at,
      },
    };
  }

  /**
   * Escalate an ADR to TL due to low confidence or uncertainty
   * Story 7.6 AC#1, AC#2
   * @param adrId - ADR ID
   * @param reason - Escalation reason category
   * @param metadata - Escalation metadata (questions, alternatives, trade-offs)
   * @returns Updated ADR with ESCALATED status
   */
  async escalateToTL(
    adrId: string,
    reason: string,
    metadata: EscalationMetadata,
  ): Promise<Prisma.AdrGetPayload<object>> {
    this.logger.warn(`Escalating ADR ${adrId} to TL. Reason: ${reason}`);

    // Find the ADR
    const adr = await this.prisma.adr.findUnique({
      where: { id: adrId },
      include: { ticket: true, execution: true },
    });

    if (!adr) {
      throw new Error('ADR not found');
    }

    // Update ADR to ESCALATED status
    const updatedAdr = await this.prisma.adr.update({
      where: { id: adrId },
      data: {
        status: AdrStatus.ESCALATED,
        escalation_reason: reason,
        escalation_questions: metadata.questions as Prisma.InputJsonValue,
        trade_offs: metadata.tradeOffs as Prisma.InputJsonValue,
      },
      include: {
        ticket: {
          select: {
            clickup_task_id: true,
          },
        },
        execution: true,
      },
    });

    // Log escalation for audit trail
    await this.auditLogger.logDecision({
      agentName: 'escalation-detector',
      action: 'escalate_adr',
      reasoning: `Low confidence escalation: ${reason}`,
      ticketId: adr.ticket_id || 'unknown',
      executionId: adr.execution_id || undefined,
      inputData: { adrId, reason, confidence: metadata.confidence },
      outputData: { escalatedStatus: AdrStatus.ESCALATED },
      confidence: 0.4, // Escalation itself indicates low confidence
    });

    // Notify TL via ClickUp (Story 7.6 AC#4)

    await this.notificationService.notifyEscalation(
      {
        ...updatedAdr,
        ticket: updatedAdr.ticket || undefined,
        escalation_reason: updatedAdr.escalation_reason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      metadata,
    );

    // Story 7.6 AC#1: Emit event to block execution pipeline
    this.eventBus.emit(
      'adr.escalated',
      new AdrEscalatedEvent(adrId, adr.ticket_id || '', adr.execution_id || undefined, reason),
    );

    this.logger.log(`ADR ${adrId} escalated successfully`);
    return updatedAdr;
  }

  /**
   * Provide TL guidance for an escalated ADR
   * Story 7.6 AC#3, AC#5
   * @param adrId - ADR ID
   * @param guidanceDto - Guidance data from TL
   * @returns Updated ADR with GUIDANCE_PROVIDED status
   */
  async provideGuidance(
    adrId: string,
    guidanceDto: ProvideGuidanceDto,
  ): Promise<Prisma.AdrGetPayload<object>> {
    this.logger.log(`Providing guidance for escalated ADR ${adrId}`);

    // Find the ADR
    const adr = await this.prisma.adr.findUnique({
      where: { id: adrId },
    });

    if (!adr) {
      throw new Error('ADR not found');
    }

    if (adr.status !== AdrStatus.ESCALATED) {
      throw new Error('ADR is not in ESCALATED status');
    }

    const guidanceProvidedAt = new Date();
    const escalationDuration = adr.created_at
      ? Math.floor((guidanceProvidedAt.getTime() - adr.created_at.getTime()) / 1000)
      : null;

    // Update ADR with guidance
    const updatedAdr = await this.prisma.adr.update({
      where: { id: adrId },
      data: {
        status: AdrStatus.GUIDANCE_PROVIDED,
        tl_guidance: guidanceDto.guidance,
        guidance_provided_at: guidanceProvidedAt,
        escalation_duration_seconds: escalationDuration,
      },
    });

    // Log guidance provision
    await this.auditLogger.logDecision({
      agentName: 'TL/User',
      action: 'provide_guidance',
      reasoning: guidanceDto.guidance,
      ticketId: adr.ticket_id || 'unknown',
      executionId: adr.execution_id || undefined,
      inputData: { adrId, guidance: guidanceDto.guidance },
      outputData: { status: AdrStatus.GUIDANCE_PROVIDED },
      confidence: 1.0, // Human guidance = 100% confidence
    });

    // Story 7.6 AC#3: If apply_globally flag, create architecture constraint from guidance
    if (guidanceDto.apply_globally && adr.ticket_id) {
      this.logger.log('Creating global architecture constraint from TL guidance');
      // Note: This requires ArchitectureConstraintService integration
      // For now, log the intent and track as technical debt
      await this.auditLogger.logDecision({
        agentName: 'TL/User',
        action: 'create_constraint_from_guidance',
        reasoning: `TL guidance should be applied globally: ${guidanceDto.guidance}`,
        ticketId: adr.ticket_id,
        inputData: { adrId, guidance: guidanceDto.guidance },
        outputData: { status: 'deferred_to_constraint_service' },
        confidence: 1.0,
      });
      // TODO: Integrate with ArchitectureConstraintService when available
    }

    // Story 7.6 AC#3: If update_thresholds flag, adjust project confidence threshold
    if (guidanceDto.update_thresholds && adr.ticket_id) {
      this.logger.log('Threshold adjustment requested based on escalation pattern');
      // Note: This requires Project table "escalation_threshold" field update
      // For now, log the recommendation
      await this.auditLogger.logDecision({
        agentName: 'TL/User',
        action: 'recommend_threshold_adjustment',
        reasoning: `TL suggests adjusting escalation threshold after reviewing escalated ADR`,
        ticketId: adr.ticket_id,
        inputData: { adrId, currentThreshold: 0.7 },
        outputData: { recommendedThreshold: 'TBD_based_on_pattern_analysis' },
        confidence: 0.8,
      });
      // TODO: Implement threshold adjustment logic when Project.escalation_threshold field is added
    }

    // Emit event to trigger AI retry with guidance (Story 7.6 AC#5)
    this.eventBus.emit(
      'adr.reviewed',
      new AdrReviewedEvent(
        adrId,
        adr.ticket_id || '',
        'GUIDANCE_PROVIDED',
        guidanceDto.guidance,
        adr.execution_id || undefined,
      ),
    );

    this.logger.log(`Guidance provided for ADR ${adrId}. Duration: ${escalationDuration}s`);
    return updatedAdr;
  }

  /**
   * Delegate an escalated ADR to architect or senior developer
   * Story 7.6 AC#3
   * @param adrId - ADR ID
   * @param delegateDto - Delegation data
   * @returns Updated ADR with delegate_to field
   */
  async delegate(
    adrId: string,
    delegateDto: DelegateAdrDto,
  ): Promise<Prisma.AdrGetPayload<object>> {
    this.logger.log(`Delegating ADR ${adrId} to ${delegateDto.delegate_to_user_id}`);

    // Find the ADR
    const adr = await this.prisma.adr.findUnique({
      where: { id: adrId },
    });

    if (!adr) {
      throw new Error('ADR not found');
    }

    if (adr.status !== AdrStatus.ESCALATED) {
      throw new Error('ADR is not in ESCALATED status');
    }

    // Update ADR with delegation info
    const updatedAdr = await this.prisma.adr.update({
      where: { id: adrId },
      data: {
        delegate_to: delegateDto.delegate_to_user_id,
        // Keep status as ESCALATED until delegatee provides guidance
      },
    });

    // Log delegation
    await this.auditLogger.logDecision({
      agentName: 'TL/User',
      action: 'delegate_adr',
      reasoning: delegateDto.notes || 'Delegated to architect',
      ticketId: adr.ticket_id || 'unknown',
      executionId: adr.execution_id || undefined,
      inputData: { adrId, delegateTo: delegateDto.delegate_to_user_id },
      outputData: { delegated: true },
      confidence: 1.0,
    });

    return updatedAdr;
  }
}
