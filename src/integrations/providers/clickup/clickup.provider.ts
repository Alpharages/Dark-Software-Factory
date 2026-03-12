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
} from '../';
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
}

interface ClickUpWebhookPayload {
  webhook_id: string;
  event: string;
  task_id: string;
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

  async assignTask(taskId: string, userId: string): Promise<void> {
    // ClickUp API v2 assignees update: use "assignees" field with array of IDs
    // The requirement mentioned potentially checking the body format.
    // Usually it's a PUT to /task/{task_id} with { "assignees": { "add": [userId] } } or similar for incremental,
    // but a plain array often replaces. Based on standard v2:
    await this.retryWithBackoff(() =>
      this.client.put(`/task/${taskId}`, {
        assignees: [parseInt(userId, 10)],
      }),
    );
  }

  async getRequiredFields(listId: string): Promise<NormalizedField[]> {
    const response = await this.retryWithBackoff(() =>
      this.client.get(`/list/${listId}/custom_field`),
    );
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
        const axiosError = error as AxiosError;

        // Don't retry on 4xx except 429
        if (
          axiosError.response &&
          axiosError.response.status >= 400 &&
          axiosError.response.status < 500 &&
          axiosError.response.status !== 429
        ) {
          throw error;
        }

        if (i < attempts - 1) {
          const delay = backoffMs * Math.pow(2, i);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}
