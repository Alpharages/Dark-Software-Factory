import { Injectable, Logger, Optional } from '@nestjs/common';
import { DependencyBlockBehavior, DependencyStatus, TicketStatus } from '@/prisma/client';
import { MetricsService } from '@/common/metrics/metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { DependencyManagerService } from '@/dependencies/dependency-manager.service';
import { TicketDependencyRepository } from '@/dependencies/ticket-dependency.repository';

export interface DependencyGateResult {
  blocked: boolean;
  unresolved: string[];
  behavior: DependencyBlockBehavior;
}

@Injectable()
export class DependencyGateService {
  private readonly logger = new Logger(DependencyGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: TicketDependencyRepository,
    private readonly dependencyManager: DependencyManagerService,
    @Optional()
    private readonly metrics?: MetricsService,
  ) {}

  async check(ticketId: string): Promise<DependencyGateResult> {
    // `ticketId` is the internal Ticket UUID, but ticket_dependencies is keyed by the
    // provider's external id (clickup_task_id) — resolve it before querying blockers,
    // otherwise the gate silently finds nothing and never blocks.
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        clickup_task_id: true,
        dependency_block_behavior: true,
        project: { select: { dependency_block_behavior: true } },
      },
    });

    const behavior =
      ticket?.dependency_block_behavior ??
      ticket?.project.dependency_block_behavior ??
      DependencyBlockBehavior.auto_resume;

    const blockers = ticket ? await this.dependencies.getBlockers(ticket.clickup_task_id) : [];

    const unresolved: string[] = [];
    for (const blocker of blockers) {
      // Self-edges never block (defensive — the provider/repo already drop them);
      // a genuine cycle is surfaced by Story 12.1's detector, not silently held here.
      if (blocker.depends_on === ticket?.clickup_task_id) continue;

      if (blocker.circular_detected) {
        unresolved.push(blocker.depends_on);
        continue;
      }

      // Fast path: an edge the sync/notify already confirmed RESOLVED needs no live
      // status re-fetch, keeping the gate off the ClickUp hot path (AC2). A blocker
      // regressing after resolution is out of scope — the gate is dispatch-time only.
      if (blocker.status === DependencyStatus.RESOLVED) continue;

      if (!(await this.dependencyManager.isDependencyResolved(blocker.depends_on))) {
        unresolved.push(blocker.depends_on);
      }
    }

    return { blocked: unresolved.length > 0, unresolved, behavior };
  }

  async markBlocked(ticketId: string, result: DependencyGateResult): Promise<void> {
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status:
          result.behavior === DependencyBlockBehavior.hold
            ? TicketStatus.AWAITING_DEPENDENCY_RELEASE
            : TicketStatus.WAITING,
      },
    });
    this.metrics?.incrementCounter('dispatcher_dependency_blocked_total', {
      behavior: result.behavior,
    });
    this.logger.debug(
      `Ticket ${ticketId} blocked by dependencies: ${result.unresolved.join(', ')}`,
    );
  }
}
