import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, Execution, ExecutionStatus, Prisma } from '@/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IExecutionAuditLog } from './interfaces';
import { QAAttempt } from './interfaces'; // WR-6.3

/**
 * Execution Repository
 *
 * Data access layer for execution records using Prisma.
 * Handles CRUD operations and audit logging.
 */
@Injectable()
export class ExecutionRepository {
  private readonly logger = new Logger(ExecutionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a caller-supplied ticket identifier to the internal Ticket UUID that
   * `Execution.ticket_id` foreign-keys to. Accepts either the external PM ticket
   * id (today: ClickUp task id) or the internal UUID, so operators can pass the
   * ClickUp id they already have while internal callers can pass the UUID.
   * Returns null when no ticket matches.
   *
   * NOTE (multi-PM-tool): the external match is ClickUp-specific (`clickup_task_id`).
   * If DSF gains other PM sources (Jira/Asana), generalize this to match on a
   * `(provider, external_id)` pair — this method is the single place that changes.
   */
  async resolveTicketUuid(ticketIdOrExternalId: string): Promise<string | null> {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        OR: [{ id: ticketIdOrExternalId }, { clickup_task_id: ticketIdOrExternalId }],
      },
      select: { id: true },
    });
    return ticket?.id ?? null;
  }

  /**
   * Create a new execution record
   */
  async create(data: {
    ticketId: string;
    provider: AIProvider;
    prompt: string;
    status?: ExecutionStatus;
    maxRetries?: number;
    complexityScore?: number;
  }): Promise<Execution & { ticket?: { project_id: string } }> {
    const execution = await this.prisma.execution.create({
      data: {
        ticket_id: data.ticketId,
        ai_provider: data.provider,
        prompt: data.prompt,
        status: data.status || ExecutionStatus.QUEUED,
        max_retries: data.maxRetries || 3,
        retry_count: 0,
        complexity_score: data.complexityScore,
      },
      include: {
        ticket: {
          select: {
            project_id: true,
          },
        },
      },
    });

    this.logger.log(`Created execution ${execution.id} for ticket ${data.ticketId}`);
    return execution;
  }

  /**
   * Find execution by ID
   */
  async findById(id: string): Promise<(Execution & { ticket?: { project_id: string } }) | null> {
    return this.prisma.execution.findUnique({
      where: { id },
      include: {
        ticket: {
          select: {
            project_id: true,
          },
        },
      },
    });
  }

  /**
   * Find executions by ticket ID
   */
  async findByTicketId(ticketId: string): Promise<Execution[]> {
    return this.prisma.execution.findMany({
      where: { ticket_id: ticketId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Update execution status with timestamp handling.
   *
   * Uses updateMany instead of update to gracefully handle cases where the
   * execution record no longer exists (e.g. container crash cleaned up the
   * record), avoiding Prisma P2025 NotFound errors on startup/shutdown.
   */
  async updateStatus(
    id: string,
    status: ExecutionStatus,
    additionalData?: Partial<{
      confidenceScore: number;
      codeOutput: string;
      filesChanged: string[];
      errorMessage: string;
      branchName: string | null; // WR-4.1: qa_failed_branch for QA_FAILED status
      qaAttempts: QAAttempt[] | null; // WR-6.3
    }>,
  ): Promise<Execution> {
    const updateData: Prisma.ExecutionUpdateManyMutationInput = {
      status,
    };

    // Set appropriate timestamp based on status
    switch (status) {
      case ExecutionStatus.IN_PROGRESS:
        updateData.started_at = new Date();
        break;
      case ExecutionStatus.COMPLETED:
        updateData.completed_at = new Date();
        if (additionalData?.confidenceScore !== undefined) {
          updateData.confidence_score = additionalData.confidenceScore;
        }
        if (additionalData?.codeOutput !== undefined) {
          updateData.code_output = additionalData.codeOutput;
        }
        if (additionalData?.filesChanged !== undefined) {
          updateData.files_changed = additionalData.filesChanged;
        }
        break;
      case ExecutionStatus.QA_FAILED:
        updateData.failed_at = new Date();
        if (additionalData?.errorMessage !== undefined) {
          updateData.error_message = additionalData.errorMessage;
        }
        if (additionalData?.branchName !== undefined) {
          updateData.qa_failed_branch = additionalData.branchName;
        }
        if ('qaAttempts' in (additionalData ?? {})) {
          updateData.qa_attempts = (additionalData?.qaAttempts ??
            Prisma.JsonNull) as unknown as Prisma.InputJsonValue;
        }
        break;
      case ExecutionStatus.FAILED:
      case ExecutionStatus.TIMEOUT:
        updateData.failed_at = new Date();
        if (additionalData?.errorMessage !== undefined) {
          updateData.error_message = additionalData.errorMessage;
        }
        break;
    }

    // updateMany returns { count: 0 } if record not found — no throw (AC6 pattern)
    await this.prisma.execution.updateMany({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Updated execution ${id} status to ${status}`);

    // Re-fetch to satisfy return type; if record was deleted, callers receive null-safe fallback
    const execution = await this.prisma.execution.findUnique({ where: { id } });
    if (!execution) {
      this.logger.warn(`Execution ${id} no longer exists after status update to ${status}`);
      // Return a synthetic shell so callers don't throw — only safe fields needed
      return { id, status } as Execution;
    }
    return execution;
  }

  /**
   * Update execution with partial data (Story 23.2)
   * Used for container assignment and other field updates
   */
  async update(id: string, data: Prisma.ExecutionUpdateInput): Promise<void> {
    await this.prisma.execution.updateMany({
      where: { id },
      data: data as Prisma.ExecutionUpdateManyMutationInput,
    });
  }

  /**
   * Get executions by status
   */
  async findByStatus(
    status: ExecutionStatus,
    options?: { limit?: number; provider?: AIProvider },
  ): Promise<Execution[]> {
    return this.prisma.execution.findMany({
      where: {
        status,
        ...(options?.provider ? { ai_provider: options.provider } : {}),
      },
      take: options?.limit,
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Find active (non-terminal) execution for a ticket
   * Returns the most recent active execution or null if none exists
   */
  async findActiveExecutionByTicketId(ticketId: string): Promise<Execution | null> {
    const activeStatuses: ExecutionStatus[] = [
      ExecutionStatus.QUEUED,
      ExecutionStatus.IN_PROGRESS,
      ExecutionStatus.AWAITING_APPROVAL,
    ];

    const execution = await this.prisma.execution.findFirst({
      where: {
        ticket_id: ticketId,
        status: { in: activeStatuses },
      },
      orderBy: { created_at: 'desc' },
    });

    return execution;
  }

  /**
   * Check if ticket has any active executions
   */
  async hasActiveExecution(ticketId: string): Promise<boolean> {
    const count = await this.prisma.execution.count({
      where: {
        ticket_id: ticketId,
        status: {
          in: [
            ExecutionStatus.QUEUED,
            ExecutionStatus.IN_PROGRESS,
            ExecutionStatus.AWAITING_APPROVAL,
          ],
        },
      },
    });
    return count > 0;
  }

  /**
   * Find all active executions
   */
  async findActiveExecutions(): Promise<Execution[]> {
    return this.prisma.execution.findMany({
      where: {
        status: {
          in: [
            ExecutionStatus.QUEUED,
            ExecutionStatus.IN_PROGRESS,
            ExecutionStatus.AWAITING_APPROVAL,
            ExecutionStatus.QA_FAILED,
          ],
        },
      },
      orderBy: { created_at: 'desc' },
      include: {
        ticket: {
          select: {
            project_id: true,
          },
        },
      },
    });
  }

  /**
   * Get active execution count per provider
   */
  async getActiveCountByProvider(): Promise<Record<AIProvider, number>> {
    const results = await this.prisma.execution.groupBy({
      by: ['ai_provider'],
      where: {
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
      },
      _count: true,
    });

    // Initialize with zeros for all valid AIProvider values
    const counts: Record<AIProvider, number> = {
      [AIProvider.CLAUDE_CODE]: 0,
      [AIProvider.GEMINI]: 0,
      [AIProvider.CODEX]: 0,
      [AIProvider.KIMI]: 0,
      [AIProvider.OPENHARNESS]: 0,
    } as Record<AIProvider, number>;

    // Fill in actual counts
    for (const result of results) {
      if (result.ai_provider in counts) {
        counts[result.ai_provider] = result._count;
      }
    }

    return counts;
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(log: IExecutionAuditLog): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entity_type: log.entityType,
        entity_id: log.entityId,
        action: log.action,
        actor_type: log.actorType,
        actor_id: log.actorId,
        before_state: (log.beforeState ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after_state: log.afterState as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Update ticket status based on execution
   */
  async updateTicketStatus(ticketId: string, status: string): Promise<void> {
    // Map execution-related statuses to ticket statuses
    const ticketStatusMap = new Map<string, string>([
      ['QUEUED', 'QUEUED'],
      ['IN_PROGRESS', 'AI_PROCESSING'],
      ['COMPLETED', 'QA_REVIEW'], // Move to QA after AI completes
      ['FAILED', 'FAILED'],
      ['TIMEOUT', 'FAILED'],
      ['CANCELLED', 'FAILED'], // Cancelled executions mark ticket as failed
    ]);

    const ticketStatus = ticketStatusMap.get(status);
    if (ticketStatus) {
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: ticketStatus as 'QUEUED' | 'AI_PROCESSING' | 'QA_REVIEW' | 'FAILED' },
      });
      this.logger.log(`Updated ticket ${ticketId} status to ${ticketStatus}`);
    }
  }
}
