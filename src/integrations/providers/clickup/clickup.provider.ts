import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '@nestjs/common';
import {
  IPMProvider,
  NormalizedTask,
  NormalizedStatus,
  NormalizedStatusType,
  NormalizedField,
  NormalizedFieldType,
  NormalizedSelf,
  WebhookRegistrationResult,
  FieldValue,
  PMProviderClientError,
} from '../';
import { NormalizedComment } from '../dto/normalized-comment.dto';
import { IRawTaskEvent } from '../../../ticket-intake/interfaces/ticket-intake.interface';

// Raw ClickUp API response shapes (internal only)
interface ClickUpStatus {
  id?: string;
  status: string;
  color: string;
  type?: string;
}

interface ClickUpAssignee {
  id: number;
  username: string;
  email: string;
}

interface ClickUpTag {
  name: string;
}

interface ClickUpFieldOption {
  id: string;
  label?: string;
  name?: string;
  color?: string;
  value?: unknown;
}

interface ClickUpCustomField {
  id: string;
  name?: string;
  value: unknown;
}

interface ClickUpField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  type_config?: { options?: ClickUpFieldOption[] };
}

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  status?: { id?: string; status: string; color?: string; type?: string };
  url: string;
  assignees?: ClickUpAssignee[];
  tags?: ClickUpTag[];
  custom_fields?: ClickUpCustomField[];
  priority?: { priority: string };
  date_created?: string;
  date_updated?: string;
  date_closed?: string;
  due_date?: string | null;
  list?: { id: string };
  creator?: { id: number; username: string; email: string };
  space?: { id: string };
}

export type ClickUpListTask = ClickUpTask;

interface ClickUpWebhookPayload {
  webhook_id: string;
  event: string;
  task_id: string;
}

interface ClickUpComment {
  id: string;
  comment_text?: string;
  date: string;
  user?: { id?: number; username?: string };
}

export class ClickUpProvider implements IPMProvider {
  private readonly logger = new Logger(ClickUpProvider.name);
  private readonly client: AxiosInstance;
  private readonly statusCache = new Map<
    string,
    { statuses: NormalizedStatus[]; expiresAt: number }
  >();
  private readonly CACHE_TTL = 3600000; // 1 hour

  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string = 'https://api.clickup.com/api/v2',
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: this.accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async getSelf(): Promise<NormalizedSelf> {
    const response = await this.retryWithBackoff(() => this.client.get('/user'));
    const user = response.data.user;
    return {
      id: user.id.toString(),
      name: user.username,
      email: user.email,
    };
  }

  async getStatuses(listId: string): Promise<NormalizedStatus[]> {
    const now = Date.now();
    const cached = this.statusCache.get(listId);
    if (cached && cached.expiresAt > now) {
      return cached.statuses;
    }

    const response = await this.retryWithBackoff(() => this.client.get(`/list/${listId}`));
    const clickupStatuses: ClickUpStatus[] = response.data.statuses || [];
    const statuses = clickupStatuses.map((s) => ({
      id: s.id || s.status, // ClickUp sometimes uses names as IDs for statuses
      name: s.status,
      color: s.color,
      type: this.mapStatusType(s.type || s.status),
    }));

    this.statusCache.set(listId, {
      statuses,
      expiresAt: now + this.CACHE_TTL,
    });

    return statuses;
  }

  async getTask(taskId: string): Promise<NormalizedTask> {
    const response = await this.retryWithBackoff(() => this.client.get(`/task/${taskId}`));
    const task = response.data;
    return this.mapTask(task);
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    await this.retryWithBackoff(() =>
      this.client.put(`/task/${taskId}`, {
        status,
      }),
    );
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    await this.retryWithBackoff(() =>
      this.client.post(`/task/${taskId}/comment`, {
        comment_text: comment,
        notify_all: false,
      }),
    );
  }

  async getComments(taskId: string): Promise<NormalizedComment[]> {
    const response = await this.retryWithBackoff(() => this.client.get(`/task/${taskId}/comment`));
    const raw: ClickUpComment[] = response.data.comments || [];
    return raw.map((c) => ({
      id: c.id,
      // ClickUp returns rich comments as a `comment` block array; `comment_text`
      // is the flattened plaintext of the same content and is what we act on.
      text: c.comment_text ?? '',
      authorId: c.user?.id?.toString() ?? '',
      authorName: c.user?.username ?? '',
      // ClickUp `date` is a Unix-ms timestamp delivered as a string.
      createdAt: new Date(Number(c.date)),
    }));
  }

  async assignTask(taskId: string, userId: string): Promise<void> {
    await this.retryWithBackoff(() =>
      this.client.put(`/task/${taskId}`, {
        assignees: [parseInt(userId, 10)],
      }),
    );
  }

