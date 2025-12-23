import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import {
  PredictFileModificationsInput,
  PredictFileModificationsResult,
} from './interfaces/file-prediction.interface';
import { AcquireLocksRequest, AcquireLocksResult } from './interfaces/lock-acquire.interface';
import { FilePredictionProvider } from './file-prediction.provider';

@Injectable()
export class FileLockManagerService {
  private readonly logger = new Logger(FileLockManagerService.name);
  private readonly predictionCacheTtlMs = 30 * 60 * 1000; // 30 minutes
  private readonly lockTimeoutMs = 30 * 60 * 1000; // 30 minutes (Dev Notes default)

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly metrics: MetricsService,
    private readonly filePredictionProvider: FilePredictionProvider,
  ) {}

  /**
   * AC#1: Predict repo-relative file paths likely to be modified for a ticket.
   */
  async predictFileModifications(
    input: PredictFileModificationsInput,
  ): Promise<PredictFileModificationsResult> {
    // 1) Cache: reuse the most recent prediction for this ticket (best-effort)
    try {
      const cached = await this.prisma.aIDecisionLog.findFirst({
        where: {
          ticket_id: input.ticketId,
          action: 'file_lock_prediction',
          timestamp: { gte: new Date(Date.now() - this.predictionCacheTtlMs) },
        },
        orderBy: { timestamp: 'desc' },
        select: { output_data: true },
      });

      const cachedOutput = cached?.output_data as
        | { filePaths?: unknown; confidence?: unknown; reasoning?: unknown }
        | undefined;

      if (
        cachedOutput &&
        Array.isArray(cachedOutput.filePaths) &&
        typeof cachedOutput.confidence === 'number' &&
        typeof cachedOutput.reasoning === 'string'
      ) {
        this.safeIncrementCounter('file_lock_predictions_total', { source: 'cache' });
        return {
          filePaths: this.normalizeAndDedupePaths(cachedOutput.filePaths),
          confidence: this.clamp01(cachedOutput.confidence),
          reasoning: cachedOutput.reasoning,
        };
      }
    } catch (error) {
      this.logger.debug(`Prediction cache lookup failed: ${(error as Error).message}`);
    }

    // 2) Heuristic: if the ticket text already contains explicit file paths, use them
    const explicitPaths = this.extractExplicitRepoPaths(
      `${input.ticketTitle ?? ''}\n\n${input.ticketDescription ?? ''}`,
    );

    if (explicitPaths.length > 0) {
      const result: PredictFileModificationsResult = {
        filePaths: explicitPaths,
        confidence: 0.95,
        reasoning:
          'Ticket text contains explicit repo-relative file paths; using them directly (skipping AI).',
      };

      this.safeIncrementCounter('file_lock_predictions_total', { source: 'heuristic' });

      await this.aiDecisionLogger.logDecision({
        agentName: 'FileLockManager',
        action: 'file_lock_prediction',
        reasoning: result.reasoning,
        ticketId: input.ticketId,
        executionId: input.executionId,
        inputData: {
          ticketTitle: input.ticketTitle ?? '',
          ticketDescription: input.ticketDescription ?? '',
          repoFullName: input.repoFullName,
          strategy: 'explicit_paths',
        },
        outputData: {
          filePaths: result.filePaths,
          confidence: result.confidence,
          reasoning: result.reasoning,
        },
        confidence: result.confidence,
      });

      return result;
    }

    // 3) AI delegation: ask an AI provider for strict JSON
    const aiResult = await this.filePredictionProvider.predict(input);

    const result: PredictFileModificationsResult = {
      filePaths: this.normalizeAndDedupePaths(aiResult.filePaths),
      confidence: this.clamp01(aiResult.confidence),
      reasoning: aiResult.reasoning,
    };

    this.safeIncrementCounter('file_lock_predictions_total', { source: 'ai' });

    await this.aiDecisionLogger.logDecision({
      agentName: 'FileLockManager',
      action: 'file_lock_prediction',
      reasoning: result.reasoning,
      ticketId: input.ticketId,
      executionId: input.executionId,
      inputData: {
        ticketTitle: input.ticketTitle ?? '',
        ticketDescription: input.ticketDescription ?? '',
        repoFullName: input.repoFullName,
        strategy: 'ai',
      },
      outputData: {
        filePaths: result.filePaths,
        confidence: result.confidence,
        reasoning: result.reasoning,
      },
      confidence: result.confidence,
    });

    return result;
  }

  /**
   * AC#2/#3/#5: Atomically acquire all required file locks (all-or-nothing).
   */
  async acquireLocks(request: AcquireLocksRequest): Promise<AcquireLocksResult> {
    const normalizedFilePaths = this.normalizeAndSortFilePaths(request.filePaths);
    const lockTimeoutMs = 30 * 60 * 1000; // 30 minutes (Dev Notes default)

    // Clean up stale locks before attempting acquisition
    await this.releaseStaleLocksForFiles(normalizedFilePaths);

    // Audit: record the request intent (best-effort)
    await this.aiDecisionLogger.logDecision({
      agentName: 'FileLockManager',
      action: 'file_lock_request',
      reasoning: `Requesting locks for ${normalizedFilePaths.length} file(s)`,
      ticketId: request.ticketId,
      executionId: request.executionId,
      inputData: { ...request, filePaths: normalizedFilePaths },
      outputData: { requested: true },
      confidence: 1.0,
    });

    // Ensure queue entries exist (idempotent)
    const requestedAt = new Date();
    await this.prisma.fileLockQueue.createMany({
      data: normalizedFilePaths.map((filePath) => ({
        ticket_id: request.ticketId,
        execution_id: request.executionId,
        file_path: filePath,
        requested_at: requestedAt,
        status: 'WAITING',
      })),
      skipDuplicates: true,
    });

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Load waiting queue entries for relevant files
        const queueEntries = await tx.fileLockQueue.findMany({
          where: {
            file_path: { in: normalizedFilePaths },
            status: 'WAITING',
          },
          orderBy: [{ file_path: 'asc' }, { requested_at: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            ticket_id: true,
            execution_id: true,
            file_path: true,
            requested_at: true,
          },
        });

        // Determine current locks
        const activeLocks = await tx.fileLock.findMany({
          where: {
            file_path: { in: normalizedFilePaths },
            status: 'LOCKED',
          },
          select: {
            file_path: true,
            ticket_id: true,
            execution_id: true,
            locked_at: true,
          },
        });

        const { isHeadForAll, queuePositionByFile, headTicketByFile } = this.evaluateQueuePosition(
          queueEntries,
          request.ticketId,
          request.executionId,
        );

        if (!isHeadForAll) {
          const conflictFilePaths = Array.from(headTicketByFile.entries())
            .filter(([, head]) => head.ticketId !== request.ticketId)
            .map(([filePath]) => filePath);

          const ownersFromLocks = activeLocks.map((l) => l.ticket_id);
          const ownersFromQueue = Array.from(headTicketByFile.values())
            .map((h) => h.ticketId)
            .filter((t) => t !== request.ticketId);

          const ownerTicketIds = Array.from(new Set([...ownersFromLocks, ...ownersFromQueue]));

          const estimatedReleaseTime = this.estimateReleaseTime(activeLocks, lockTimeoutMs);

          await this.aiDecisionLogger.logDecision({
            agentName: 'FileLockManager',
            action: 'file_lock_conflict',
            reasoning: `Not head-of-queue for ${conflictFilePaths.length} file(s); waiting`,
            ticketId: request.ticketId,
            executionId: request.executionId,
            inputData: { filePaths: normalizedFilePaths },
            outputData: {
              conflictFilePaths,
              ownerTicketIds,
              queuePositionByFile,
              estimatedReleaseTime: estimatedReleaseTime?.toISOString() ?? null,
            },
            confidence: 1.0,
          });

          // Metrics: Track conflict occurrence
          this.safeIncrementCounter('file_lock_conflicts_total', {
            ticket_id: request.ticketId,
            conflict_count: conflictFilePaths.length.toString(),
          });

          return {
            acquired: false,
            conflicts: {
              filePaths: conflictFilePaths,
              ownerTicketIds,
              queuePositionByFile,
            },
            estimatedReleaseTime,
          } satisfies AcquireLocksResult;
        }

        // Already locked by this ticket/execution? Treat as idempotent success.
        const existingLocks = await tx.fileLock.findMany({
          where: {
            ticket_id: request.ticketId,
            execution_id: request.executionId,
            status: 'LOCKED',
            file_path: { in: normalizedFilePaths },
          },
          select: { file_path: true },
        });

        if (existingLocks.length === normalizedFilePaths.length) {
          await tx.fileLockQueue.updateMany({
            where: {
              ticket_id: request.ticketId,
              execution_id: request.executionId,
              file_path: { in: normalizedFilePaths },
            },
            data: {
              status: 'ACQUIRED',
              acquired_at: new Date(),
            },
          });

          return { acquired: true } satisfies AcquireLocksResult;
        }

        // Attempt to acquire locks atomically (DB enforces exclusivity via partial unique index)
        await tx.fileLock.createMany({
          data: normalizedFilePaths.map((filePath) => ({
            ticket_id: request.ticketId,
            execution_id: request.executionId,
            file_path: filePath,
            status: 'LOCKED',
          })),
        });

        await tx.fileLockQueue.updateMany({
          where: {
            ticket_id: request.ticketId,
            execution_id: request.executionId,
            file_path: { in: normalizedFilePaths },
          },
          data: {
            status: 'ACQUIRED',
            acquired_at: new Date(),
          },
        });

        await this.aiDecisionLogger.logDecision({
          agentName: 'FileLockManager',
          action: 'file_lock_acquired',
          reasoning: `Acquired ${normalizedFilePaths.length} lock(s) atomically`,
          ticketId: request.ticketId,
          executionId: request.executionId,
          inputData: { filePaths: normalizedFilePaths },
          outputData: { acquired: true },
          confidence: 1.0,
        });

        // Metrics: Update active locks gauge
        this.updateActiveLocksGauge();

        return { acquired: true } satisfies AcquireLocksResult;
      });

      return result;
    } catch (error) {
      // Most likely a uniqueness conflict on the partial unique index (another ticket locked one of the files)
      this.logger.warn(`Lock acquisition failed, returning conflict: ${(error as Error).message}`);

      const conflicts = await this.checkConflicts({
        ticketId: request.ticketId,
        executionId: request.executionId,
        filePaths: normalizedFilePaths,
      });

      await this.aiDecisionLogger.logDecision({
        agentName: 'FileLockManager',
        action: 'file_lock_conflict',
        reasoning: `DB constraint prevented lock acquisition (treated as conflict)`,
        ticketId: request.ticketId,
        executionId: request.executionId,
        inputData: { filePaths: normalizedFilePaths },
        outputData: {
          conflictFilePaths: conflicts.conflicts?.filePaths ?? [],
          ownerTicketIds: conflicts.conflicts?.ownerTicketIds ?? [],
          queuePositionByFile: conflicts.conflicts?.queuePositionByFile ?? {},
          estimatedReleaseTime: conflicts.estimatedReleaseTime?.toISOString() ?? null,
        },
        confidence: 1.0,
      });

      // Metrics: Track conflict
      this.safeIncrementCounter('file_lock_conflicts_total', {
        ticket_id: request.ticketId,
        conflict_count: (conflicts.conflicts?.filePaths?.length ?? 0).toString(),
      });

      return conflicts;
    }
  }

  /**
   * AC#4/#5: Release locks for an execution and advance queues.
   * NOTE: Full implementation comes in later subtasks of this story.
   */
  async releaseLocksForExecution(executionId: string): Promise<void> {
    const activeLocks = await this.prisma.fileLock.findMany({
      where: { execution_id: executionId, status: 'LOCKED' },
      select: { file_path: true, ticket_id: true, locked_at: true },
    });

    if (activeLocks.length === 0) {
      return;
    }

    const releasedAt = new Date();
    const affectedFilePaths = Array.from(new Set(activeLocks.map((l) => l.file_path))).sort();

    await this.prisma.fileLock.updateMany({
      where: { execution_id: executionId, status: 'LOCKED' },
      data: { status: 'RELEASED', released_at: releasedAt },
    });

    await this.aiDecisionLogger.logDecision({
      agentName: 'FileLockManager',
      action: 'file_lock_released',
      reasoning: `Released ${activeLocks.length} lock(s) for execution ${executionId}`,
      ticketId: activeLocks[0].ticket_id,
      executionId,
      inputData: { executionId },
      outputData: { releasedCount: activeLocks.length, affectedFilePaths },
      confidence: 1.0,
    });

    // Best-effort: try to advance queues for the affected file paths
    await this.advanceQueuesForFiles(affectedFilePaths);

    // Metrics: Update active locks gauge after release
    this.updateActiveLocksGauge();
  }

  /**
   * AC#6: Dashboard support - list current active (LOCKED) file locks.
   */
  async getActiveLocks(): Promise<
    Array<{ filePath: string; ticketId: string; executionId: string; lockedAt: string }>
  > {
    const locks = await this.prisma.fileLock.findMany({
      where: { status: 'LOCKED' },
      orderBy: { locked_at: 'desc' },
      select: { file_path: true, ticket_id: true, execution_id: true, locked_at: true },
    });

    return locks.map((l) => ({
      filePath: l.file_path,
      ticketId: l.ticket_id,
      executionId: l.execution_id,
      lockedAt: l.locked_at.toISOString(),
    }));
  }

  /**
   * AC#6: Dashboard support - list waiting queue entries grouped by file path.
   */
  async getWaitingQueues(filePath?: string): Promise<{
    queues: Array<{
      filePath: string;
      estimatedReleaseTime?: string;
      tickets: Array<{
        ticketId: string;
        executionId: string;
        requestedAt: string;
        position: number;
      }>;
    }>;
    totalWaiting: number;
  }> {
    const whereClause: Record<string, unknown> = { status: 'WAITING' };
    if (filePath) {
      whereClause.file_path = filePath;
    }

    const waiting = await this.prisma.fileLockQueue.findMany({
      where: whereClause,
      orderBy: [{ file_path: 'asc' }, { requested_at: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        file_path: true,
        ticket_id: true,
        execution_id: true,
        requested_at: true,
      },
    });

    const filePaths = Array.from(new Set(waiting.map((w) => w.file_path)));
    const locks = await this.prisma.fileLock.findMany({
      where: { file_path: { in: filePaths }, status: 'LOCKED' },
      select: { file_path: true, locked_at: true },
    });

    const lockByFile = new Map(locks.map((l) => [l.file_path, l.locked_at]));

    const byFile = new Map<string, typeof waiting>();
    for (const entry of waiting) {
      const list = byFile.get(entry.file_path) ?? [];
      list.push(entry);
      byFile.set(entry.file_path, list);
    }

    const queues = Array.from(byFile.entries()).map(([fp, entries]) => {
      const lockedAt = lockByFile.get(fp);
      const estimatedReleaseTime =
        lockedAt instanceof Date
          ? new Date(lockedAt.getTime() + this.lockTimeoutMs).toISOString()
          : undefined;

      return {
        filePath: fp,
        estimatedReleaseTime,
        tickets: entries.map((e, idx) => ({
          ticketId: e.ticket_id,
          executionId: e.execution_id,
          requestedAt: e.requested_at.toISOString(),
          position: idx + 1,
        })),
      };
    });

    return { queues, totalWaiting: waiting.length };
  }

  private clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  private normalizeAndDedupePaths(filePaths: unknown[]): string[] {
    const normalized = filePaths
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.replace(/^[.][/\\]/, '').replace(/^\/+/, '')); // remove leading "./" or "/"

    return Array.from(new Set(normalized));
  }

  private readonly MAX_EXPLICIT_FILE_PATHS = 25;
  private readonly VALID_PATH_PREFIXES = [
    'src/',
    'prisma/',
    'test/',
    'tests/',
    'lib/',
    'scripts/',
    'config/',
    'docs/',
    'migrations/',
  ];

  private extractExplicitRepoPaths(text: string): string[] {
    // Match paths like "src/foo/bar.ts" or "prisma/schema.prisma"
    // Improved to reduce false positives from URLs (Code Review Fix #11)
    const potentialMatches =
      text.match(/\b[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\.[a-zA-Z0-9]+\b/g) ?? [];

    // Filter to only include paths that start with known repo prefixes
    const validMatches = potentialMatches.filter((match) => {
      // Exclude URLs (contain protocol or domain-like patterns)
      if (match.includes('://') || match.match(/\.(com|org|net|io|dev)\//)) {
        return false;
      }

      // Only include if starts with a known repo directory prefix
      return this.VALID_PATH_PREFIXES.some((prefix) => match.startsWith(prefix));
    });

    // Normalize and de-dupe, keep first MAX_EXPLICIT_FILE_PATHS to avoid huge lock sets
    return this.normalizeAndDedupePaths(validMatches).slice(0, this.MAX_EXPLICIT_FILE_PATHS);
  }

  private normalizeAndSortFilePaths(filePaths: string[]): string[] {
    return Array.from(
      new Set(
        (filePaths ?? [])
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => p.replace(/^[.][/\\]/, '').replace(/^\/+/, '')),
      ),
    ).sort();
  }

  private estimateReleaseTime(
    activeLocks: Array<{ locked_at: Date; file_path: string }>,
    lockTimeoutMs: number,
  ): Date | undefined {
    const times = activeLocks
      .map((l) => {
        const lockedAt = l.locked_at instanceof Date ? l.locked_at : new Date(l.locked_at);
        return new Date(lockedAt.getTime() + lockTimeoutMs);
      })
      .filter((d) => !Number.isNaN(d.getTime()));

    if (times.length === 0) return undefined;
    return new Date(Math.max(...times.map((d) => d.getTime())));
  }

  private evaluateQueuePosition(
    queueEntries: Array<{
      id: string;
      ticket_id: string;
      execution_id: string;
      file_path: string;
      requested_at: Date;
    }>,
    ticketId: string,
    executionId: string,
  ): {
    isHeadForAll: boolean;
    queuePositionByFile: Map<string, number>;
    headTicketByFile: Map<string, { ticketId: string; executionId: string }>;
  } {
    const entriesByFile = new Map<string, typeof queueEntries>();
    for (const entry of queueEntries) {
      const existing = entriesByFile.get(entry.file_path) ?? [];
      existing.push(entry);
      entriesByFile.set(entry.file_path, existing);
    }

    const queuePositionByFile = new Map<string, number>();
    const headTicketByFile = new Map<string, { ticketId: string; executionId: string }>();

    let isHeadForAll = true;

    for (const [filePath, entries] of entriesByFile.entries()) {
      const head = entries[0];
      headTicketByFile.set(filePath, { ticketId: head.ticket_id, executionId: head.execution_id });

      const myIndex = entries.findIndex(
        (e) => e.ticket_id === ticketId && e.execution_id === executionId,
      );
      if (myIndex >= 0) {
        queuePositionByFile.set(filePath, myIndex + 1); // 1-based
      }

      if (head.ticket_id !== ticketId || head.execution_id !== executionId) {
        isHeadForAll = false;
      }
    }

    return { isHeadForAll, queuePositionByFile, headTicketByFile };
  }

  private async checkConflicts(request: AcquireLocksRequest): Promise<AcquireLocksResult> {
    const filePaths = this.normalizeAndSortFilePaths(request.filePaths);

    const [activeLocks, queueEntries] = await Promise.all([
      this.prisma.fileLock.findMany({
        where: { file_path: { in: filePaths }, status: 'LOCKED' },
        select: { file_path: true, ticket_id: true, execution_id: true, locked_at: true },
      }),
      this.prisma.fileLockQueue.findMany({
        where: { file_path: { in: filePaths }, status: 'WAITING' },
        orderBy: [{ file_path: 'asc' }, { requested_at: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          ticket_id: true,
          execution_id: true,
          file_path: true,
          requested_at: true,
        },
      }),
    ]);

    const { queuePositionByFile, headTicketByFile } = this.evaluateQueuePosition(
      queueEntries,
      request.ticketId,
      request.executionId,
    );

    const conflictFilePaths = filePaths.filter(
      (fp) => headTicketByFile.get(fp)?.ticketId !== request.ticketId,
    );
    const ownerTicketIds = Array.from(
      new Set([
        ...activeLocks.map((l) => l.ticket_id),
        ...Array.from(headTicketByFile.values())
          .map((h) => h.ticketId)
          .filter((t) => t !== request.ticketId),
      ]),
    );

    return {
      acquired: false,
      conflicts: {
        filePaths: conflictFilePaths,
        ownerTicketIds,
        queuePositionByFile,
      },
      estimatedReleaseTime: this.estimateReleaseTime(activeLocks, this.lockTimeoutMs),
    };
  }

  private async advanceQueuesForFiles(filePaths: string[]): Promise<void> {
    const affected = this.normalizeAndSortFilePaths(filePaths);
    if (affected.length === 0) return;

    // Iterate up to 50 times because acquiring for one ticket can unblock others in cascading dependencies
    // Increased from 10 to handle deeper dependency chains (Code Review Fix #8)
    const MAX_QUEUE_ADVANCE_ITERATIONS = 50;
    for (let i = 0; i < MAX_QUEUE_ADVANCE_ITERATIONS; i++) {
      const queueHeads = await this.prisma.fileLockQueue.findMany({
        where: { file_path: { in: affected }, status: 'WAITING' },
        orderBy: [{ file_path: 'asc' }, { requested_at: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          file_path: true,
          ticket_id: true,
          execution_id: true,
          requested_at: true,
        },
      });

      // Take the first WAITING entry per file
      const headByFile = new Map<string, { ticketId: string; executionId: string }>();
      for (const entry of queueHeads) {
        if (!headByFile.has(entry.file_path)) {
          headByFile.set(entry.file_path, {
            ticketId: entry.ticket_id,
            executionId: entry.execution_id,
          });
        }
      }

      const candidates = Array.from(
        new Set(Array.from(headByFile.values()).map((c) => `${c.ticketId}::${c.executionId}`)),
      ).map((key) => {
        const [ticketId, executionId] = key.split('::');
        return { ticketId, executionId };
      });

      let progressed = false;

      for (const candidate of candidates) {
        // Determine the complete set of files this ticket is still waiting on
        const waitingEntries = await this.prisma.fileLockQueue.findMany({
          where: {
            ticket_id: candidate.ticketId,
            execution_id: candidate.executionId,
            status: 'WAITING',
          },
          select: { file_path: true },
        });

        const neededFilePaths = Array.from(new Set(waitingEntries.map((e) => e.file_path)));
        if (neededFilePaths.length === 0) continue;

        const result = await this.acquireLocks({
          ticketId: candidate.ticketId,
          executionId: candidate.executionId,
          filePaths: neededFilePaths,
        });

        if (result.acquired) {
          progressed = true;
        }
      }

      if (!progressed) {
        break;
      }
    }
  }

  /**
   * Release stale locks that have exceeded the timeout threshold.
   * Called automatically before lock acquisition attempts.
   */
  private async releaseStaleLocksForFiles(filePaths: string[]): Promise<void> {
    const staleThreshold = new Date(Date.now() - this.lockTimeoutMs);

    try {
      const staleLocks = await this.prisma.fileLock.findMany({
        where: {
          file_path: { in: filePaths },
          status: 'LOCKED',
          locked_at: { lt: staleThreshold },
        },
        select: { execution_id: true, file_path: true, locked_at: true, ticket_id: true },
      });

      if (staleLocks.length === 0) return;

      const executionIds = Array.from(new Set(staleLocks.map((l) => l.execution_id)));

      this.logger.warn(
        `Releasing ${staleLocks.length} stale lock(s) for executions: ${executionIds.join(', ')}`,
      );

      for (const executionId of executionIds) {
        await this.releaseLocksForExecution(executionId);
      }

      this.safeIncrementCounter('file_lock_stale_releases_total', {
        count: staleLocks.length.toString(),
      });
    } catch (error) {
      this.logger.error(`Stale lock cleanup failed: ${(error as Error).message}`);
    }
  }

  private safeIncrementCounter(metricName: string, labels: Record<string, string>) {
    try {
      this.metrics.incrementCounter(metricName, labels);
    } catch (err) {
      this.logger.debug(`Metrics increment failed for ${metricName}: ${(err as Error).message}`);
    }
  }

  /**
   * Update the file_locks_active gauge with current lock count.
   * Called after lock acquisition and release operations.
   */
  private updateActiveLocksGauge(): void {
    // Best-effort: async query, don't block the main flow
    this.prisma.fileLock
      .count({ where: { status: 'LOCKED' } })
      .then((count) => {
        try {
          this.metrics.setGauge('file_locks_active', count);
        } catch (err) {
          this.logger.debug(`Metrics gauge update failed: ${(err as Error).message}`);
        }
      })
      .catch((err) => {
        this.logger.debug(`Active locks count query failed: ${(err as Error).message}`);
      });
  }
}
