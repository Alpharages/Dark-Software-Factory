import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AICostTrackerService } from '../cost-tracking/ai-cost-tracker.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { ExecutionService } from '../execution/execution.service';
import { TicketStatus } from '../prisma/enums';
// import { Ticket } from '@prisma/client'; // Ticket type usually inferred or from client

export interface DecisionDto {
    decision: 'APPROVE' | 'REJECT' | 'OVERRIDE';
    reason?: string;
    override?: boolean;
}

@Injectable()
export class DecisionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly costTracker: AICostTrackerService,
        private readonly decisionLogger: AIDecisionLoggerService,
        private readonly executionService: ExecutionService,
    ) { }

    async getPendingTickets() {
        // Requirements: Status BLOCKED_COST, BLOCKED_RISK, or PENDING_APPROVAL
        // Adjusting status enum based on schema: BLOCKED_COST isn't in schema enum I saw...
        // Schema enum TicketStatus: BLOCKED_CIRCULAR, WAITING_FOR_LOCKS, AWAITING_APPROVAL.
        // Story says BLOCKED_COST, which might map to AWAITING_APPROVAL or needs a new status?
        // The story mentions "BLOCKED_COST" but the schema enum I saw earlier in 6-R-2-go-no-go-decision-dashboard.md context check...
        // Wait, let me check the SCHEMA again. ticket-intake showed TicketStatus enum.
        // TicketStatus: RECEIVED, VALIDATED, VALIDATION_FAILED, BLOCKED_CIRCULAR, WAITING, WAITING_FOR_LOCKS, QUEUED, AI_PROCESSING, QA_REVIEW, QA_FAILED, GITHUB_PUSH, DEPLOYING, DEPLOYED, MONITORING, AWAITING_APPROVAL, APPROVED, REJECTED, AWAITING_REWORK, FAILED, COMPLETED.
        // There is no BLOCKED_COST in the schema I read!
        // But Story 6-R-1 implemented "Automatic Cost Cap Enforcement". I should check if it added a status.
        // I will assume AWAITING_APPROVAL is the target status for now, or maybe they added BLOCKED_COST?
        // I'll check schema again or just query AWAITING_APPROVAL and filter.
        // Actually, I'll allow AWAITING_APPROVAL and maybe check if 6-R-1 added BLOCKED_COST. The schema I read was potentially old? No, I viewed it.
        // Line 75 in schema: TicketStatus enum. It only has AWAITING_APPROVAL.
        // So I will use AWAITING_APPROVAL. 6-R-1 might have used that.

        const tickets = await this.prisma.ticket.findMany({
            where: {
                status: { in: [TicketStatus.AWAITING_APPROVAL] },
            },
            include: { project: true },
        });

        // Enrich with cost estimates
        const enrichedTickets = await Promise.all(
            tickets.map(async (ticket) => {
                const costStats = await this.costTracker.getCostStats(ticket.id);
                return { ...ticket, costStats };
            }),
        );

        return enrichedTickets;
    }

    async processDecision(ticketId: string, userId: string, userRole: string, decisionDto: DecisionDto) {
        const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
            throw new NotFoundException(`Ticket ${ticketId} not found`);
        }

        const { decision, reason, override } = decisionDto;
        let newStatus: TicketStatus;

        if (decision === 'APPROVE' || decision === 'OVERRIDE') {
            newStatus = TicketStatus.QUEUED; // Transition to QUEUED to resume execution (or IN_PROGRESS?)
            // Story says "Transition status to IN_PROGRESS (or QUEUED)"
        } else {
            newStatus = TicketStatus.REJECTED;
        }

        // Update status
        await this.prisma.ticket.update({
            where: { id: ticketId },
            data: { status: newStatus },
        });

        // Log decision with AC#3 required fields: userId, action, reason, was_override
        await this.decisionLogger.logDecision({
            agentName: `Human${userRole}`, // Use actual role instead of hardcoded
            action: decision,
            reasoning: reason || 'Manual decision',
            ticketId: ticket.id,
            inputData: {
                userId,  // AC#3 requirement
                action: decision,  // AC#3 requirement
                reason: reason || 'No reason provided',  // AC#3 requirement
                was_override: override || false,  // AC#3 requirement - was missing!
            },
            outputData: { newStatus },
            confidence: 1.0,
        });

        // Resume execution if approved
        if (newStatus === TicketStatus.QUEUED) {
            await this.executionService.resumeExecution(ticketId);
        }

        return { ...ticket, status: newStatus };
    }
}
