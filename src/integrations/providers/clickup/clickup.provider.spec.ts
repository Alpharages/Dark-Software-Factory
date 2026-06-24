import axios, { AxiosError } from 'axios';
import { ClickUpProvider } from './clickup.provider';
import { NormalizedStatusType, NormalizedFieldType, PMProviderClientError } from '../';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeAxiosError(status: number, data?: unknown): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data: data ?? {},
    headers: {},
    config: {} as AxiosError['config'],
    statusText: String(status),
  } as AxiosError['response'];
  return error;
}

interface MockAxiosInstance {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
}

describe('ClickUpProvider', () => {
  let provider: ClickUpProvider;
  let mockAxiosInstance: MockAxiosInstance;
  const accessToken = 'test-token';

  beforeEach(() => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    provider = new ClickUpProvider(accessToken);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSelf', () => {
    it('should return normalized user info', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          user: { id: 123, username: 'testuser', email: 'test@example.com' },
        },
      });

      const result = await provider.getSelf();

      expect(result).toEqual({
        id: '123',
        name: 'testuser',
        email: 'test@example.com',
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/user');
    });
  });

  describe('getStatuses', () => {
    const listId = 'list-123';

    it('should return normalized statuses and cache them', async () => {
      const clickupStatuses = [
        { id: 's1', status: 'to do', color: '#ccc', type: 'open' },
        { id: 's2', status: 'done', color: '#0f0', type: 'closed' },
      ];
      mockAxiosInstance.get.mockResolvedValue({
        data: { statuses: clickupStatuses },
      });

      const result1 = await provider.getStatuses(listId);
      const result2 = await provider.getStatuses(listId);

      expect(result1).toHaveLength(2);
      expect(result1[0].type).toBe(NormalizedStatusType.TODO);
      expect(result2).toEqual(result1);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // Second call should be from cache
    });
  });

  describe('getTask', () => {
    it('should return normalized task', async () => {
      const clickupTask = {
        id: 'task-1',
        name: 'Task 1',
        description: 'Desc',
        status: { status: 'to do', color: '#000' },
        url: 'https://clickup.com/t/task-1',
        assignees: [{ id: 456, username: 'assignee1', email: 'a1@ex.com' }],
        tags: [{ name: 'tag1' }],
        custom_fields: [{ id: 'f1', value: 'val1' }],
        priority: { priority: 'high' },
        date_created: '123456789',
      };
      mockAxiosInstance.get.mockResolvedValue({ data: clickupTask });

      const result = await provider.getTask('task-1');

      expect(result.id).toBe('task-1');
      expect(result.assignees).toHaveLength(1);
      expect(result.assignees![0].id).toBe('456');
      expect(result.tags).toEqual(['tag1']);
      expect(result.customFields).toEqual({ f1: 'val1' });
    });
  });

  describe('getUpdatedTasks', () => {
    it('hydrates description when the team task list omits it', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: {
            tasks: [
              {
                id: 'task-1',
                name: 'Task 1',
                status: { status: 'in progress', color: '#000' },
                url: 'https://clickup.com/t/task-1',
                date_updated: '123456789',
                list: { id: 'list-1' },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: 'task-1',
            name: 'Task 1',
            description:
              '## Acceptance Criteria\nGiven validation When polling runs Then intake succeeds',
            status: { status: 'in progress', color: '#000' },
            url: 'https://clickup.com/t/task-1',
          },
        });

      const result = await provider.getUpdatedTasks('team-1', new Date(1000));

      expect(result[0].description).toContain('Acceptance Criteria');
      expect(result[0].listId).toBe('list-1');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/team/team-1/task', {
        params: {
          date_updated_gt: 1000,
          include_closed: true,
          subtasks: true,
          order_by: 'updated',
        },
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/task/task-1');
    });

    it('deduplicates tasks returned more than once by the team task endpoint', async () => {
      // ClickUp can surface the same task multiple times when subtasks:true.
      // Each duplicate would otherwise become a separate intake/dispatch (OHP-2.6).
      const dupTask = {
        id: 'task-dup',
        name: 'Dup Task',
        description: 'has body',
        status: { status: 'to do', color: '#000' },
        url: 'https://clickup.com/t/task-dup',
        date_updated: '123456789',
        list: { id: 'list-1' },
      };
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { tasks: [dupTask, dupTask, dupTask] },
      });

      const result = await provider.getUpdatedTasks('team-1', new Date(1000));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task-dup');
    });
  });

  describe('updateStatus', () => {
    it('should call PUT /task/:id', async () => {
      mockAxiosInstance.put.mockResolvedValue({ status: 200 });

      await provider.updateStatus('task-1', 'done');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/task/task-1', {
        status: 'done',
      });
    });
  });

  describe('addComment', () => {
    it('should call POST /task/:id/comment', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 200 });

      await provider.addComment('task-1', 'hello');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/task/task-1/comment', {
        comment_text: 'hello',
        notify_all: false,
      });
    });
  });

  describe('assignTask', () => {
    it('should call PUT /task/:id with assignees array', async () => {
      mockAxiosInstance.put.mockResolvedValue({ status: 200 });

      await provider.assignTask('task-1', '456');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/task/task-1', {
        assignees: [456],
      });
    });
  });

  describe('getRequiredFields', () => {
    it('should filter and normalize required custom fields', async () => {
      const clickupFields = [
        { id: 'f1', name: 'Field 1', type: 'short_text', required: true },
        { id: 'f2', name: 'Field 2', type: 'drop_down', required: false },
      ];
      mockAxiosInstance.get.mockResolvedValue({ data: { fields: clickupFields } });

      const result = await provider.getRequiredFields('list-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('f1');
      expect(result[0].type).toBe(NormalizedFieldType.TEXT);
    });
  });

  describe('setFieldValue', () => {
    it('should call POST /task/:id/custom_field/:fieldId', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 200 });

      await provider.setFieldValue('task-1', 'field-1', 'new-value');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/task/task-1/custom_field/field-1', {
        value: 'new-value',
      });
    });
  });

  describe('registerWebhook', () => {
    it('should fetch teamId and then register webhook', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { team_id: 'team-789' } });
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'webhook-1' } });

      const result = await provider.registerWebhook('list-1', 'https://wh.com');

      expect(result.id).toBe('webhook-1');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/list/list-1');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/team/team-789/webhook', {
        endpoint: 'https://wh.com',
        events: ['taskCreated', 'taskStatusUpdated', 'taskCommentPosted'],
      });
    });
  });

  describe('deregisterWebhook', () => {
    it('should call DELETE /webhook/:id', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ status: 200 });

      await provider.deregisterWebhook('wh-1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/webhook/wh-1');
    });
  });

  describe('normalizeEvent', () => {
    it('should map minimal webhook payload to IRawTaskEvent', () => {
      const payload = {
        webhook_id: 'wh-1',
        event: 'taskCreated',
        task_id: 'task-1',
      };

      const result = provider.normalizeEvent(payload);

      expect(result.taskId).toBe('task-1');
      expect(result.eventType).toBe('taskCreated');
      expect(result.webhookEventId).toBe('wh-1');
    });
  });

  describe('retry logic', () => {
    it('T-C5: should retry on 5xx errors up to 3 attempts', async () => {
      const error = makeAxiosError(500);

      mockAxiosInstance.get
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { user: { id: 1, username: 'u', email: 'e' } } });

      const result = await provider.getSelf();
      expect(result.id).toBe('1');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
    });

    it('T-C4: should NOT retry on 404 errors', async () => {
      const error = makeAxiosError(404);

      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.getSelf()).rejects.toThrow(PMProviderClientError);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('T-C1: should throw PMProviderClientError on 4xx AxiosError', async () => {
      const error = makeAxiosError(400);
      mockAxiosInstance.get.mockRejectedValue(error);

      try {
        await provider.getSelf();
        throw new Error('Should have thrown PMProviderClientError');
      } catch (e) {
        expect(e).toBeInstanceOf(PMProviderClientError);
        expect((e as PMProviderClientError).httpStatus).toBe(400);
      }
    });

    it('T-C2: should set providerErrorCode from ECODE in body', async () => {
      expect.assertions(1);
      const error = makeAxiosError(403, { ECODE: 'OAUTH_017' });
      mockAxiosInstance.get.mockRejectedValue(error);

      try {
        await provider.getSelf();
      } catch (e) {
        expect((e as PMProviderClientError).providerErrorCode).toBe('OAUTH_017');
      }
    });

    it('T-C3: should set providerErrorCode to undefined if no ECODE', async () => {
      expect.assertions(1);
      const error = makeAxiosError(400, { err: 'Some error' });
      mockAxiosInstance.get.mockRejectedValue(error);

      try {
        await provider.getSelf();
      } catch (e) {
        expect((e as PMProviderClientError).providerErrorCode).toBeUndefined();
      }
    });

    it('T-C6: should retry on 429 errors (rate limit)', async () => {
      const error = makeAxiosError(429);
      mockAxiosInstance.get
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { user: { id: 1, username: 'u', email: 'e' } } });

      const result = await provider.getSelf();
      expect(result.id).toBe('1');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('T-C7: should return result on 2nd attempt after transient 5xx', async () => {
      const error = makeAxiosError(503);
      mockAxiosInstance.get
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { user: { id: 1, username: 'u', email: 'e' } } });

      const result = await provider.getSelf();
      expect(result.id).toBe('1');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});
