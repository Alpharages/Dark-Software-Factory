/**
 * Story 20.1: Task Event Mapper Utilities
 *
 * Provider-specific mappers to convert raw provider events to ITaskEvent
 */

import {
  ITaskEvent,
  TaskProviderType,
  TaskTriggerSource,
  InternalTaskStatus,
} from './task-event.dto';
import { IRawTaskEvent } from '../interfaces/ticket-intake.interface';

/**
 * Map ClickUp IRawTaskEvent to provider-agnostic ITaskEvent
 * AC#3: Normalize ClickUp data structures early (at Consumer/Sync level) before reaching queue
 *
 * @param rawEvent - ClickUp-specific raw task event
 * @param triggerSource - SYNC for manual sync, WEBHOOK for webhook events
 * @returns Normalized ITaskEvent for intake processing
 */
export function mapClickUpToTaskEvent(
  rawEvent: IRawTaskEvent,
  triggerSource: TaskTriggerSource,
): ITaskEvent {
  return {
    externalId: rawEvent.taskId,
    providerType: TaskProviderType.CLICKUP,
    internalStatus: mapClickUpStatusToInternal(rawEvent.taskStatus),
    title: rawEvent.taskName,
    description: rawEvent.taskDescription,
    triggerSource,
    correlationId: rawEvent.correlationId,
    projectIdentifier: rawEvent.listId,
    taskUrl: rawEvent.taskUrl,
    tags: rawEvent.tags,
    customFields: rawEvent.customFields,
    creatorEmail: rawEvent.creatorEmail,
    eventTimestamp: rawEvent.eventTimestamp,
    receivedAt: rawEvent.receivedAt,
    originalProviderStatus: rawEvent.taskStatus,
  };
}

/**
 * Map ClickUp status strings to internal actionable statuses
 * AC#1, AC#2: Ensures consistent status mapping for both manual sync and webhook triggers
 *
 * This mapping determines which tickets are actionable (e.g., AI_PROCESSING)
 * and which are not (e.g., COMPLETED, DEPLOYED)
 *
 * @param clickupStatus - ClickUp status string (case-insensitive)
 * @returns Internal status enum value
 */
export function mapClickUpStatusToInternal(clickupStatus: string): InternalTaskStatus {
  const statusMap = new Map<string, InternalTaskStatus>([
    ['to do', 'QUEUED'],
    ['in progress', 'AI_PROCESSING'], // AC#1/#2: Key actionable status
    ['review', 'QA_REVIEW'],
    ['deployed', 'DEPLOYED'],
    ['done', 'COMPLETED'],
    ['closed', 'COMPLETED'],
  ]);

  const normalized = clickupStatus.toLowerCase();
  return statusMap.get(normalized) || 'QUEUED'; // Default to QUEUED for unknown statuses
}

/**
 * Check if an internal status is actionable for AI processing
 * AC#1/#2: Filter for statuses that should trigger AI execution
 *
 * @param status - Internal task status
 * @returns true if status should trigger AI processing
 */
export function isActionableStatus(status: InternalTaskStatus): boolean {
  const actionableStatuses: InternalTaskStatus[] = ['AI_PROCESSING', 'QUEUED', 'VALIDATED'];
  return actionableStatuses.includes(status);
}

/**
 * Future: Add mappers for other providers
 * - mapAsanaToTaskEvent(asanaEvent: IAsanaRawEvent, triggerSource: TaskTriggerSource): ITaskEvent
 * - mapJiraToTaskEvent(jiraEvent: IJiraRawEvent, triggerSource: TaskTriggerSource): ITaskEvent
 */
