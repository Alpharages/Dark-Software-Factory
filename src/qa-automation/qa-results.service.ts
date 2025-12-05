import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { QAResult, Prisma } from '@prisma/client';

@Injectable()
export class QaResultsService {
  private readonly logger = new Logger(QaResultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveResult(
    executionId: string,
    result: Omit<Prisma.QAResultCreateInput, 'execution_id'>,
  ): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: result,
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: result.linting_passed ?? false,
          tests_passed: result.tests_passed ?? false,
          code_review_passed: result.code_review_passed ?? false,
          overall_passed: result.overall_passed ?? false,
          linting_errors: result.linting_errors,
          test_results: result.test_results,
          test_coverage: result.test_coverage,
          code_review_issues: result.code_review_issues,
        },
      });
    }
  }

  async getResult(executionId: string): Promise<QAResult> {
    const result = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });
    if (!result) throw new NotFoundException(`QA result not found for execution ${executionId}`);
    return result;
  }

  async getResultsByTicket(ticketId: string): Promise<QAResult[]> {
    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: ticketId },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    return this.prisma.qAResult.findMany({
      where: { execution_id: { in: executionIds } },
      orderBy: { created_at: 'desc' },
    });
  }

  async getResultsByProject(
    projectId: string,
    filters?: { status?: 'passed' | 'failed' },
  ): Promise<QAResult[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: { project_id: projectId },
      select: { id: true },
    });
    const ticketIds = tickets.map((t) => t.id);

    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: { in: ticketIds } },
      select: { id: true },
    });
    const executionIds = executions.map((e) => e.id);

    return this.prisma.qAResult.findMany({
      where: {
        execution_id: { in: executionIds },
        ...(filters?.status === 'passed' && { overall_passed: true }),
        ...(filters?.status === 'failed' && { overall_passed: false }),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async overrideQualityGate(
    executionId: string,
    reason: string,
    approvedBy: string,
  ): Promise<void> {
    // Update QA result to passed (emergency override)
    await this.prisma.qAResult.updateMany({
      where: { execution_id: executionId },
      data: { overall_passed: true },
    });

    // Create audit log for override
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'qa_result',
        entity_id: executionId,
        action: 'quality_gate_override',
        actor_type: 'user',
        actor_id: approvedBy,
        after_state: { reason, overrideAt: new Date().toISOString() },
      },
    });

    this.logger.warn(
      `Quality gate override for execution ${executionId} by ${approvedBy}: ${reason}`,
    );
  }
}
