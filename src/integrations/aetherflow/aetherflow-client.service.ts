import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CreateTasksRequestDto, CreateTaskDto } from './dto/create-tasks-request.dto';
import { CreateTasksResponseDto } from './dto/create-tasks-response.dto';
import { MetricsService } from '@/common/metrics/metrics.service';

/**
 * AetherFlow Client Service
 *
 * HTTP client for calling AetherFlow's ClickUp integration API.
 * Handles authentication, retries, and timeout logic.
 */
@Injectable()
export class AetherFlowClientService {
  private readonly logger = new Logger(AetherFlowClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number = 30000; // 30 seconds
  private readonly retryAttempts: number = 3;
  private readonly retryDelays: number[] = [1000, 2000, 4000]; // Exponential backoff

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.baseUrl = this.configService.get<string>('AETHERFLOW_API_URL')!;
    this.apiKey = this.configService.get<string>('AETHERFLOW_API_KEY')!;

    if (!this.baseUrl) {
      throw new Error('AETHERFLOW_API_URL not configured');
    }

    if (!this.apiKey) {
      throw new Error('AETHERFLOW_API_KEY not configured');
    }
  }

  /**
   * Create tasks in ClickUp via AetherFlow API
   */
  async createTasks(params: {
    userId: string;
    listId?: string;
    listName?: string;
    tasks: CreateTaskDto[];
  }): Promise<CreateTasksResponseDto> {
    const requestBody: CreateTasksRequestDto = {
      userId: params.userId,
      listId: params.listId,
      listName: params.listName,
      tasks: params.tasks,
    };

    this.logger.log(`Creating ${params.tasks.length} tasks in AetherFlow`, {
      userId: params.userId,
      listId: params.listId,
      listName: params.listName,
    });

    try {
      const response = await this.executeWithRetry<CreateTasksResponseDto>(
        '/api/integrations/clickup/create-tasks',
        requestBody,
      );

      this.logger.log(`Successfully created ${response.count || 0} tasks via AetherFlow`);

      return response;
    } catch (_error) {
      this.logger.error('Failed to create tasks via AetherFlow', {
        error: _error instanceof Error ? _error.message : 'Unknown error',
        userId: params.userId,
      });

      if (_error instanceof AxiosError) {
        return {
          success: false,
          error: _error.response?.data?.error || _error.message,
          message: _error.response?.data?.message || 'AetherFlow API call failed',
        };
      }

      throw _error;
    }
  }

  /**
   * Execute HTTP request with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    endpoint: string,
    body: Record<string, unknown>,
    attemptNumber: number = 0,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();
    this.metrics.incrementAetherFlowApiCall(endpoint, 'pending');

    try {
      const response$ = this.httpService.post<T>(url, body, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      const response = await firstValueFrom(response$);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.recordAetherFlowApiDuration(endpoint, duration);
      this.metrics.incrementAetherFlowApiCall(endpoint, 'success');
      return response.data;
    } catch (_error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.recordAetherFlowApiDuration(endpoint, duration);

      // Check if we should retry
      if (attemptNumber < this.retryAttempts - 1) {
        const shouldRetry = this.isRetryableError(_error);

        if (shouldRetry) {
          this.metrics.incrementAetherFlowApiCall(endpoint, 'retry');
          // eslint-disable-next-line security/detect-object-injection
          const delay = this.retryDelays[attemptNumber];
          this.logger.warn(
            `AetherFlow API call failed, retrying in ${delay}ms (attempt ${attemptNumber + 1}/${this.retryAttempts})`,
            {
              error: _error instanceof Error ? _error.message : 'Unknown error',
            },
          );

          await this.sleep(delay);
          return this.executeWithRetry<T>(endpoint, body, attemptNumber + 1);
        }
      }

      // No more retries or non-retryable error
      this.metrics.incrementAetherFlowApiCall(endpoint, 'error');
      throw _error;
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: Record<string, unknown>): boolean {
    if (error instanceof AxiosError) {
      const status = error.response?.status;

      // Retry on network errors, timeouts, and 5xx server errors
      if (!status) return true; // Network error
      if (status >= 500) return true; // Server error

      // Don't retry on 4xx client errors (except 429 rate limit)
      if (status === 429) return true;
      if (status >= 400 && status < 500) return false;
    }

    // Retry on timeout or network errors
    if (error.code === 'ECONNABORTED') return true;
    if (error.code === 'ETIMEDOUT') return true;
    if (error.code === 'ECONNREFUSED') return true;

    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
