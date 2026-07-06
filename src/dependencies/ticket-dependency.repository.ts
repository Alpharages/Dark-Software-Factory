import { Injectable } from '@nestjs/common';
import { DependencyEdgeType, TicketDependency } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { DependencyEdge, IDependencyProvider } from './providers/dependency-provider.interface';

type DependencySource = IDependencyProvider['source'];

@Injectable()
export class TicketDependencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getBlockers(ticketId: string): Promise<TicketDependency[]> {
    return this.prisma.ticketDependency.findMany({
      where: { ticket_id: ticketId, type: DependencyEdgeType.waiting_on },
      orderBy: { created_at: 'asc' },
    });
  }

  getDependents(ticketId: string): Promise<TicketDependency[]> {
    return this.prisma.ticketDependency.findMany({
      where: { depends_on: ticketId, type: DependencyEdgeType.waiting_on },
      orderBy: { created_at: 'asc' },
    });
  }

  async reconcile(
    ticketId: string,
    edges: DependencyEdge[],
    source: DependencySource,
  ): Promise<void> {
    const uniqueEdges = this.uniqueEdges(ticketId, edges);
    const currentIds = uniqueEdges.map((edge) => edge.dependsOnExternalId);

    await this.prisma.$transaction([
      ...uniqueEdges.map((edge) =>
        this.prisma.ticketDependency.upsert({
          where: {
            ticket_id_depends_on_source: {
              ticket_id: ticketId,
              depends_on: edge.dependsOnExternalId,
              source,
            },
          },
          create: {
            ticket_id: ticketId,
            depends_on: edge.dependsOnExternalId,
            type: edge.type,
            source,
          },
          update: {
            type: edge.type,
            status: 'WAITING',
            resolved_at: null,
          },
        }),
      ),
      this.prisma.ticketDependency.deleteMany({
        where: {
          ticket_id: ticketId,
          source,
          depends_on: { notIn: currentIds },
        },
      }),
    ]);
  }

  private uniqueEdges(ticketId: string, edges: DependencyEdge[]): DependencyEdge[] {
    // Key by depends_on only — the DB unique index is (ticket_id, depends_on, source),
    // so a target can hold exactly one row regardless of type. Last edge wins.
    const unique = new Map<string, DependencyEdge>();
    for (const edge of edges) {
      if (!edge.dependsOnExternalId || edge.dependsOnExternalId === ticketId) continue;
      unique.set(edge.dependsOnExternalId, edge);
    }
    return [...unique.values()];
  }
}
