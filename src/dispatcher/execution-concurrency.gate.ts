import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SystemConfigService } from '@/system-settings/system-config.service';

/** SystemConfig key holding the global default (env fallback: EXECUTION_CONCURRENCY_LIMIT). */
export const EXECUTION_CONCURRENCY_CONFIG_KEY = 'execution.concurrency_limit';

/** Safe rollout default: one execution at a time (report §3.5). */
export const DEFAULT_EXECUTION_CONCURRENCY = 1;

/**
 * Caps how many AI executions may run at once (report §3.5).
 *
 * Two layers, because they solve different halves of the problem:
 *
 * - **Global** — enforced by RabbitMQ `channel.prefetch(n)` in the intake
 *   consumer, which is exactly the requested "run at most N, hold the rest in
 *   the queue" semantics for free. Not this class's job.
 * - **Per-project** — enforced here. Prefetch is per-*consumer*, so it cannot
 *   express a per-project cap; and the dispatcher is the only place a project
 *   id is known. Callers `acquire()` a slot before starting a run and release
 *   it when the run settles.
 *
 * Waiters are bounded by the global prefetch (at most N dispatches can be in
 * flight at once), so the queue cannot grow without limit.
 *
 * ponytail: in-process only, matching the existing `inFlightTickets` guard in
 * DispatcherService — correct for the single-instance MVP. A multi-instance
 * deployment needs a shared counter (Redis) or a DB-level advisory lock.
 */
@Injectable()
export class ExecutionConcurrencyGate {
  private readonly logger = new Logger(ExecutionConcurrencyGate.name);
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  /** Global default from SystemConfig (DB → env → 1), clamped to >= 1. */
  async getGlobalLimit(): Promise<number> {
    const raw = await this.systemConfig.get(
      EXECUTION_CONCURRENCY_CONFIG_KEY,
      String(DEFAULT_EXECUTION_CONCURRENCY),
    );
    return this.clamp(raw, DEFAULT_EXECUTION_CONCURRENCY);
  }

  /** Effective limit for a project: its own override, else the global default. */
  async resolveLimit(projectId: string): Promise<number> {
    const global = await this.getGlobalLimit();
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { execution_concurrency_limit: true },
    });
    const override = project?.execution_concurrency_limit;
    return override === null || override === undefined ? global : this.clamp(override, global);
  }

  /**
   * Wait until the project has a free slot, then claim it. Returns a release
   * function the caller MUST invoke (in a `finally`) when the run settles.
   */
  async acquire(projectId: string): Promise<() => void> {
    for (;;) {
      // Re-resolve on each wake so a limit edited in the UI takes effect for
      // callers already waiting, rather than honouring a stale value.
      const limit = await this.resolveLimit(projectId);

      // Read the active count only AFTER the await, and register the waiter in
      // the same synchronous step. Reading it before `await resolveLimit()` let
      // a release land in between, so the caller queued behind a wake-up that
      // had already fired — a permanent hang.
      const active = this.active.get(projectId) ?? 0;
      if (active < limit) break;

      this.logger.debug(
        `Project ${projectId} at concurrency limit (${active}/${limit}) — waiting for a slot`,
      );
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(projectId) ?? [];
        queue.push(resolve);
        this.waiters.set(projectId, queue);
      });
    }

    this.active.set(projectId, (this.active.get(projectId) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) return; // idempotent: a double release must not free someone else's slot
      released = true;
      this.release(projectId);
    };
  }

  /** Active slot count for a project (test/observability hook). */
  activeCount(projectId: string): number {
    return this.active.get(projectId) ?? 0;
  }

  private release(projectId: string): void {
    const next = (this.active.get(projectId) ?? 1) - 1;
    if (next <= 0) this.active.delete(projectId);
    else this.active.set(projectId, next);

    const queue = this.waiters.get(projectId);
    const wake = queue?.shift();
    if (queue && queue.length === 0) this.waiters.delete(projectId);
    wake?.();
  }

  private clamp(value: string | number, fallback: number): number {
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }
}