  async prepareForTransition(
    taskId: string,
    opts: {
      assigneeId?: string;
      dueDateMs?: number;
      timeEstimateMs?: number;
    },
  ): Promise<void> {
    // Build a single PUT payload with all requested fields to minimise API calls
    const body: Record<string, unknown> = {};

    if (opts.assigneeId !== undefined) {
      body.assignees = [parseInt(opts.assigneeId, 10)];
    }
    if (opts.dueDateMs !== undefined) {
      body.due_date = opts.dueDateMs;
      body.due_date_time = true; // include time component
    }
    if (opts.timeEstimateMs !== undefined) {
      body.time_estimate = opts.timeEstimateMs;
    }

    if (Object.keys(body).length === 0) return;

    await this.retryWithBackoff(() => this.client.put(`/task/${taskId}`, body));
  }

  async getRequiredFields(listId: string): Promise<NormalizedField[]> {
    const response = await this.retryWithBackoff(() => this.client.get(`/list/${listId}/field`));
    const fields: ClickUpField[] = response.data.fields || [];
    return fields.filter((f) => f.required).map((f) => this.mapField(f));
  }

  async setFieldValue(taskId: string, fieldId: string, value: FieldValue): Promise<void> {
    await this.retryWithBackoff(() =>
      this.client.post(`/task/${taskId}/custom_field/${fieldId}`, {
        value,
      }),
    );
  }

  async registerWebhook(listId: string, webhookUrl: string): Promise<WebhookRegistrationResult> {
    // ClickUp requires team_id for webhooks. For now we assume we might need to find it or it's passed.
    // However, the interface only takes contextId (listId).
    // We can get the team_id from the list or the user.
    const listRes = await this.retryWithBackoff(() => this.client.get(`/list/${listId}`));
    const teamId = listRes.data.team_id || listRes.data.project.team_id;

    const response = await this.retryWithBackoff(() =>
      this.client.post(`/team/${teamId}/webhook`, {
        endpoint: webhookUrl,
        events: ['taskCreated', 'taskStatusUpdated', 'taskCommentPosted'],
      }),
    );
    return { id: response.data.id };
  }

  async deregisterWebhook(webhookId: string): Promise<void> {
    await this.retryWithBackoff(() => this.client.delete(`/webhook/${webhookId}`));
  }

  async getList(listId: string): Promise<{ id: string; name: string }> {
    const response = await this.retryWithBackoff(() => this.client.get(`/list/${listId}`));
    return { id: response.data.id, name: response.data.name };
  }

  async getTasksFromList(
    listId: string,
    page: number = 0,
    limit: number = 100,
  ): Promise<{ tasks: ClickUpListTask[] }> {
    const response = await this.retryWithBackoff(() =>
      this.client.get(`/list/${listId}/task`, {
        params: {
          order_by: 'updated',
          reverse: 'true',
          page: page.toString(),
          limit: limit.toString(),
          // Include subtasks so a ticket created as a subtask is still imported
          // and dispatched (ClickUp's list endpoint returns only top-level tasks
          // otherwise). Matches the polling path (getUpdatedTasks).
          subtasks: 'true',
        },
      }),
    );
    // ClickUp can return the same task twice when subtasks are included (surfaced
    // both directly and as another task's subtask); dedup by id so each ticket
    // yields a single intake/dispatch (OHP-2.6 idempotency finding).
    const raw: ClickUpListTask[] = response.data.tasks || [];
    const seen = new Set<string>();
    const tasks = raw.filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
    return { tasks };
  }

  async getUpdatedTasks(teamId: string, since: Date): Promise<NormalizedTask[]> {
    // ClickUp API expects Unix timestamp in milliseconds for date_updated_gt
    const timestamp = since.getTime();
    const response = await this.retryWithBackoff(() =>
      this.client.get(`/team/${teamId}/task`, {
        params: {
          date_updated_gt: timestamp,
          include_closed: true,
          subtasks: true,
          order_by: 'updated',
        },
      }),
    );
    const rawTasks: ClickUpTask[] = response.data.tasks || [];
    // Deduplicate by task id before mapping. ClickUp's `/team/{id}/task` endpoint
    // with `subtasks: true` can return the same task more than once (e.g. a task
    // surfaced both directly and as a subtask of another updated task). Without
    // this, each duplicate becomes a separate intake message and triggers a
    // redundant dispatch for one status event (OHP-2.6 idempotency finding).
    const seen = new Set<string>();
    const tasks = rawTasks.filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
    return Promise.all(
      tasks.map(async (task) => {
        const normalized = this.mapTask(task);
        if (normalized.description) return normalized;
        const fullTask = await this.getTask(task.id);
        return { ...normalized, description: fullTask.description };
      }),
    );
  }

