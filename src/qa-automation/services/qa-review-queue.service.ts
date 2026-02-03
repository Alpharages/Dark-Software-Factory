/**
 * QA Review Queue Service
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * Manages the QA review queue:
 * - Queue population from QA execution results
 * - Claim/assign workflow
 * - Status transitions
 * - Queue querying with filters
 */

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@/prisma/client';
import { QaReviewStatus, RiskLevel, SamplingStrategy } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/logger/logger.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { QA_METRICS } from '../../common/metrics/metrics.constants';
import { IQueueItem, IQueueQuery, IQueuePageResponse } from '../interfaces/qa-sampling.interface';

/**
 * Queue entry input for creating new entries
 */
interface IQueueEntryInput {
  ticketId: string;
  executionId: string;
  projectId?: string;
  prId?: string;
  prUrl?: string;
  riskLevel: RiskLevel;
  riskFactors: string[];
  samplingStrategy: SamplingStrategy;
}

/**
 * Queue status transition
 */
type QueueStatusTransition = {
  from: QaReviewStatus;
  to: QaReviewStatus;
  allowed: boolean;
};

/**
 * Valid status transitions
 */
const VALID_TRANSITIONS: QueueStatusTransition[] = [
  { from: QaReviewStatus.PENDING, to: QaReviewStatus.IN_REVIEW, allowed: true },
  { from: QaReviewStatus.PENDING, to: QaReviewStatus.APPROVED, allowed: true },
  { from: QaReviewStatus.PENDING, to: QaReviewStatus.REJECTED, allowed: true },
  { from: QaReviewStatus.IN_REVIEW, to: QaReviewStatus.APPROVED, allowed: true },
  { from: QaReviewStatus.IN_REVIEW, to: QaReviewStatus.REJECTED, allowed: true },
  { from: QaReviewStatus.IN_REVIEW, to: QaReviewStatus.PENDING, allowed: true }, // Unclaim
];

@Injectable()
export class QaReviewQueueService {
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    @InjectMetric(QA_METRICS.REVIEW_QUEUE_DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric(QA_METRICS.REVIEW_TICKETS_SAMPLED_TOTAL)
    private readonly ticketsSampledCounter: Counter<string>,
    @InjectMetric(QA_METRICS.REVIEW_TICKETS_BY_RISK_TOTAL)
    private readonly ticketsByRiskCounter: Counter<string>,
    @InjectMetric(QA_METRICS.REVIEW_QUEUE_DURATION_SECONDS)
    private readonly queueDurationHistogram: Histogram<string>,
    @InjectMetric(QA_METRICS.REVIEW_DECISIONS_TOTAL)
    private readonly decisionsCounter: Counter<string>,
  ) {
    this.defaultPageSize = this.configService.get<number>('qaReview.queue.defaultPageSize', 20);
    this.maxPageSize = this.configService.get<number>('qaReview.queue.maxPageSize', 100);
  }

