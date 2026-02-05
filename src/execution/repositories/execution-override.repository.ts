import { Injectable } from '@nestjs/common';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ExecutionOverride } from '@/prisma/client';

export interface CreateExecutionOverrideInput {
  executionId: string;
  userId: string;
  originalDecision?: string | null;
  newDecision: string;
  reason: string;
  overrideData?: Record<string, unknown>;
}

/**
 * Repository for ExecutionOverride operations
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
@Injectable()
export class ExecutionOverrideRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new execution override record
   *
   * @param data - Override data
   * @returns Created override record
   */
  async create(data: CreateExecutionOverrideInput): Promise<ExecutionOverride> {
    return this.prisma.executionOverride.create({
      data: {
        executionId: data.executionId,
        userId: data.userId,
        originalDecision: data.originalDecision ?? null,
        newDecision: data.newDecision,
        reason: data.reason,
        overrideData: data.overrideData as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Find all overrides for a specific execution
   *
   * @param executionId - Execution ID
   * @returns Array of override records
   */
  async findByExecutionId(executionId: string): Promise<ExecutionOverride[]> {
    return this.prisma.executionOverride.findMany({
      where: { executionId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            full_name: true,
          },
        },
      },
      orderBy: { overriddenAt: 'desc' },
    });
  }

  /**
   * Find all overrides by a specific user
   *
   * @param userId - User ID
   * @returns Array of override records
   */
  async findByUserId(userId: string): Promise<ExecutionOverride[]> {
    return this.prisma.executionOverride.findMany({
      where: { userId },
      include: {
        execution: {
          select: {
            id: true,
            ticket_id: true,
            status: true,
          },
        },
      },
      orderBy: { overriddenAt: 'desc' },
    });
  }

  /**
   * Find a specific override by ID
   *
   * @param id - Override ID
   * @returns Override record or null
   */
  async findById(id: string): Promise<ExecutionOverride | null> {
    return this.prisma.executionOverride.findUnique({
      where: { id },
      include: {
        execution: {
          select: {
            id: true,
            ticket_id: true,
            status: true,
            ai_provider: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            full_name: true,
          },
        },
      },
    });
  }

  /**
   * Get the most recent override for an execution
   *
   * @param executionId - Execution ID
   * @returns Most recent override or null
   */
  async findMostRecentForExecution(executionId: string): Promise<ExecutionOverride | null> {
    const overrides = await this.prisma.executionOverride.findMany({
      where: { executionId },
      orderBy: { overriddenAt: 'desc' },
      take: 1,
    });

    return overrides[0] ?? null;
  }
}
