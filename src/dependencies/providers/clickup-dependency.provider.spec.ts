import { DependencyEdgeType } from '@/prisma/client';
import { ClickUpService } from '@/clickup/clickup.service';
import { ClickUpDependencyProvider } from './clickup-dependency.provider';

describe('ClickUpDependencyProvider', () => {
  let clickup: { getTask: jest.Mock };
  let provider: ClickUpDependencyProvider;

  beforeEach(() => {
    clickup = { getTask: jest.fn() };
    provider = new ClickUpDependencyProvider(clickup as unknown as ClickUpService);
  });

  it('extracts dependencies from a supplied payload without re-fetching', async () => {
    const result = await provider.getDependencies('task-a', {
      dependencies: [
        { task_id: 'task-a', depends_on: 'task-b' },
        { task_id: 'task-c', depends_on: 'task-a' },
        { task_id: 'task-a', depends_on: 'task-a' },
      ],
    });

    expect(result).toEqual([
      { dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on },
      { dependsOnExternalId: 'task-c', type: DependencyEdgeType.blocking },
    ]);
    expect(clickup.getTask).not.toHaveBeenCalled();
  });

  it('fetches task details when no payload is supplied', async () => {
    clickup.getTask.mockResolvedValueOnce({
      dependencies: [{ task_id: 'task-b', type: 'waiting_on' }],
    });

    await expect(provider.getDependencies('task-a')).resolves.toEqual([
      { dependsOnExternalId: 'task-b', type: DependencyEdgeType.waiting_on },
    ]);
    expect(clickup.getTask).toHaveBeenCalledWith('task-a');
  });
});
