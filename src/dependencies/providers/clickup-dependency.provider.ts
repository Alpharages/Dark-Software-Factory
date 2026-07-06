import { Injectable, Logger } from '@nestjs/common';
import { ClickUpService } from '@/clickup/clickup.service';
import { DependencyEdgeType } from '@/prisma/client';
import { DependencyEdge, IDependencyProvider } from './dependency-provider.interface';

interface ClickUpDependencyLink {
  task_id?: string;
  depends_on?: string;
  type?: string | number;
}

@Injectable()
export class ClickUpDependencyProvider implements IDependencyProvider {
  readonly source = 'clickup' as const;
  private readonly logger = new Logger(ClickUpDependencyProvider.name);

  constructor(private readonly clickup: ClickUpService) {}

  async getDependencies(externalId: string, task?: unknown): Promise<DependencyEdge[]> {
    const payload = task ?? (await this.clickup.getTask(externalId));
    const dependencies = (payload as { dependencies?: ClickUpDependencyLink[] }).dependencies ?? [];

    const edges = new Map<string, DependencyEdge>();
    for (const dependency of dependencies) {
      const edge = this.toEdge(externalId, dependency);
      if (!edge || edge.dependsOnExternalId === externalId) continue;
      edges.set(`${edge.type}:${edge.dependsOnExternalId}`, edge);
    }

    return [...edges.values()];
  }

  private toEdge(externalId: string, dependency: ClickUpDependencyLink): DependencyEdge | null {
    if (dependency.task_id === externalId && dependency.depends_on) {
      return {
        dependsOnExternalId: dependency.depends_on,
        type: DependencyEdgeType.waiting_on,
      };
    }

    if (dependency.depends_on === externalId && dependency.task_id) {
      return {
        dependsOnExternalId: dependency.task_id,
        type: DependencyEdgeType.blocking,
      };
    }

    const type = this.mapType(dependency.type);
    const dependsOnExternalId = dependency.depends_on ?? dependency.task_id;
    if (!type || !dependsOnExternalId) {
      this.logger.warn(`Skipping unrecognised ClickUp dependency payload for ${externalId}`);
      return null;
    }

    return { dependsOnExternalId, type };
  }

  private mapType(raw: string | number | undefined): DependencyEdgeType | null {
    if (raw === undefined || raw === 'waiting_on' || raw === 0 || raw === '0') {
      return DependencyEdgeType.waiting_on;
    }
    if (raw === 'blocking' || raw === 1 || raw === '1') {
      return DependencyEdgeType.blocking;
    }
    return null;
  }
}
