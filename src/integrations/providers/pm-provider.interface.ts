import { IRawTaskEvent } from '../../ticket-intake/interfaces/ticket-intake.interface';
import { NormalizedTask } from './dto/normalized-task.dto';
import { NormalizedStatus } from './dto/normalized-status.dto';
import { NormalizedField, FieldValue } from './dto/normalized-field.dto';
import { NormalizedSelf, WebhookRegistrationResult } from './dto/normalized-self.dto';

/**
 * Interface for Project Management tool providers (ClickUp, Jira, Asana, etc.)
 * FR-CS0B: IPMProvider interface
 */
export interface IPMProvider {
  /** Get details of the authenticated bot user. */
  getSelf(): Promise<NormalizedSelf>;

  /** Get all available statuses for a specific project/list. */
  getStatuses(contextId: string): Promise<NormalizedStatus[]>;

  /** Fetch a specific task by ID. */
  getTask(taskId: string): Promise<NormalizedTask>;

  /** Update the status of a task. */
  updateStatus(taskId: string, statusId: string): Promise<void>;

  /** Add a comment to a task. */
  addComment(taskId: string, comment: string): Promise<void>;

  /** Assign a user to a task. */
  assignTask(taskId: string, userId: string): Promise<void>;

  /**
   * Set task prerequisites in a single call before a status transition.
   * Used to satisfy workspace automation rules (e.g. "must have assignee before In Progress").
   */
  prepareForTransition(
    taskId: string,
    opts: {
      assigneeId?: string;
      /** Unix timestamp in milliseconds */
      dueDateMs?: number;
      /** Estimated time in milliseconds */
      timeEstimateMs?: number;
    },
  ): Promise<void>;

  /** Get fields that are marked as required in the PM tool for a given context. */
  getRequiredFields(contextId: string): Promise<NormalizedField[]>;

  /** Set a custom field value on a task. */
  setFieldValue(taskId: string, fieldId: string, value: FieldValue): Promise<void>;

  /** Register a webhook in the PM tool for task events. */
  registerWebhook(
    contextId: string,
    webhookUrl: string,
    secret?: string,
  ): Promise<WebhookRegistrationResult>;

  /** Remove a previously registered webhook. */
  deregisterWebhook(webhookId: string): Promise<void>;

  /**
   * Normalize a raw provider webhook payload into a standard IRawTaskEvent.
   *
   * NOTE: IRawTaskEvent uses ClickUp-derived field names (listId, listName, spaceId).
   * Non-ClickUp providers must map equivalent concepts (e.g. Jira project → spaceId,
   * Jira board → listId). A provider-agnostic event type is tracked for Epic CS1+.
   */
  normalizeEvent(payload: unknown): IRawTaskEvent;

  /**
   * Fetch tasks updated since a specific date for a given workspace.
   * FR-CS0I: Provider-agnostic task fetch via IPMProvider
   */
  getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>;
}
