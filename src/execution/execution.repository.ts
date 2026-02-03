import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, ExecutionStatus, Execution, Prisma } from '@/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IExecutionAuditLog } from './interfaces';

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
   * Create a new execution record
   */
  async create(data: {
    ticketId: string;
    provider: AIProvider;
    prompt: string;
    status?: ExecutionStatus;
    maxRetries?: number;
    complexityScore?: number;
  }): Promise<Execution> {
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
    });

    this.logger.log(`Created execution ${execution.id} for ticket ${data.ticketId}`);
    return execution;
  }

  /**
   * Find execution by ID
   */
  async findById(id: string): Promise<Execution | null> {
    return this.prisma.execution.findUnique({
      where: { id },
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
   * Update execution status with timestamp handling
   */
  async updateStatus(
    id: string,
    status: ExecutionStatus,
    additionalData?: Partial<{
      confidenceScore: number;
      codeOutput: string;
      filesChanged: string[];
      errorMessage: string;
    }>,
  ): Promise<Execution> {
    const updateData: Prisma.ExecutionUpdateInput = {
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
      case ExecutionStatus.FAILED:
      case ExecutionStatus.TIMEOUT:
        updateData.failed_at = new Date();
        if (additionalData?.errorMessage !== undefined) {
          updateData.error_message = additionalData.errorMessage;
        }
        break;
    }

    const execution = await this.prisma.execution.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Updated execution ${id} status to ${status}`);
    return execution;
  }

  /**
   * Update execution with partial data (Story 23.2)
   * Used for container assignment and other field updates
   */
  async update(id: string, data: Prisma.ExecutionUpdateInput): Promise<Execution> {
    const execution = await this.prisma.execution.update({
      where: { id },
      data,
    });
    return execution;
  }

  /**
   * Increment retry count and reset to QUEUED
   */
  async incrementRetryAndRequeue(id: string): Promise<Execution> {
    return this.prisma.execution.update({
      where: { id },
      data: {
        retry_count: { increment: 1 },
        status: ExecutionStatus.QUEUED,
        // Clear failure timestamps for retry
        failed_at: null,
        error_message: null,
      },
    });
  }

  /**
   * Check if execution can retry
   */
  async canRetry(
    id: string,
  ): Promise<{ canRetry: boolean; retryCount: number; maxRetries: number }> {
    const execution = await this.prisma.execution.findUnique({
      where: { id },
      select: { retry_count: true, max_retries: true, status: true },
    });

    if (!execution) {
      return { canRetry: false, retryCount: 0, maxRetries: 0 };
    }

    return {
      canRetry: execution.retry_count < execution.max_retries,
      retryCount: execution.retry_count,
      maxRetries: execution.max_retries,
    };
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

    // Initialize with zeros
    const counts: Record<AIProvider, number> = {
      [AIProvider.CURSOR_HEADLESS]: 0,
      [AIProvider.CLAUDE_CODE]: 0,
    } as Record<AIProvider, number>;

    // Fill in actual counts
    for (const result of results) {
      counts[result.ai_provider] = result._count;
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
