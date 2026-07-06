import { Injectable, Logger, Optional } from '@nestjs/common';
import { DependencyBlockBehavior, TicketStatus } from '@/prisma/client';
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
      if (blocker.circular_detected) {
        unresolved.push(blocker.depends_on);
        continue;
      }

      const blockerTicket = await this.prisma.ticket.findUnique({
        where: { clickup_task_id: blocker.depends_on },
        select: { status: true },
      });

      if (!blockerTicket || !this.dependencyManager.isStatusResolved(blockerTicket.status)) {
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
