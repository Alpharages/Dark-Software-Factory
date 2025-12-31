import { Injectable, Logger } from '@nestjs/common';
import { Adr, Ticket } from '@/prisma/client';
import { ClickUpService } from '../clickup/clickup.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ArchitectureReviewNotificationService {
    private readonly logger = new Logger(ArchitectureReviewNotificationService.name);

    constructor(
        private readonly clickUp: ClickUpService,
        private readonly prisma: PrismaService,
    ) { }

    async notifyHighRiskAdr(adr: Adr) {
        try {
            this.logger.log(`[NOTIFICATION] High Risk ADR Created: ${adr.title} (${adr.id}). Review required.`);

            const listId = await this.resolveListId(adr.ticket_id);
            if (!listId) {
                this.logger.warn(`Could not resolve ClickUp List ID for ADR ${adr.id}. Skipping task creation.`);
                return;
            }

            const description = `
# 🚨 High Risk Architecture Decision Required

**Title:** ${adr.title}
**Context:** ${adr.context}
**Risk Level:** HIGH
**Status:** ${adr.status}

[View ADR Details](/architecture/adr/${adr.id})

**Action Required:**
TL Review is mandatory before implementation proceeds.
            `;

            await this.clickUp.createTask(listId, {
                name: `[Review] High Risk ADR: ${adr.title}`,
                description: description,
                priority: 1, // Urgent
                tags: ['architecture-review', 'high-risk'],
                notify_all: true,
            });

        } catch (error) {
            this.logger.error(`Failed to notify High Risk ADR: ${(error as Error).message}`);
        }
    }

    async notifyEscalation(adr: Adr) {
        try {
            this.logger.warn(`[ESCALATION] High Risk ADR stuck in review > 4h: ${adr.title} (${adr.id}). Escalating to Architect.`);

            const listId = await this.resolveListId(adr.ticket_id);
            if (!listId) return;

            const description = `
# 🔥 ESCALATION: Stuck High Risk ADR

**Title:** ${adr.title}
**Waittime:** > 4 hours
**Target:** Architect Review

This decision has been pending review for too long and is blocking progress.
            `;

            await this.clickUp.createTask(listId, {
                name: `[ESCALATE] Stuck ADR: ${adr.title}`,
                description: description,
                priority: 1, // Urgent
                tags: ['escalation', 'architect-review'],
                notify_all: true,
            });

        } catch (error) {
            this.logger.error(`Failed to notify Escalation: ${(error as Error).message}`);
        }
    }

    private async resolveListId(ticketId: string | null): Promise<string | null> {
        if (!ticketId) return null;

        const ticket = await this.prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { project: true },
        });

        return ticket?.project?.clickup_list_id || null;
    }

    async notifyDecision(adr: Adr, action: string, notes?: string) {
        try {
            this.logger.log(`[DECISION] ADR ${adr.id} ${action}. Notifying stakeholders.`);

            const listId = await this.resolveListId(adr.ticket_id);
            if (!listId) return;

            const isApproved = action === 'APPROVE';
            const icon = isApproved ? '✅' : '❌';
            const title = `[Decision] ADR ${adr.title}: ${action}`;

            let description = `
# ${icon} Architecture Decision: ${action}

**ADR:** ${adr.title}
**Status:** ${action === 'APPROVE' ? 'APPROVED' : 'REJECTED/MODIFIED'}
            `;

            if (notes) {
                description += `\n**Feedback/Notes:**\n${notes}\n`;
            }

            // Tag the PM/Owner if possible (mocking tag for now)
            if (!isApproved) {
                description += `\n\n@watchers Please review the feedback.`;
            }

            await this.clickUp.createTask(listId, {
                name: title,
                description: description,
                priority: isApproved ? 3 : 1, // Normal if approved, Urgent if rejected
                tags: ['architecture-decision', action.toLowerCase()],
                notify_all: true,
            });

        } catch (error) {
            this.logger.error(`Failed to notify ADR Decision: ${(error as Error).message}`);
        }
    }
}
