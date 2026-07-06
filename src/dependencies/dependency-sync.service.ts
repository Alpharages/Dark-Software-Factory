import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEPENDENCY_PROVIDER,
  IDependencyProvider,
} from './providers/dependency-provider.interface';
import { TicketDependencyRepository } from './ticket-dependency.repository';

@Injectable()
export class DependencySyncService {
  private readonly logger = new Logger(DependencySyncService.name);

  constructor(
    @Inject(DEPENDENCY_PROVIDER)
    private readonly provider: IDependencyProvider,
    private readonly dependencies: TicketDependencyRepository,
  ) {}

  async syncDependencies(ticketId: string, task?: unknown): Promise<number> {
    const edges = await this.provider.getDependencies(ticketId, task);
    if (edges === null) {
      this.logger.warn(`Skipping dependency reconcile for ${ticketId}: provider data unavailable`);
      return 0;
    }
    await this.dependencies.reconcile(ticketId, edges, this.provider.source);
    this.logger.debug(`Synced ${edges.length} dependency edge(s) for ${ticketId}`);
    return edges.length;
  }
}
