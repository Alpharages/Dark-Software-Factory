import { DependencyEdgeType } from '@/prisma/client';
import { TicketDependencyRepository } from './ticket-dependency.repository';
import { DependencySyncService } from './dependency-sync.service';
import { IDependencyProvider } from './providers/dependency-provider.interface';

describe('DependencySyncService', () => {
  let provider: jest.Mocked<Pick<IDependencyProvider, 'source' | 'getDependencies'>>;
  let dependencies: { reconcile: jest.Mock };
  let service: DependencySyncService;

  beforeEach(() => {
    provider = {
      source: 'clickup',
      getDependencies: jest.fn(),
    };
    dependencies = { reconcile: jest.fn().mockResolvedValue(undefined) };
    service = new DependencySyncService(
      provider as unknown as IDependencyProvider,
      dependencies as unknown as TicketDependencyRepository,
    );
  });

  it('reconciles the confirmed edges returned by the provider', async () => {
    provider.getDependencies.mockResolvedValueOnce([
      { dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on },
    ]);

    const count = await service.syncDependencies('task-a');

    expect(dependencies.reconcile).toHaveBeenCalledWith(
      'task-a',
      [{ dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on }],
      'clickup',
    );
    expect(count).toBe(1);
  });

  it('skips reconcile when the provider cannot determine dependencies (null)', async () => {
    provider.getDependencies.mockResolvedValueOnce(null);

    const count = await service.syncDependencies('task-a');

    expect(dependencies.reconcile).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
