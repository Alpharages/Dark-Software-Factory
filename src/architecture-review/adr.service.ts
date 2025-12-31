import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAdrDto, UpdateAdrDto } from './dto';
import { Prisma } from '@/prisma/client';

@Injectable()
export class AdrService {
    private readonly logger = new Logger(AdrService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Create a new Architecture Decision Record
     * @param createAdrDto - ADR creation data
     * @returns Created ADR
     */
    async create(createAdrDto: CreateAdrDto) {
        this.logger.log(`Creating ADR: ${createAdrDto.title}`);

        // Calculate risk level if not provided
        const riskLevel = createAdrDto.risk_level || this.calculateRiskLevel(createAdrDto);

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
     * Calculate risk level based on ADR content
     * Logic: High if new_dependencies or schema_changes; Medium if refactoring; Low otherwise
     * @param adr - ADR DTO
     * @returns Risk level (HIGH/MEDIUM/LOW)
     */
    calculateRiskLevel(adr: CreateAdrDto): string {
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
}
