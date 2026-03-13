import { describe, it, expect } from '@jest/globals';
import { TaskProviderType, TaskTriggerSource } from '../dto/task-event.dto';
import { IRawTaskEvent } from '../interfaces/ticket-intake.interface';
import { mapClickUpToTaskEvent } from './task-event.mapper';

/**
 * Story 20.1: Task Event Mapper Tests
 * Tests for mapping provider-specific events to ITaskEvent
 */

describe('ClickUp to ITaskEvent Mapping', () => {
  it('should map webhook event to ITaskEvent with correct fields (QUEUED by default)', () => {
    const rawEvent: IRawTaskEvent = {
      correlationId: 'test-123',
      webhookEventId: 'webhook-456',
      eventType: 'task.updated',
      taskId: 'cu-task-789',
      taskName: 'Test Task',
      taskDescription: 'Test description',
      taskStatus: 'in progress',
      listId: 'list-123',
      listName: 'Test List',
      spaceId: 'space-456',
      projectId: 'project-789',
      projectName: 'Test Project',
      taskUrl: 'https://app.clickup.com/t/cu-task-789',
      tags: ['bug', 'urgent'],
      customFields: { priority: 'high' },
      creatorEmail: 'test@example.com',
      eventTimestamp: '2026-01-29T00:00:00Z',
      receivedAt: '2026-01-29T00:00:01Z',
    };

    const mapped = mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.WEBHOOK);

    expect(mapped.externalId).toBe('cu-task-789');
    expect(mapped.providerType).toBe(TaskProviderType.CLICKUP);
    expect(mapped.internalStatus).toBe('QUEUED'); // Stubbed fallback
    expect(mapped.title).toBe('Test Task');
    expect(mapped.triggerSource).toBe(TaskTriggerSource.WEBHOOK);
    expect(mapped.description).toBe('Test description');
    expect(mapped.projectIdentifier).toBe('list-123');
    expect(mapped.taskUrl).toBe('https://app.clickup.com/t/cu-task-789');
  });

  it('should map sync event to ITaskEvent (QUEUED)', () => {
    const rawEvent: IRawTaskEvent = {
      correlationId: 'sync-123',
      webhookEventId: '',
      eventType: 'task.created',
      taskId: 'cu-task-999',
      taskName: 'Synced Task',
      taskDescription: null,
      taskStatus: 'to do',
      listId: 'list-abc',
      listName: 'Test List',
      spaceId: 'space-xyz',
      projectId: 'project-123',
      projectName: 'Test Project',
      taskUrl: 'https://app.clickup.com/t/cu-task-999',
      tags: [],
      customFields: {},
      creatorEmail: 'sync@system.com',
      eventTimestamp: '2026-01-29T01:00:00Z',
      receivedAt: '2026-01-29T01:00:01Z',
    };

    const mapped = mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.SYNC);

    expect(mapped.externalId).toBe('cu-task-999');
    expect(mapped.triggerSource).toBe(TaskTriggerSource.SYNC);
    expect(mapped.internalStatus).toBe('QUEUED');
    expect(mapped.description).toBeNull();
  });
});