  /**
   * Create a new queue entry
   * Called when a ticket passes QA and is selected for sampling
   * @param input - Queue entry data
   * @returns Created queue item
   */
  async createEntry(input: IQueueEntryInput): Promise<IQueueItem> {
    this.logger.debug(`Creating queue entry for execution ${input.executionId}`);

    try {
      // Check for duplicate
      const existing = await this.prisma.qaReviewQueue.findUnique({
        where: { execution_id: input.executionId },
      });

      if (existing) {
        this.logger.warn(`Queue entry already exists for execution ${input.executionId}`);
        throw new ConflictException(
          `Queue entry already exists for execution ${input.executionId}`,
        );
      }

      // Get ticket info for title
      const execution = await this.prisma.execution.findUnique({
        where: { id: input.executionId },
        include: {
          ticket: {
            select: {
              title: true,
              clickup_task_id: true,
            },
          },
        },
      });

      const entry = await this.prisma.qaReviewQueue.create({
        data: {
          ticket_id: input.ticketId,
          execution_id: input.executionId,
          project_id: input.projectId,
          pr_id: input.prId,
          pr_url: input.prUrl,
          status: QaReviewStatus.PENDING,
          risk_level: input.riskLevel,
          risk_factors: input.riskFactors as Prisma.InputJsonValue,
          sampling_strategy: input.samplingStrategy,
        },
      });

      // Record metrics
      this.ticketsSampledCounter.inc({
        strategy: input.samplingStrategy.toLowerCase(),
        risk_level: input.riskLevel.toLowerCase(),
      });
      this.ticketsByRiskCounter.inc({
        risk_level: input.riskLevel.toLowerCase(),
      });

      this.logger.debug(`Created queue entry ${entry.id} for execution ${input.executionId}`);

      return this.mapToInterface(entry, execution?.ticket?.title);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Failed to create queue entry for execution ${input.executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      if (error instanceof Error) {
        this.sentry.captureException(error);
      }
      throw error;
    }
  }

  /**
   * Get queue entry by ID
   * @param id - Queue entry ID
   * @returns Queue item
   */
  async getById(id: string): Promise<IQueueItem> {
    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${id} not found`);
    }

    return this.mapToInterface(entry, entry.execution?.ticket?.title);
  }

  /**
   * Get queue entry by execution ID
   * @param executionId - Execution ID
   * @returns Queue item or null
   */
  async getByExecutionId(executionId: string): Promise<IQueueItem | null> {
    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { execution_id: executionId },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return null;
    }

    return this.mapToInterface(entry, entry.execution?.ticket?.title);
  }

  /**
   * Query queue with filters and pagination
   * @param query - Query options
   * @returns Paginated queue items
   */
  async queryQueue(query: IQueueQuery): Promise<IQueuePageResponse> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || this.defaultPageSize, this.maxPageSize);
    const skip = (page - 1) * limit;

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (query.status) {
      where.status = query.status.toUpperCase();
    }

    if (query.riskLevel) {
      where.risk_level = query.riskLevel.toUpperCase();
    }

    if (query.projectId) {
      where.project_id = query.projectId;
    }

    if (query.aiProvider) {
      where.execution = {
        ai_provider: query.aiProvider.toUpperCase(),
      };
    }

    if (query.startDate || query.endDate) {
      where.created_at = {};
      if (query.startDate) {
        where.created_at.gte = query.startDate;
      }
      if (query.endDate) {
        where.created_at.lte = query.endDate;
      }
    }

    // Build order by
    const sortBy = query.sortBy || 'risk_level';
    const sortOrder = query.sortOrder || 'desc';

    // For risk_level sorting, we need custom ordering
    let orderBy: Prisma.QaReviewQueueOrderByWithRelationInput;
    if (sortBy === 'risk_level') {
      // Order by risk level (HIGH > MEDIUM > LOW)
      orderBy = {
        risk_level: sortOrder as Prisma.SortOrder,
      };
    } else {
      orderBy = {
        created_at: sortOrder as Prisma.SortOrder,
      };
    }

    const [entries, total] = await Promise.all([
      this.prisma.qaReviewQueue.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          execution: {
            select: {
              ai_provider: true,
              complexity_score: true,
              files_changed: true,
              ticket: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.qaReviewQueue.count({ where }),
    ]);

    const items = entries.map((entry) =>
      this.mapToInterfaceWithExecution(
        entry,
        entry.execution?.ticket?.title,
        entry.execution?.ai_provider,
        entry.execution?.complexity_score ?? undefined,
        entry.execution?.files_changed,
      ),
    );

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      total,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  /**
   * Claim a ticket for review
   * @param queueId - Queue entry ID
   * @param reviewerId - User ID claiming the ticket
   * @returns Updated queue item
   */
  async claimTicket(queueId: string, reviewerId: string): Promise<IQueueItem> {
    this.logger.debug(`User ${reviewerId} claiming queue entry ${queueId}`);

    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueId },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    // Check if already claimed by someone else
    if (entry.status === QaReviewStatus.IN_REVIEW && entry.reviewed_by !== reviewerId) {
      throw new ConflictException(
        `Ticket is already being reviewed by another user (${entry.reviewed_by})`,
      );
    }

    // Validate status transition
    if (!this.isValidTransition(entry.status, QaReviewStatus.IN_REVIEW)) {
      throw new ConflictException(
        `Cannot claim ticket with status ${entry.status}. Must be PENDING.`,
      );
    }

    const updated = await this.prisma.qaReviewQueue.update({
      where: { id: queueId },
      data: {
        status: QaReviewStatus.IN_REVIEW,
        reviewed_by: reviewerId,
      },
    });

    this.logger.debug(`Queue entry ${queueId} claimed by ${reviewerId}`);

    return this.mapToInterface(updated, entry.execution?.ticket?.title);
  }

  /**
   * Approve a ticket
   * @param queueId - Queue entry ID
   * @param reviewerId - User ID approving the ticket
   * @param notes - Optional review notes
   * @returns Updated queue item
   */
  async approveTicket(queueId: string, reviewerId: string, notes?: string): Promise<IQueueItem> {
    this.logger.debug(`User ${reviewerId} approving queue entry ${queueId}`);

    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueId },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    // Validate status transition
    if (!this.isValidTransition(entry.status, QaReviewStatus.APPROVED)) {
      throw new ConflictException(
        `Cannot approve ticket with status ${entry.status}. Must be PENDING or IN_REVIEW.`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.qaReviewQueue.update({
      where: { id: queueId },
      data: {
        status: QaReviewStatus.APPROVED,
        reviewed_by: reviewerId,
        reviewed_at: now,
        review_notes: notes,
      },
    });

    // Record metrics
    this.decisionsCounter.inc({ decision: 'approved' });
    this.recordQueueDuration(entry.created_at, now);

    this.logger.debug(`Queue entry ${queueId} approved by ${reviewerId}`);

    return this.mapToInterface(updated, entry.execution?.ticket?.title);
  }

  /**
   * Reject a ticket
   * @param queueId - Queue entry ID
   * @param reviewerId - User ID rejecting the ticket
   * @param notes - Optional review notes
   * @returns Updated queue item
   */
  async rejectTicket(queueId: string, reviewerId: string, notes?: string): Promise<IQueueItem> {
    this.logger.debug(`User ${reviewerId} rejecting queue entry ${queueId}`);

    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueId },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    // Validate status transition
    if (!this.isValidTransition(entry.status, QaReviewStatus.REJECTED)) {
      throw new ConflictException(
        `Cannot reject ticket with status ${entry.status}. Must be PENDING or IN_REVIEW.`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.qaReviewQueue.update({
      where: { id: queueId },
      data: {
        status: QaReviewStatus.REJECTED,
        reviewed_by: reviewerId,
        reviewed_at: now,
        review_notes: notes,
      },
    });

    // Record metrics
    this.decisionsCounter.inc({ decision: 'rejected' });
    this.recordQueueDuration(entry.created_at, now);

    this.logger.debug(`Queue entry ${queueId} rejected by ${reviewerId}`);

    return this.mapToInterface(updated, entry.execution?.ticket?.title);
  }

  /**
   * Unclaim a ticket (return to PENDING)
   * @param queueId - Queue entry ID
   * @param reviewerId - User ID unclaiming the ticket
   * @returns Updated queue item
   */
  async unclaimTicket(queueId: string, reviewerId: string): Promise<IQueueItem> {
    this.logger.debug(`User ${reviewerId} unclaiming queue entry ${queueId}`);

    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueId },
      include: {
        execution: {
          select: {
            ticket: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    // Only the reviewer who claimed can unclaim
    if (entry.reviewed_by !== reviewerId) {
      throw new ConflictException(
        `Only the reviewer who claimed this ticket (${entry.reviewed_by}) can unclaim it`,
      );
    }

    // Validate status transition
    if (!this.isValidTransition(entry.status, QaReviewStatus.PENDING)) {
      throw new ConflictException(
        `Cannot unclaim ticket with status ${entry.status}. Must be IN_REVIEW.`,
      );
    }

    const updated = await this.prisma.qaReviewQueue.update({
      where: { id: queueId },
      data: {
        status: QaReviewStatus.PENDING,
        reviewed_by: null,
      },
    });

    this.logger.debug(`Queue entry ${queueId} unclaimed by ${reviewerId}`);

    return this.mapToInterface(updated, entry.execution?.ticket?.title);
  }

  /**
   * Get detailed QA results for a queue entry
   * @param queueId - Queue entry ID
   * @returns QA results with execution details
   */
  async getQueueDetails(queueId: string) {
    const entry = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueId },
      include: {
        execution: {
          select: {
            id: true,
            ticket_id: true,
            ai_provider: true,
            status: true,
            complexity_score: true,
            files_changed: true,
            qa_result: true,
            ticket: {
              select: {
                id: true,
                title: true,
                clickup_task_id: true,
                project_id: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    return {
      queueEntry: this.mapToInterface(
        entry,
        entry.execution?.ticket?.title,
        entry.execution?.ai_provider,
        entry.execution?.complexity_score ?? undefined,
        entry.execution?.files_changed,
      ),
      execution: entry.execution
        ? {
            id: entry.execution.id,
            ticketId: entry.execution.ticket_id,
            aiProvider: entry.execution.ai_provider,
            status: entry.execution.status,
            complexityScore: entry.execution.complexity_score,
            filesChanged: entry.execution.files_changed,
          }
        : null,
      qaResult: entry.execution?.qa_result || null,
    };
  }

  /**
   * Get queue depth by status for metrics
   * @returns Queue depth by status
   */
  async getQueueDepth(): Promise<Record<string, number>> {
    const counts = await this.prisma.qaReviewQueue.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    const result: Record<string, number> = {};
    counts.forEach((c) => {
      result[c.status.toLowerCase()] = c._count.status;
    });

    // Ensure all statuses are represented
    Object.values(QaReviewStatus).forEach((status) => {
      const key = String(status).toLowerCase();
      if (!(key in result)) {
        // eslint-disable-next-line security/detect-object-injection
        result[key] = 0;
      }
    });

    return result;
  }

  /**
   * Check if a status transition is valid
   */
  private isValidTransition(from: QaReviewStatus, to: QaReviewStatus): boolean {
    if (from === to) return true;
    return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowed);
  }

  /**
   * Record queue duration metric
   */
  private recordQueueDuration(createdAt: Date, reviewedAt: Date): void {
    const durationSeconds = (reviewedAt.getTime() - createdAt.getTime()) / 1000;
    this.queueDurationHistogram.observe(durationSeconds);
  }

  /**
   * Map database entity to interface
   */
  private mapToInterface(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: any,
    ticketTitle?: string,
    aiProvider?: string,
    complexityScore?: number,
    filesChanged?: number | unknown,
  ): IQueueItem {
    return {
      id: entry.id,
      ticketId: entry.ticket_id,
      ticketTitle,
      executionId: entry.execution_id,
      prUrl: entry.pr_url,
      prId: entry.pr_id,
      status: entry.status,
      riskLevel: entry.risk_level,
      riskFactors: Array.isArray(entry.risk_factors) ? entry.risk_factors : [],
      aiProvider: aiProvider || '',
      complexityScore: complexityScore || 0,
      filesChanged: typeof filesChanged === 'number' ? filesChanged : 0,
      samplingStrategy: entry.sampling_strategy,
      createdAt: entry.created_at,
      reviewedBy: entry.reviewed_by,
      reviewedAt: entry.reviewed_at,
      reviewNotes: entry.review_notes,
    };
  }

  /**
   * Map database entity to interface with execution details
   */
  private mapToInterfaceWithExecution(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: any,
    ticketTitle?: string,
    aiProvider?: string,
    complexityScore?: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filesChanged?: any,
  ): IQueueItem {
    return this.mapToInterface(entry, ticketTitle, aiProvider, complexityScore, filesChanged);
  }
}
