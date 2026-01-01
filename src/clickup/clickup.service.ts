import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SentryService } from '../common/sentry/sentry.service';
import axios, { AxiosInstance, AxiosError } from 'axios';

interface ClickUpStatus {
  id: string;
  status: string;
  orderindex: number;
  color: string;
}

export interface ClickUpHierarchy {
  spaces: {
    id: string;
    name: string;
    lists: {
      id: string;
      name: string;
    }[];
  }[];
}

interface ClickUpTask {
  id: string;
  name: string;
  status?: {
    status: string;
    statuses?: ClickUpStatus[];
  };
}

/**
 * ClickUp API Integration Service
 * Story 4.6: Deployment Status Synchronization
 *
 * Responsibilities:
 * - Update ticket status via ClickUp API
 * - Add comments to tickets with markdown formatting
 * - Retry logic with exponential backoff (3 attempts: 1s, 2s, 4s)
 * - Rate limit detection and handling (HTTP 429)
 * - Status name → ID resolution with 1-hour cache TTL
 */
@Injectable()
export class ClickUpService {
  private readonly logger = new Logger(ClickUpService.name);
  private readonly client: AxiosInstance;
  private readonly statusNameToIdCache = new Map<string, { id: string; expiresAt: Date }>();
  private readonly retryAttempts: number;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly sentry: SentryService,
  ) {
    const apiKey = this.config.get<string>('CLICKUP_API_KEY');

    // C5: Validate CLICKUP_API_KEY is configured
    if (!apiKey) {
      throw new Error('CLICKUP_API_KEY is required but not configured in environment');
    }

    const baseURL = this.config.get<string>(
      'CLICKUP_API_BASE_URL',
      'https://api.clickup.com/api/v2',
    );

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    this.retryAttempts = this.config.get<number>('CLICKUP_RETRY_ATTEMPTS', 3);
    this.retryBackoffMs = this.config.get<number>('CLICKUP_RETRY_BACKOFF_MS', 1000);
  }

  /**
   * Update ClickUp task status
   * AC#1: Status name → ID resolution with caching
   * AC#3: Retry with exponential backoff
   *
   * @param ticketId - ClickUp task ID
   * @param statusName - Human-readable status name (e.g., "Deployed")
   * @param options - Optional correlation ID for logging
   * @returns true if successful, false otherwise
   */
  async updateStatus(
    ticketId: string,
    statusName: string,
    options?: { correlationId?: string },
  ): Promise<boolean> {
    const correlationId = options?.correlationId || 'clickup-update-status';

    try {
      // Check cache first
      const cached = this.statusNameToIdCache.get(statusName);
      if (cached && cached.expiresAt > new Date()) {
        this.logger.debug(`Status ID cache hit for "${statusName}"`, {
          correlationId,
          statusName,
          statusId: cached.id,
        });
        return await this.updateStatusById(ticketId, cached.id, correlationId);
      }

      // Resolve status name → ID via ClickUp API
      const statusId = await this.resolveStatusId(ticketId, statusName, correlationId);

      // Cache with 1-hour TTL
      this.statusNameToIdCache.set(statusName, {
        id: statusId,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      });

      return await this.updateStatusById(ticketId, statusId, correlationId);
    } catch (error) {
      this.logger.error('Failed to update ClickUp status after all retries', {
        correlationId,
        ticketId,
        statusName,
        error: (error as Error).message,
      });

      this.sentry.captureException(error as Error, {
        tags: { operation: 'clickup_update_status' },
        extra: { ticketId, statusName, correlationId },
      });

      return false;
    }
  }

  /**
   * Add comment to ClickUp task
   * AC#2: Markdown comment formatting
   * AC#3: Retry with exponential backoff
   *
   * @param ticketId - ClickUp task ID
   * @param comment - Markdown-formatted comment text
   * @param options - Optional correlation ID for logging
   * @returns true if successful, false otherwise
   */
  async addComment(
    ticketId: string,
    comment: string,
    options?: { correlationId?: string },
  ): Promise<boolean> {
    const correlationId = options?.correlationId || 'clickup-add-comment';
    const maxLength = this.config.get<number>('CLICKUP_MAX_COMMENT_LENGTH', 20000);

    // Truncate comment if too long
    const truncatedComment = comment.length > maxLength ? comment.substring(0, maxLength) : comment;

    if (comment.length > maxLength) {
      this.logger.warn('Comment truncated to ClickUp max length', {
        correlationId,
        ticketId,
        originalLength: comment.length,
        maxLength,
      });
    }

    const operation = async () => {
      const response = await this.client.post(`/task/${ticketId}/comment`, {
        comment_text: truncatedComment,
        notify_all: false, // Don't spam team with notifications
      });

      return response.status === 200;
    };

    try {
      const success = await this.retryWithBackoff(operation, correlationId);

      if (success) {
        this.logger.log('ClickUp comment added successfully', {
          correlationId,
          ticketId,
          commentLength: truncatedComment.length,
        });
      }

      return success;
    } catch (error) {
      this.logger.error('Failed to add ClickUp comment after all retries', {
        correlationId,
        ticketId,
        error: (error as Error).message,
      });

      this.sentry.captureException(error as Error, {
        tags: { operation: 'clickup_add_comment' },
        extra: { ticketId, commentLength: truncatedComment.length, correlationId },
      });

      return false;
    }
  }

  /**
   * Resolve status name to status ID using ClickUp API
   * Fetches task details to get available statuses
   *
   * @param ticketId - ClickUp task ID
   * @param statusName - Human-readable status name
   * @param correlationId - Correlation ID for logging
   * @returns Status ID
   */
  private async resolveStatusId(
    ticketId: string,
    statusName: string,
    correlationId: string,
  ): Promise<string> {
    try {
      // Get task details to find status ID
      const response = await this.client.get<ClickUpTask>(`/task/${ticketId}`);
      const task = response.data;

      // Find matching status in task's list
      const status = task.status?.statuses?.find(
        (s: ClickUpStatus) => s.status.toLowerCase() === statusName.toLowerCase(),
      );

      if (status) {
        this.logger.debug('Resolved status name to ID', {
          correlationId,
          statusName,
          statusId: status.id,
        });
        return status.id;
      }

      // Fallback: use status name directly if no match found
      this.logger.warn('Status name not found in task statuses, using name as ID fallback', {
        correlationId,
        ticketId,
        statusName,
      });

      return statusName;
    } catch (error) {
      this.logger.warn('Failed to resolve status ID, using status name as fallback', {
        correlationId,
        ticketId,
        statusName,
        error: (error as Error).message,
      });

      return statusName;
    }
  }

  /**
   * Update task status by ID
   * Internal method with retry logic
   *
   * @param ticketId - ClickUp task ID
   * @param statusId - ClickUp status ID
   * @param correlationId - Correlation ID for logging
   * @returns true if successful
   */
  private async updateStatusById(
    ticketId: string,
    statusId: string,
    correlationId: string,
  ): Promise<boolean> {
    const operation = async () => {
      const response = await this.client.put(`/task/${ticketId}`, {
        status: statusId,
      });

      return response.status === 200;
    };

    const success = await this.retryWithBackoff(operation, correlationId);

    if (success) {
      this.logger.log('ClickUp status updated successfully', {
        correlationId,
        ticketId,
        statusId,
      });
    }

    return success;
  }

  /**
   * Retry operation with exponential backoff
   * AC#3: 3 attempts with 1s, 2s, 4s delays
   *
   * @param operation - Async operation to retry
   * @param correlationId - Correlation ID for logging
   * @returns Result of successful operation
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    correlationId: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const axiosError = error as AxiosError;

        // AC#3: Check for rate limit (HTTP 429)
        if (axiosError.response?.status === 429) {
          const rateLimitReset = this.extractRateLimitReset(axiosError);
          this.logger.warn('ClickUp rate limit hit', {
            correlationId,
            attempt,
            rateLimitReset: rateLimitReset ? new Date(rateLimitReset * 1000) : 'unknown',
          });

          // For rate limits, we should use delayed retry queue (Story 4.1 pattern)
          // For now, just throw to fail fast
          throw new Error('ClickUp rate limit exceeded');
        }

        // Check if error is retryable
        if (!this.isRetryableError(axiosError) || attempt === this.retryAttempts) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = this.retryBackoffMs * Math.pow(2, attempt - 1);
        this.logger.warn(`ClickUp API retry attempt ${attempt}/${this.retryAttempts}`, {
          correlationId,
          attempt,
          delay,
          error: (error as Error).message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Extract rate limit reset time from response headers
   *
   * @param error - Axios error with response
   * @returns Unix timestamp of rate limit reset, or null
   */
  private extractRateLimitReset(error: AxiosError): number | null {
    const resetHeader = error.response?.headers['x-ratelimit-reset'];
    if (resetHeader) {
      return parseInt(resetHeader as string, 10);
    }
    return null;
  }

  /**
   * Check if error is retryable
   * Transient errors: network issues, 5xx server errors, timeouts
   *
   * @param error - Error to check
   * @returns true if retryable
   */
  private isRetryableError(error: AxiosError): boolean {
    // Network errors (no response)
    if (!error.response) {
      return (
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED'
      );
    }

    // Server errors (5xx)
    const status = error.response.status;
    return status >= 500 && status < 600;
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get tasks from a ClickUp list (for polling)
   * Filters by date_updated to get incremental updates
   *
   * @param options - Query options
   * @returns List of tasks with updates
   */
  async getTasks(options: {
    list_id: string;
    space_id?: string;
    date_updated_gt?: number;
    order_by?: 'updated';
  }): Promise<{
    tasks: Array<{
      id: string;
      name: string;
      status: { status: string; color: string };
      date_updated: string;
      assignees?: Array<{ id: number; username: string }>;
      custom_fields?: Array<{ id: string; name: string; value: unknown }>;
    }>;
  }> {
    try {
      const params: Record<string, string> = {
        order_by: options.order_by || 'updated',
        reverse: 'true', // Most recent first
      };

      // Add date filter if provided
      if (options.date_updated_gt) {
        params.date_updated_gt = options.date_updated_gt.toString();
      }

      const response = await this.client.get(`/list/${options.list_id}/task`, {
        params,
      });

      this.logger.debug('Fetched tasks from ClickUp list', {
        listId: options.list_id,
        taskCount: response.data.tasks?.length || 0,
      });

      return {
        tasks: response.data.tasks || [],
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      // Check for rate limit
      if (axiosError.response?.status === 429) {
        const rateLimitReset = this.extractRateLimitReset(axiosError);
        this.logger.warn('ClickUp rate limit hit while fetching tasks', {
          listId: options.list_id,
          rateLimitReset: rateLimitReset ? new Date(rateLimitReset * 1000) : 'unknown',
        });

        throw new Error('ClickUp rate limit exceeded');
      }

      this.logger.error('Failed to fetch tasks from ClickUp', {
        listId: options.list_id,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Get full details of a single task including description
   *
   * @param taskId - ClickUp task ID
   * @returns Full task details
   */
  async getTask(taskId: string): Promise<{
    id: string;
    name: string;
    description: string;
    status: { status: string };
    text_content?: string;
  }> {
    try {
      const response = await this.client.get(`/task/${taskId}`);

      this.logger.debug('Fetched task details from ClickUp', {
        taskId,
        hasDescription: !!response.data.description,
      });

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || response.data.text_content || '',
        status: response.data.status,
        text_content: response.data.text_content,
      };
    } catch (error) {
      this.logger.error('Failed to fetch task from ClickUp', {
        taskId,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Get details of a specific list
   * Used for project import verification
   *
   * @param listId - ClickUp List ID
   * @returns List details or throws if not found
   */
  async getList(listId: string): Promise<{ id: string; name: string }> {
    try {
      const response = await this.client.get(`/list/${listId}`);
      return {
        id: response.data.id,
        name: response.data.name,
      };
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error('Failed to fetch list from ClickUp', {
        listId,
        error: msg,
      });
      throw new Error(`Failed to fetch ClickUp list ${listId}: ${msg}`);
    }
  }

  /**
   * Create a new task in ClickUp
   *
   * @param listId - ClickUp List ID
   * @param data - Task creation payload
   * @param options - Optional correlation ID
   * @returns Created task details
   */
  async createTask(
    listId: string,
    data: {
      name: string;
      description?: string;
      priority?: number; // 1 (Urgent) to 4 (Low)
      assignees?: number[];
      tags?: string[];
      status?: string;
      notify_all?: boolean;
    },
    options?: { correlationId?: string },
  ): Promise<ClickUpTask | null> {
    const correlationId = options?.correlationId || 'clickup-create-task';

    const operation = async () => {
      const response = await this.client.post<ClickUpTask>(`/list/${listId}/task`, data);
      return response.data;
    };

    try {
      const task = await this.retryWithBackoff(operation, correlationId);

      this.logger.log('ClickUp task created successfully', {
        correlationId,
        listId,
        taskId: task.id,
      });

      return task;
    } catch (error) {
      this.logger.error('Failed to create ClickUp task after all retries', {
        correlationId,
        listId,
        error: (error as Error).message,
      });

      this.sentry.captureException(error as Error, {
        tags: { operation: 'clickup_create_task' },
        extra: { listId, correlationId },
      });

      return null;
    }
  }


  /**
   * Get hierarchy of Spaces and Lists for discovery
   * Used by UI to allow users to select lists to import
   */
  async getHierarchy(options?: { correlationId?: string }): Promise<ClickUpHierarchy> {
    const correlationId = options?.correlationId || 'clickup-get-hierarchy';

    try {
      // 1. Get Teams (Workspaces) - usually the first team is the main one
      const teamsRes = await this.client.get('/team');
      const teams = teamsRes.data.teams;

      if (!teams || teams.length === 0) {
        throw new Error('No ClickUp teams found');
      }

      // For MVP, we'll just check the first team.
      // Future: Iterate all teams or allow team selection
      const teamId = teams[0].id;

      // 2. Get Spaces for the Team
      const spacesRes = await this.client.get(`/team/${teamId}/space`);
      const spaces = spacesRes.data.spaces;

      const hierarchy: ClickUpHierarchy = { spaces: [] };

      // 3. For each Space, get Lists
      // Using Promise.all for parallelism, but be mindful of rate limits
      await Promise.all(
        spaces.map(async (space: any) => {
          try {
            // Get Folderless Lists
            const folderlessListsRes = await this.client.get(`/space/${space.id}/list`);
            const lists = folderlessListsRes.data.lists.map((l: any) => ({
              id: l.id,
              name: l.name,
            }));

            // Include Folders? For MVP, we might skip folders or assume tasks are in lists directly.
            // ClickUp structure: Team -> Space -> Folder -> List -> Task
            // OR Team -> Space -> List -> Task (folderless)
            // Let's also fetch folders and their lists to be complete

            const foldersRes = await this.client.get(`/space/${space.id}/folder`);
            for (const folder of foldersRes.data.folders) {
              // Folders have lists too
              if (folder.lists) {
                lists.push(
                  ...folder.lists.map((l: any) => ({
                    id: l.id,
                    name: `${folder.name} > ${l.name}`, // Flatten structure for simple UI
                  })),
                );
              }
            }

            hierarchy.spaces.push({
              id: space.id,
              name: space.name,
              lists,
            });
          } catch (err) {
            this.logger.warn(`Failed to fetch lists for space ${space.id}`, {
              error: String(err),
            });
            // Continue with other spaces
          }
        }),
      );

      return hierarchy;
    } catch (error) {
      this.logger.error('Failed to fetch ClickUp hierarchy', {
        error: (error as Error).message,
        correlationId,
      });
      throw error;
    }
  }
}


