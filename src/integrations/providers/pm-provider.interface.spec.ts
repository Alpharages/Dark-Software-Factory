import { IPMProvider } from './pm-provider.interface';
import { NormalizedTask } from './dto/normalized-task.dto';
import { NormalizedStatus, NormalizedStatusType } from './dto/normalized-status.dto';
import { NormalizedField, NormalizedFieldType } from './dto/normalized-field.dto';
import { NormalizedSelf, WebhookRegistrationResult } from './dto/normalized-self.dto';
import { IRawTaskEvent } from '../../ticket-intake/interfaces/ticket-intake.interface';

/**
 * Mock implementation of IPMProvider for testing the interface and DTO mapping.
 */
class MockPMProvider implements IPMProvider {
  async getSelf(): Promise<NormalizedSelf> {
    return { id: 'bot-1', name: 'Bot', email: 'bot@example.com' };
  }

  async getStatuses(_contextId: string): Promise<NormalizedStatus[]> {
    return [
      { id: '1', name: 'To Do', color: '#ccc', type: NormalizedStatusType.TODO },
      { id: '2', name: 'Done', color: '#0f0', type: NormalizedStatusType.DONE },
    ];
  }

  async getTask(taskId: string): Promise<NormalizedTask> {
    return {
      id: taskId,
      name: 'Test Task',
      description: 'Test Description',
      status: { id: '1', name: 'Open', color: null, type: NormalizedStatusType.TODO },
      url: 'https://example.com/task/1',
      listId: 'list-1',
    };
  }

  async updateStatus(_taskId: string, _statusId: string): Promise<void> {}
  async addComment(_taskId: string, _comment: string): Promise<void> {}
  async assignTask(_taskId: string, _userId: string): Promise<void> {}

  async getRequiredFields(_contextId: string): Promise<NormalizedField[]> {
    return [{ id: 'f1', name: 'Priority', type: NormalizedFieldType.DROPDOWN, required: true }];
  }

  async setFieldValue(_taskId: string, _fieldId: string, _value: unknown): Promise<void> {}

  async registerWebhook(
    _contextId: string,
    _webhookUrl: string,
  ): Promise<WebhookRegistrationResult> {
    return { id: 'wh-1' };
  }

  async deregisterWebhook(_webhookId: string): Promise<void> {}

  normalizeEvent(payload: unknown): IRawTaskEvent {
    const p = payload as Record<string, unknown>;
    return {
      correlationId: 'corr-1',
      webhookEventId: 'ev-1',
      eventType: 'task.updated',
      taskId: p.id as string,
      taskName: 'Task Name',
      taskDescription: 'Description',
      taskStatus: 'Open',
      listId: 'list-1',
      listName: 'List Name',
      spaceId: 'space-1',
      projectId: 'proj-1',
      projectName: 'Project Name',
      taskUrl: 'https://example.com/task/1',
      tags: [],
      customFields: {},
      creatorEmail: 'bot@example.com',
      eventTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
  }

  async getUpdatedTasks(_workspaceId: string, _since: Date): Promise<NormalizedTask[]> {
    return [];
  }
}

describe('IPMProvider & DTOs', () => {
  let provider: IPMProvider;

  beforeEach(() => {
    provider = new MockPMProvider();
  });

  it('should return all self properties', async () => {
    const self = await provider.getSelf();
    expect(self.id).toBeDefined();
    expect(self.name).toBeDefined();
    expect(self.email).toBeDefined();
  });

  it('should return normalized statuses with type', async () => {
    const statuses = await provider.getStatuses('list-1');
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0].type).toBeDefined();
  });

  it('should return normalized task structure', async () => {
    const task = await provider.getTask('task-1');
    expect(task.id).toBe('task-1');
    expect(task.status).toBeDefined();
    expect(task.url).toContain('example.com');
  });

  it('should resolve updateStatus without error', async () => {
    await expect(provider.updateStatus('task-1', 'status-1')).resolves.toBeUndefined();
  });

  it('should resolve addComment without error', async () => {
    await expect(provider.addComment('task-1', 'LGTM')).resolves.toBeUndefined();
  });

  it('should resolve assignTask without error', async () => {
    await expect(provider.assignTask('task-1', 'user-1')).resolves.toBeUndefined();
  });

  it('should return normalized required fields', async () => {
    const fields = await provider.getRequiredFields('list-1');
    expect(fields[0].required).toBe(true);
    expect(fields[0].type).toBe(NormalizedFieldType.DROPDOWN);
  });

  it('should resolve setFieldValue without error', async () => {
    await expect(provider.setFieldValue('task-1', 'f1', 'high')).resolves.toBeUndefined();
  });

  it('should registerWebhook and return a webhook id', async () => {
    const result = await provider.registerWebhook('list-1', 'https://example.com/webhook');
    expect(result.id).toBeDefined();
  });

  it('should resolve deregisterWebhook without error', async () => {
    await expect(provider.deregisterWebhook('wh-1')).resolves.toBeUndefined();
  });

  it('should normalize events into IRawTaskEvent', () => {
    const event = provider.normalizeEvent({ id: 't-1' });
    expect(event.taskId).toBe('t-1');
    expect(event.eventType).toBe('task.updated');
    expect(event.correlationId).toBeDefined();
    expect(event.webhookEventId).toBeDefined();
  });
});
