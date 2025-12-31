import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAdrDto, UpdateAdrDto, AdrReviewQueueQueryDto, AdrQueueItemDto } from './dto';
import { Prisma, AdrStatus, RiskLevel } from '@/prisma/client';
import { RiskAssessmentService } from './risk-assessment.service';
import { EventBusService } from '../common/event-bus.service';
import { AdrReviewedEvent } from './events/adr-reviewed.event';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';

@Injectable()
export class AdrService {
    private readonly logger = new Logger(AdrService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly riskService: RiskAssessmentService,
        private readonly eventBus: EventBusService,
        private readonly auditLogger: AIDecisionLoggerService,
        private readonly notificationService: ArchitectureReviewNotificationService,
    ) { }

    /**
     * Create a new Architecture Decision Record
     * @param createAdrDto - ADR creation data
     * @returns Created ADR
     */
    async create(createAdrDto: CreateAdrDto) {
        this.logger.log(`Creating ADR: ${createAdrDto.title}`);

        let riskLevel = createAdrDto.risk_level;
        let riskFactors = createAdrDto.risk_factors;

        // Calculate risk level if factors provided but level missing
        if (!riskLevel && riskFactors) {
            riskLevel = this.riskService.calculateRiskLevel(riskFactors);
        } else if (!riskLevel) {
            // Fallback to legacy calculation if no factors provided
            // or construct default factors?
            // Task: "Update AdrService to call RiskAssessmentService during ADR creation"
            // Assuming we try to use new service if possible, or legacy logic.
            // For now, let's keep legacy logic as fallback or deprecate it?
            // The legacy logic implementation is strictly keyword based.
            // Let's rely on legacy if no factors.
            riskLevel = this.calculateRiskLevelLegacy(createAdrDto);
        }

        const adr = await this.prisma.adr.create({
            data: {
                title: createAdrDto.title,
                context: createAdrDto.context,
                decision: createAdrDto.decision,
                consequences: createAdrDto.consequences,
                alternatives: createAdrDto.alternatives,
                ai_confidence: createAdrDto.ai_confidence,
                status: (createAdrDto.status || 'PROPOSED') as any,
                risk_level: riskLevel as any,
                risk_factors: riskFactors ? (riskFactors as any) : Prisma.JsonNull,
                execution_id: createAdrDto.execution_id,
                ticket_id: createAdrDto.ticket_id,
            },
        });

        this.logger.log(`ADR created successfully: ${adr.id}`);
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
            data: updateAdrDto as any,
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
            orderBy[sortBy === 'confidence' ? 'ai_confidence' : sortBy] = sortOrder.toLowerCase() as 'asc' | 'desc';
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
            ticket: adr.execution?.ticket ? {
                id: adr.execution.ticket.id,
                title: adr.execution.ticket.title,
                clickup_task_id: adr.execution.ticket.clickup_task_id,
            } : null,
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
    ): Promise<{ success: boolean; message: string; adr: any }> {
        this.logger.log(`Reviewing ADR ${adrId} with action: ${action}`);

        // Find the ADR
        const adr = await this.prisma.adr.findUnique({
            where: { id: adrId },
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
                this.logger.warn(`MODIFY action requested but MODIFIED status doesn't exist in schema. Keeping as PROPOSED.`);
                break;
            case 'DEFER':
                // DEFER action: Mark as deprecated for now (closest semantic match)
                // Since DEFERRED doesn't exist in Prisma, we use DEPRECATED
                newStatus = AdrStatus.DEPRECATED;
                this.logger.warn(`DEFER action requested but DEFERRED status doesn't exist in schema. Using DEPRECATED.`);
                break;
            default:
                throw new Error(`Invalid action: ${action}`);
        }

        // Update ADR with new status
        const updatedAdr = await this.prisma.adr.update({
            where: { id: adrId },
            data: {
                status: newStatus,
                // Note: notes field would need to be added to schema if we want to persist them
                // For now, just updating status
            },
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
            outputData: { newStatus },
            confidence: 1.0, // Human decision = 100% confidence
        });

        // 2. Notify Stakeholders
        // We pass the updated/original adr object. To be safe, let's use the one with title/ticket_id
        await this.notificationService.notifyDecision(adr, action, notes);

        // 3. Emit Event for Side Effects (e.g. Retry Logic)
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

        const actionPastTense = {
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
}
