import { Injectable, Logger } from '@nestjs/common';
import { Adr } from '@/prisma/client';
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

    /**
     * Notify TL of stuck high-risk ADR (existing escalation for time-based)
     * Story 7.3
     */
    async notifyStuckEscalation(adr: Adr) {
        try {
            this.logger.warn(`[ESCALATION] High Risk ADR stuck in review >4h: ${adr.title} (${adr.id}). Escalating to Architect.`);

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

    /**
     * Notify TL of AI escalation due to uncertainty
     * Story 7.6 AC#4
     * @param adr - Escalated ADR
     * @param metadata - Escalation metadata with questions and alternatives
     */
    async notifyEscalation(adr: Adr & { ticket?: { clickup_task_id?: string }; escalation_reason?: string }, metadata: { confidence?: number; questions?: string[]; alternatives?: string[]; aiRecommendation?: string }): Promise<void> {
        try {
            const adrTitle = adr.title || 'Unknown ADR';
            const ticketId = adr.ticket?.clickup_task_id || adr.ticket_id || 'No ticket linked';
            const confidence = metadata.confidence || (adr.ai_confidence || 0) * 100;

            // Build escalation notification message
            const questionsList = metadata.questions?.length > 0
                ? metadata.questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')
                : 'No specific questions provided';

            const alternativesList = metadata.alternatives?.length > 0
                ? metadata.alternatives.map((alt: string, i: number) => `${i + 1}. ${alt}`).join('\n')
                : 'No alternatives documented';

            const notificationMessage = `
🚨 **AI Architecture Escalation**

**Ticket:** ${ticketId}
**Decision:** ${adrTitle}
**Confidence:** ${confidence.toFixed(0)}% (below 70% threshold)
**Uncertainty:** ${adr.escalation_reason || 'Low confidence'}

**AI Questions:**
${questionsList}

**Alternatives Considered:**
${alternativesList}

**AI Recommendation:** ${metadata.aiRecommendation || adr.decision || 'See ADR for details'}

Please review and provide guidance in the architecture review queue.
            `.trim();

            this.logger.log(`Sending escalation notification to TL for ADR ${adr.id}`);
            this.logger.debug(`Notification content: ${notificationMessage}`);

            const listId = await this.resolveListId(ticketId);
            if (listId) {
                await this.clickUp.createTask(listId, {
                    name: `[ESCALATION] Low Confidence ADR: ${adrTitle}`,
                    description: notificationMessage,
                    priority: 1, // Urgent
                    tags: ['architecture-escalation', 'needs-guidance'],
                    notify_all: true,
                    status: 'review' // Ensure it lands in review status
                });
                this.logger.log(`Escalation task created in ClickUp for ADR ${adr.id}`);
            } else {
                this.logger.warn(`Could not resolve ClickUp List ID for ticket ${ticketId}. Notification logged but task not created.`);
            }

            // Also notify PM of blocking delay (AC#4)
            const pmDelayNotification = `
⏸️ **Ticket Blocked - TL Review Required**

**Ticket:** ${ticketId}
**Reason:** AI escalated architecture decision (low confidence)
**Expected Resolution:** 2-4 hours (TL review SLA)

AI is uncertain about technical approach and needs TL guidance before proceeding.
            `.trim();

            this.logger.log(`PM delay notification: ${pmDelayNotification}`);

        } catch (error) {
            this.logger.error('Failed to notify escalation', error);
            // Non-blocking error: don't throw
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

    /**
     * Notify TL of detected AI capability pattern (Story 7.7 C7 fix)
     * @param pattern - Detected failure pattern details
     * @param isCritical - Whether the pattern exceeds critical threshold
     */
    async notifyAiCapabilityPattern(pattern: {
        taskType: string;
        failureRate: number;
        executionsSampled: number;
        patternSignature: string;
        exampleIds: string[];
    }, isCritical: boolean): Promise<void> {
        try {
            const severity = isCritical ? 'CRITICAL' : 'WARNING';
            const action = isCritical ? 'AI has been disabled for this task type' : 'Review recommended';

            const message = `
🚨 **AI Capability ${severity}**: ${pattern.taskType}

**Failure Rate**: ${pattern.failureRate}% (${pattern.executionsSampled} samples)
**Pattern**: ${pattern.patternSignature}
**Action**: ${action}

**Example Execution IDs**:
${pattern.exampleIds.map((id) => `- ${id}`).join('\n')}

Please review these failures and document known issues + workarounds in the capability management dashboard.
            `.trim();

            this.logger.log(`[AI CAPABILITY] ${severity} pattern detected for ${pattern.taskType}`);

            // Create ClickUp task for TL review
            // Note: Using first example execution to resolve project/list
            const firstExecution = await this.prisma.execution.findUnique({
                where: { id: pattern.exampleIds[0] },
                include: { ticket: { include: { project: true } } },
            });

            const listId = firstExecution?.ticket?.project?.clickup_list_id;
            if (listId) {
                await this.clickUp.createTask(listId, {
                    name: `[${severity}] AI Capability Issue: ${pattern.taskType}`,
                    description: message,
                    priority: isCritical ? 1 : 2, // Urgent for critical, High for warning
                    tags: ['ai-capability', 'pattern-detection', severity.toLowerCase()],
                    notify_all: true,
                });
                this.logger.log(`ClickUp task created for ${severity} pattern in ${pattern.taskType}`);
            } else {
                this.logger.warn(`Could not resolve ClickUp List ID for pattern notification. Message logged: ${message}`);
            }
        } catch (error) {
            this.logger.error(`Failed to notify AI capability pattern: ${(error as Error).message}`);
            // Non-blocking - don't throw
        }
    }
}