  normalizeEvent(payload: unknown): IRawTaskEvent {
    const event = payload as ClickUpWebhookPayload;
    return {
      correlationId: `cu-${event.webhook_id}-${Date.now()}`,
      webhookEventId: event.webhook_id,
      eventType: event.event,
      taskId: event.task_id,
      // Note: Webhook payload usually doesn't have full task details,
      // but IRawTaskEvent requires them. The intake service usually fetches full details.
      // Here we provide what's in the payload or placeholders.
      taskName: '',
      taskDescription: '',
      taskStatus: '',
      listId: '',
      listName: '',
      spaceId: '',
      projectId: '',
      projectName: '',
      taskUrl: `https://app.clickup.com/t/${event.task_id}`,
      tags: [],
      customFields: {},
      creatorEmail: '',
      eventTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
  }

  private mapTask(task: ClickUpTask): NormalizedTask {
    return {
      id: task.id,
      name: task.name,
      description: task.description || task.text_content || null,
      status: {
        id: task.status?.id || task.status?.status || '',
        name: task.status?.status || '',
        color: task.status?.color ?? null,
        type: this.mapStatusType(task.status?.type || task.status?.status || ''),
      },
      url: task.url,
      assignees: task.assignees?.map((a) => ({
        id: a.id.toString(),
        name: a.username,
        email: a.email,
      })),
      tags: task.tags?.map((t) => t.name),
      customFields: task.custom_fields?.reduce<Record<string, unknown>>((acc, f) => {
        acc[f.id] = f.value;
        return acc;
      }, {}),
      priority: task.priority?.priority,
      dateCreated: task.date_created,
      dateUpdated: task.date_updated,
      dateClosed: task.date_closed,
      dueDate: task.due_date ?? null,
      listId: task.list?.id || '',
    };
  }

  private mapStatusType(typeOrStatus: string): NormalizedStatusType {
    const s = typeOrStatus.toLowerCase();
    if (s === 'open' || s === 'to do' || s === 'todo') return NormalizedStatusType.TODO;
    if (s === 'closed' || s === 'complete' || s === 'done') return NormalizedStatusType.DONE;
    if (s === 'canceled' || s === 'cancelled') return NormalizedStatusType.CANCELLED;
    if (s === 'custom' || s === 'in progress' || s === 'doing')
      return NormalizedStatusType.IN_PROGRESS;
    return NormalizedStatusType.OTHER;
  }

  private mapField(f: ClickUpField): NormalizedField {
    return {
      id: f.id,
      name: f.name,
      type: this.mapFieldType(f.type),
      required: f.required || false,
      options: f.type_config?.options?.map((o) => ({
        id: o.id,
        label: o.label ?? o.name ?? '',
        color: o.color,
        value: o.value as FieldValue | undefined,
      })),
    };
  }

  private mapFieldType(type: string): NormalizedFieldType {
    switch (type) {
      case 'short_text':
      case 'text':
        return NormalizedFieldType.TEXT;
      case 'number':
        return NormalizedFieldType.NUMBER;
      case 'date':
        return NormalizedFieldType.DATE;
      case 'drop_down':
        return NormalizedFieldType.DROPDOWN;
      case 'labels':
        return NormalizedFieldType.LABELS;
      case 'users':
        return NormalizedFieldType.USER;
      case 'checkbox':
        return NormalizedFieldType.CHECKBOX;
      case 'url':
        return NormalizedFieldType.URL;
      default:
        return NormalizedFieldType.OTHER;
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    attempts: number = 3,
    backoffMs: number = 1000,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Wrap 4xx AxiosErrors into PMProviderClientError before classifying
        if (error instanceof AxiosError && error.response) {
          const status = error.response.status;
          if (status >= 400 && status < 500 && status !== 429) {
            const body = error.response.data as Record<string, unknown> | null | undefined;
            throw new PMProviderClientError(
              status,
              typeof body?.ECODE === 'string' ? body.ECODE : undefined,
              body,
            );
          }
        }

        if (!PMProviderClientError.isRetryable(error)) {
          throw error;
        }

        if (i < attempts - 1) {
          const delay = backoffMs * Math.pow(2, i);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    // NOTE: exhausted 5xx/network retries throw the raw AxiosError (not PMProviderClientError).
    // Callers (e.g. DeploymentStatusSyncService in CS3-2) must handle both error types:
    //   - PMProviderClientError → 4xx permanent failure
    //   - AxiosError (5xx/network) → transient failure after all retries exhausted
    throw lastError;
  }
}
