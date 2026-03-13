/**
 * Story 20.1: Task Event Mapper Utilities
 * Story 20.2: Deprecated status functions - use StatusEvaluationService instead
 *
 * Provider-specific mappers to convert raw provider events to ITaskEvent
 */

import { ITaskEvent, TaskProviderType, TaskTriggerSource } from './task-event.dto';
import { IRawTaskEvent } from '../interfaces/ticket-intake.interface';
// Story 20.2: Status mappings removed - replaced by runtime discovery (CS1-2)

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
    internalStatus: 'QUEUED', // CS1-2: replaced by runtime status discovery
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
 * Future: Add mappers for other providers
 * - mapAsanaToTaskEvent(asanaEvent: IAsanaRawEvent, triggerSource: TaskTriggerSource): ITaskEvent
 * - mapJiraToTaskEvent(jiraEvent: IJiraRawEvent, triggerSource: TaskTriggerSource): ITaskEvent
 */
