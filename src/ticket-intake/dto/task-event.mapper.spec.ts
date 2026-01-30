import { describe, it, expect } from '@jest/globals';
import { TaskProviderType, TaskTriggerSource } from '../dto/task-event.dto';
import { IRawTaskEvent } from '../interfaces/ticket-intake.interface';
import {
  mapClickUpToTaskEvent,
  mapClickUpStatusToInternal,
  isActionableStatus,
} from './task-event.mapper';

/**
 * Story 20.1: Task Event Mapper Tests
 * Tests for mapping provider-specific events to ITaskEvent
 */

describe('ClickUp to ITaskEvent Mapping', () => {
  it('should map webhook event to ITaskEvent with correct fields', () => {
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
    expect(mapped.internalStatus).toBe('AI_PROCESSING');
    expect(mapped.title).toBe('Test Task');
    expect(mapped.triggerSource).toBe(TaskTriggerSource.WEBHOOK);
    expect(mapped.description).toBe('Test description');
    expect(mapped.projectIdentifier).toBe('list-123');
    expect(mapped.taskUrl).toBe('https://app.clickup.com/t/cu-task-789');
  });

  it('should map sync event to ITaskEvent with SYNC trigger source', () => {
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

describe('Task Status Mapping', () => {
  it('should map ClickUp "to do" to QUEUED', () => {
    const internalStatus = mapClickUpStatusToInternal('to do');
    expect(internalStatus).toBe('QUEUED');
  });

  it('should map ClickUp "in progress" to AI_PROCESSING', () => {
    const internalStatus = mapClickUpStatusToInternal('in progress');
    expect(internalStatus).toBe('AI_PROCESSING');
  });

  it('should map ClickUp "review" to QA_REVIEW', () => {
    const internalStatus = mapClickUpStatusToInternal('review');
    expect(internalStatus).toBe('QA_REVIEW');
  });

  it('should map ClickUp "done" to COMPLETED', () => {
    const internalStatus = mapClickUpStatusToInternal('done');
    expect(internalStatus).toBe('COMPLETED');
  });

  it('should map unknown status to QUEUED as fallback', () => {
    const internalStatus = mapClickUpStatusToInternal('unknown-status');
    expect(internalStatus).toBe('QUEUED');
  });
});

describe('Actionable Status Check', () => {
  it('should identify AI_PROCESSING as actionable', () => {
    expect(isActionableStatus('AI_PROCESSING')).toBe(true);
  });

  it('should identify QUEUED as actionable', () => {
    expect(isActionableStatus('QUEUED')).toBe(true);
  });

  it('should identify VALIDATED as actionable', () => {
    expect(isActionableStatus('VALIDATED')).toBe(true);
  });

  it('should identify COMPLETED as non-actionable', () => {
    expect(isActionableStatus('COMPLETED')).toBe(false);
  });

  it('should identify DEPLOYED as non-actionable', () => {
    expect(isActionableStatus('DEPLOYED')).toBe(false);
  });

  it('should identify QA_REVIEW as non-actionable', () => {
    expect(isActionableStatus('QA_REVIEW')).toBe(false);
  });
});
