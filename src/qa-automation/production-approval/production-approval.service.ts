import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { DeploymentOrchestrator } from '@/github/services/deployment-orchestrator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { TicketStatus, ApprovalDecision, ProductionApproval } from '../../prisma/client';
import { TriggerDeploymentDto } from '@/github/dto/trigger-deployment.dto';

export interface IGateCheckResult {
  ready: boolean;
  overallPassed: boolean;
  blockingReason?: string;
  qaResultId?: string;
}

@Injectable()
export class ProductionApprovalService {
  private readonly logger = new Logger(ProductionApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deploymentOrchestrator: DeploymentOrchestrator,
    private readonly clickUpService: ClickUpService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  /**
   * Check if a ticket is ready for production approval
   */
  async checkReadiness(ticketId: string): Promise<IGateCheckResult> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        executions: {
          orderBy: { created_at: 'desc' },
          take: 1,
          include: { qa_result: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const execution = ticket.executions[0];

    if (!execution || !execution.qa_result) {
      return {
        ready: false,
        overallPassed: false,
        blockingReason: 'No QA result found for this ticket/execution',
      };
    }

    return {
      ready: true,
      overallPassed: execution.qa_result.overall_passed,
      qaResultId: execution.qa_result.id,
      blockingReason: execution.qa_result.overall_passed
        ? undefined
        : 'Quality Gates failed (requires manual override)',
    };
  }

  /**
   * Approve a release for production deployment
   */
  async approveRelease(
    ticketId: string,
    approverId: string,
    overrideReason?: string,
  ): Promise<ProductionApproval> {
    this.logger.log(`Processing approval for ticket ${ticketId} by ${approverId}`);

    const readiness = await this.checkReadiness(ticketId);
    if (!readiness.ready) {
      throw new BadRequestException(`Ticket is not ready: ${readiness.blockingReason}`);
    }

    if (!readiness.overallPassed && !overrideReason) {
      throw new BadRequestException('Cannot approve failed QA without override reason');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        project: true,
        executions: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    const execution = ticket.executions[0]; // Guaranteed by checkReadiness logic logic partially but explicit check is safer
    if (!execution) throw new BadRequestException('Execution context missing');

    // 1. Create Approval Record
    const approval = await this.prisma.productionApproval.create({
      data: {
        ticket_id: ticketId,
        approver_id: approverId,
        decision: ApprovalDecision.APPROVE,
        override_reason: overrideReason,
      },
    });

    // 2. Log Decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'ProductionApprovalService',
      action: 'manual_approval',
      reasoning: overrideReason ? `Manual override: ${overrideReason}` : 'Standard approval',
      ticketId,
      executionId: execution.id,
      inputData: { readiness, overrideReason, approverId },
      outputData: { approvalId: approval.id, decision: 'APPROVE' },
      confidence: 1.0,
    });

    // 3. Trigger Deployment
    const ghPush = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: execution.id },
      orderBy: { created_at: 'desc' },
    });

    if (!ghPush) {
      // Fallback: If no push record, we can't deploy automatically via this flow
      throw new BadRequestException('No GitHub push record found to trigger deployment');
    }

    if (!ghPush.commit_sha) {
      throw new InternalServerErrorException('GitHub push record is missing commit SHA');
    }

    const deploymentDto: TriggerDeploymentDto = {
      githubPushId: ghPush.id,
      repository: ghPush.repository,
      branchName: ghPush.branch_name,
      commitSha: ghPush.commit_sha,
      environment: 'production',
      ticketId: ticketId,
      executionId: execution.id,
    };

    try {
      await this.deploymentOrchestrator.triggerDeployment(deploymentDto);

      // Update statuses
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.APPROVED },
      });

      // Non-blocking ClickUp update
      this.clickUpService
        .updateStatus(ticket.clickup_task_id, 'APPROVED')
        .catch((e) => this.logger.error(`Failed to update ClickUp status: ${e.message}`));
      this.clickUpService
        .addComment(
          ticket.clickup_task_id,
          `**PRODUCTION APPROVED**\n\nApproved by: ${approverId}\nOverride: ${overrideReason || 'None'}`,
        )
        .catch((e) => this.logger.error(`Failed to add ClickUp comment: ${e.message}`));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to trigger deployment: ${err.message}`);
      throw error;
    }

    return approval;
  }

  /**
   * Reject a release
   */
  async rejectRelease(
    ticketId: string,
    approverId: string,
    rejectionReason: string,
  ): Promise<ProductionApproval> {
    this.logger.log(`Processing rejection for ticket ${ticketId} by ${approverId}`);

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    // 1. Create Approval Record
    const approval = await this.prisma.productionApproval.create({
      data: {
        ticket_id: ticketId,
        approver_id: approverId,
        decision: ApprovalDecision.REJECT,
        override_reason: rejectionReason,
      },
    });

    // 2. Log Decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'ProductionApprovalService',
      action: 'manual_rejection',
      reasoning: `Rejection: ${rejectionReason}`,
      ticketId,
      inputData: { rejectionReason, approverId },
      outputData: { approvalId: approval.id, decision: 'REJECT' },
      confidence: 1.0,
    });

    // 3. Update External State
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.REJECTED },
    });

    this.clickUpService
      .updateStatus(ticket.clickup_task_id, 'REJECTED')
      .catch((e) => this.logger.error(`Failed to update ClickUp status: ${e.message}`));
    this.clickUpService
      .addComment(
        ticket.clickup_task_id,
        `**PRODUCTION REJECTED**\n\nRejected by: ${approverId}\nReason: ${rejectionReason}`,
      )
      .catch((e) => this.logger.error(`Failed to add ClickUp comment: ${e.message}`));

    return approval;
  }
}
