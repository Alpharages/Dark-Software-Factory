/**
 * Story 20.1: Provider-Agnostic Task Event Interface
 *
 * Normalized event format used across all project management providers
 * (ClickUp, Asana, Jira, etc.) for consistent intake processing.
 */

/** Provider type enum */
export enum TaskProviderType {
  CLICKUP = 'CLICKUP',
  ASANA = 'ASANA',
  JIRA = 'JIRA',
  UNKNOWN = 'UNKNOWN',
}

/** Event trigger source */
export enum TaskTriggerSource {
  /** Manual sync via Projects UI */
  SYNC = 'SYNC',
  /** Webhook from provider */
  WEBHOOK = 'WEBHOOK',
}

/** Internal actionable statuses after provider mapping */
export type InternalTaskStatus =
  | 'QUEUED'
  | 'VALIDATED'
  | 'AI_PROCESSING'
  | 'QA_REVIEW'
  | 'WAITING'
  | 'BLOCKED_CIRCULAR'
  | 'VALIDATION_FAILED'
  | 'COMPLETED'
  | 'DEPLOYED';

/**
 * Provider-agnostic task event
 * AC#3: Common ITaskEvent interface/DTO for all provider events
 *
 * This interface abstracts provider-specific details into a normalized format
 * before events reach the ticket-intake-queue, ensuring provider-agnostic intake logic.
 */
export interface ITaskEvent {
  /** External provider task ID (e.g., ClickUp task_id, Asana gid, Jira key) */
  externalId: string;

  /** Provider type that originated this event */
  providerType: TaskProviderType;

  /** Mapped internal status indicating ticket actionability */
  internalStatus: InternalTaskStatus;

  /** Task title/name */
  title: string;

  /** Task description/content */
  description: string | null;

  /** How this event was triggered (manual sync or webhook) */
  triggerSource: TaskTriggerSource;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Project identifier (list_id for ClickUp, project_gid for Asana, etc.) */
  projectIdentifier: string;

  /** Task URL for linking back to provider */
  taskUrl: string;

  /** Task tags/labels */
  tags?: string[];

  /** Custom fields from provider (optional, provider-specific) */
  customFields?: Record<string, unknown>;

  /** Creator/author email if available */
  creatorEmail?: string;

  /** Event timestamp from provider */
  eventTimestamp?: string;

  /** Received timestamp on our system */
  receivedAt?: string;

  /** Original provider status (before mapping) */
  originalProviderStatus?: string;
}
