import { Test, TestingModule } from '@nestjs/testing';
import { AetherFlowClientService } from './aetherflow-client.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '@/common/metrics/metrics.service';
import { of, throwError } from 'rxjs';
import { AxiosResponse, AxiosError } from 'axios';

describe('AetherFlowClientService', () => {
  let service: AetherFlowClientService;
  let httpService: jest.Mocked<HttpService>;
  let metricsService: jest.Mocked<MetricsService>;

  const mockConfig = {
    AETHERFLOW_API_URL: 'http://api.test',
    AETHERFLOW_API_KEY: 'test-key',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AetherFlowClientService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfig[key as keyof typeof mockConfig]),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementAetherFlowApiCall: jest.fn(),
            recordAetherFlowApiDuration: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AetherFlowClientService>(AetherFlowClientService);
    httpService = module.get(HttpService);
    metricsService = module.get(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTasks', () => {
    const params = {
      userId: 'user1',
      tasks: [{ name: 'Task 1', description: 'Desc' }],
    };

    it('should record success metrics on successful API call', async () => {
      const response: AxiosResponse = {
        data: { success: true, count: 1 },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as Record<string, unknown>,
      };

      httpService.post.mockReturnValue(of(response));

      await service.createTasks(params);

      const endpoint = '/api/integrations/clickup/create-tasks';
      expect(metricsService.incrementAetherFlowApiCall).toHaveBeenCalledWith(endpoint, 'pending');
      expect(metricsService.incrementAetherFlowApiCall).toHaveBeenCalledWith(endpoint, 'success');
      expect(metricsService.recordAetherFlowApiDuration).toHaveBeenCalled();
    });

    it('should record error metrics on API failure', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('API Error')));

      try {
        await service.createTasks(params);
      } catch (_e) {
        // expected
      }

      const endpoint = '/api/integrations/clickup/create-tasks';
      expect(metricsService.incrementAetherFlowApiCall).toHaveBeenCalledWith(endpoint, 'error');
      expect(metricsService.recordAetherFlowApiDuration).toHaveBeenCalled();
    });

    it('should record retry metrics when API failure is retryable', async () => {
      const retryableError = new AxiosError('Retryable', '500');
      retryableError.response = { status: 500 } as unknown;

      // Fails first time, succeeds second time
      httpService.post
        .mockReturnValueOnce(throwError(() => retryableError))
        .mockReturnValueOnce(
          of({ data: { success: true }, status: 200 } as Record<string, unknown>),
        );

      await service.createTasks(params);

      const endpoint = '/api/integrations/clickup/create-tasks';
      expect(metricsService.incrementAetherFlowApiCall).toHaveBeenCalledWith(endpoint, 'retry');
      expect(metricsService.incrementAetherFlowApiCall).toHaveBeenCalledWith(endpoint, 'success');
    });
  });
});
