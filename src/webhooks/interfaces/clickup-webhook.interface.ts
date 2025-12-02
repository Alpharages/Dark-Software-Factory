/**
 * ClickUp Webhook Payload Interfaces
 *
 * Per architecture.md:
 * - Webhook events: `taskCreated`, `taskUpdated`, `taskStatusChanged`
 * - Payload includes: task details, custom fields, comments, attachments
 *
 * Reference: https://clickup.com/api/developer-portal/webhooksevents
 */

/**
 * ClickUp webhook event types supported by the orchestrator
 */
export enum ClickUpEventType {
  TASK_CREATED = 'taskCreated',
  TASK_UPDATED = 'taskUpdated',
  TASK_STATUS_UPDATED = 'taskStatusUpdated',
  TASK_COMMENT_POSTED = 'taskCommentPosted',
  TASK_DELETED = 'taskDeleted',
}

/**
 * Webhook events the orchestrator will process
 * Other events are acknowledged but not processed
 */
export const PROCESSABLE_EVENTS: ClickUpEventType[] = [
  ClickUpEventType.TASK_CREATED,
  ClickUpEventType.TASK_UPDATED,
];

/**
 * Raw ClickUp webhook payload structure
 */
export interface IClickUpWebhookPayload {
  /** Unique webhook event ID - used for idempotency */
  webhook_id: string;

  /** Event type (e.g., 'taskCreated', 'taskUpdated') */
  event: string;

  /** Timestamp when the event occurred */
  history_items?: IClickUpHistoryItem[];

  /** The task data */
  task_id: string;

  /** Full task object (may be partial for updates) */
  task?: IClickUpTask;
}

/**
 * History item in webhook payload
 */
export interface IClickUpHistoryItem {
  id: string;
  type: number;
  date: string;
  field: string;
  parent_id: string;
  data?: Record<string, unknown>;
  source?: string;
  user: {
    id: number;
    username: string;
    email: string;
    color: string;
    initials: string;
    profilePicture?: string;
  };
  before?: unknown;
  after?: unknown;
}

/**
 * ClickUp Task structure from webhook
 */
export interface IClickUpTask {
  id: string;
  custom_id?: string;
  name: string;
  text_content?: string;
  description?: string;
  status: {
    id: string;
    status: string;
    color: string;
    type: string;
    orderindex: number;
  };
  orderindex: string;
  date_created: string;
  date_updated: string;
  date_closed?: string;
  date_done?: string;
  creator: {
    id: number;
    username: string;
    color: string;
    email: string;
    profilePicture?: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    color: string;
    email: string;
    initials: string;
    profilePicture?: string;
  }>;
  watchers: Array<{
    id: number;
    username: string;
    color: string;
    initials: string;
    profilePicture?: string;
  }>;
  checklists: unknown[];
  tags: Array<{
    name: string;
    tag_fg: string;
    tag_bg: string;
  }>;
  parent?: string;
  priority?: {
    id: string;
    priority: string;
    color: string;
    orderindex: string;
  };
  due_date?: string;
  start_date?: string;
  points?: number;
  time_estimate?: number;
  time_spent?: number;
  custom_fields?: IClickUpCustomField[];
  dependencies?: unknown[];
  linked_tasks?: unknown[];
  team_id: string;
  url: string;
  list: {
    id: string;
    name: string;
    access: boolean;
  };
  project: {
    id: string;
    name: string;
    hidden: boolean;
    access: boolean;
  };
  folder: {
    id: string;
    name: string;
    hidden: boolean;
    access: boolean;
  };
  space: {
    id: string;
  };
}

/**
 * ClickUp Custom Field structure
 */
export interface IClickUpCustomField {
  id: string;
  name: string;
  type: string;
  type_config: Record<string, unknown>;
  date_created: string;
  hide_from_guests: boolean;
  value?: unknown;
  required: boolean;
}

/**
 * Processed webhook event ready for internal consumption
 */
export interface IProcessedWebhookEvent {
  /** Correlation ID for tracing */
  correlationId: string;

  /** Original webhook event ID (for idempotency) */
  webhookEventId: string;

  /** Event type */
  eventType: ClickUpEventType;

  /** ClickUp task ID */
  taskId: string;

  /** Parsed task data */
  task: IClickUpTask | null;

  /** When the event was received */
  receivedAt: Date;

  /** Raw payload for audit logging */
  rawPayload: IClickUpWebhookPayload;
}
