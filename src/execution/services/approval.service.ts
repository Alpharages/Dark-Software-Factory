import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionTrackerService } from '../execution-tracker.service';
import { TicketStatus, ExecutionStatus, ApprovalDecision } from '@/prisma/client';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '@/rabbitmq/rabbitmq.config';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { Cron } from '@nestjs/schedule'; // AC#4: Automatic escalation

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly rabbitPublisher: RabbitMQPublisherService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  async approve(executionId: string, pmId: string, reasoning?: string) {
    const execution = await this.getExecutionWithTicket(executionId);

    // Verify status
    if (execution.status !== ExecutionStatus.AWAITING_APPROVAL) {
      throw new BadRequestException(
        `Execution is not awaiting approval (current: ${execution.status})`,
      );
    }

    // 1. Create Approval Record
    await this.prisma.approvalRecord.create({
      data: {
        execution_id: executionId,
        pm_id: pmId,
        decision: ApprovalDecision.APPROVE,
        reasoning,
      },
    });

    // 2. Update statuses
    await this.executionTracker.markAwaitingApproval(
      executionId,
      'manual-approval',
      'Approved by PM',
    ); // Reuse method or create markApproved
    // Actually, let's just use repository and update statuses directly for specific approval flows
    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.COMPLETED },
    });

    await this.prisma.ticket.update({
      where: { id: execution.ticket_id },
      data: { status: TicketStatus.GITHUB_PUSH },
    });

    // 3. Trigger GitHub Push
    await this.rabbitPublisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.GITHUB_PUSH_TRIGGER,
      {
        executionId,
        ticketId: execution.ticket_id,
        correlationId: 'manual-approval',
        timestamp: Date.now(),
      },
    );

    this.logger.log(`Execution ${executionId} approved by PM ${pmId}`);
    return { success: true, status: TicketStatus.GITHUB_PUSH };
  }

  async reject(executionId: string, pmId: string, reasoning: string) {
    const execution = await this.getExecutionWithTicket(executionId);

    await this.prisma.approvalRecord.create({
      data: {
        execution_id: executionId,
        pm_id: pmId,
        decision: ApprovalDecision.REJECT,
        reasoning,
      },
    });

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.FAILED, error_message: reasoning },
    });

    await this.prisma.ticket.update({
      where: { id: execution.ticket_id },
      data: { status: TicketStatus.FAILED },
    });

    this.logger.log(`Execution ${executionId} rejected by PM ${pmId}`);
    return { success: true, status: TicketStatus.FAILED };
  }

  async rework(executionId: string, pmId: string, feedback: string) {
    const execution = await this.getExecutionWithTicket(executionId);

    await this.prisma.approvalRecord.create({
      data: {
        execution_id: executionId,
        pm_id: pmId,
        decision: ApprovalDecision.REWORK,
        reasoning: feedback,
      },
    });

    // Transition to AWAITING_REWORK
    await this.prisma.ticket.update({
      where: { id: execution.ticket_id },
      data: { status: TicketStatus.AWAITING_REWORK },
    });

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.QUEUED, retry_count: { increment: 1 } },
    });

    // AC#7: Emit retry event with feedback context
    await this.rabbitPublisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_EXECUTION_RETRY,
      {
        type: 'AI_EXECUTION_RETRY',
        executionId,
        ticketId: execution.ticket_id,
        correlationId: `rework-${executionId.substring(0, 8)}`,
        context: {
          ticketId: execution.ticket_id,
          originalRequestTime: new Date(),
          previousErrors: [],
          cumulativeDurationMs: 0,
          retryCount: execution.retry_count + 1,
          feedback, // AC#7: Inject feedback
        },
        scheduledAt: new Date().toISOString(),
        delayMs: 0,
      },
    );

    this.logger.log(`Execution ${executionId} sent for rework by PM ${pmId}`);
    return { success: true, status: TicketStatus.AWAITING_REWORK };
  }

  /**
   * AC#4: Automatic escalation for reviews pending > 2 hours
   */
  @Cron('0 */15 * * * *')
  async handleAutomaticEscalations() {
    this.logger.log('Checking for stale approval requests...');

    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const staleExecutions = await this.prisma.execution.findMany({
      where: {
        status: ExecutionStatus.AWAITING_APPROVAL,
        updated_at: { lt: twoHoursAgo },
      },
      include: { ticket: true },
    });

    if (staleExecutions.length === 0) return;

    this.logger.log(`Found ${staleExecutions.length} stale approvals. Escalating...`);

    for (const execution of staleExecutions) {
      try {
        await this.escalate(
          execution.id,
          'SYSTEM_AUTO_ESCALATOR',
          'Automatic escalation: Approval pending for more than 2 hours.',
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        this.logger.error(
          `Failed to automatically escalate execution ${execution.id}: ${err.message}`,
        );
      }
    }
  }

  async escalate(executionId: string, pmId: string, reason: string) {
    const execution = await this.getExecutionWithTicket(executionId);

    await this.prisma.approvalRecord.create({
      data: {
        execution_id: executionId,
        pm_id: pmId,
        decision: ApprovalDecision.ESCALATE,
        reasoning: reason,
      },
    });

    // Log escalation to AIDecisionLog
    await this.aiDecisionLogger.logDecision({
      agentName: 'ApprovalService',
      action: 'escalation',
      reasoning: `PM ${pmId} escalated execution ${executionId}: ${reason}`,
      ticketId: execution.ticket_id,
      executionId,
      inputData: { pmId, reason },
      outputData: { escalated: true },
      confidence: 1.0,
    });

    this.logger.log(`Execution ${executionId} escalated by PM ${pmId}`);
    return { success: true, escalated: true };
  }

  private async getExecutionWithTicket(executionId: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: true },
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    return execution;
  }
}
