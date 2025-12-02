import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { LoggerService } from '../logger';
import { HttpCollector, BusinessCollector, SystemCollector, QueueCollector } from './collectors';

describe('MetricsService', () => {
  let service: MetricsService;
  let httpCollector: jest.Mocked<HttpCollector>;
  let businessCollector: jest.Mocked<BusinessCollector>;
  let systemCollector: jest.Mocked<SystemCollector>;
  let queueCollector: jest.Mocked<QueueCollector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: HttpCollector,
          useValue: {
            recordRequest: jest.fn(),
          },
        },
        {
          provide: BusinessCollector,
          useValue: {
            incrementTicketsReceived: jest.fn(),
            incrementTicketsProcessed: jest.fn(),
            setTicketQueueSize: jest.fn(),
            recordAIExecution: jest.fn(),
            setAIProviderStatus: jest.fn(),
            recordQACheck: jest.fn(),
            incrementVulnerabilities: jest.fn(),
            recordDeployment: jest.fn(),
            setDeploymentSuccessRate: jest.fn(),
            recordCost: jest.fn(),
            setBudgetUtilization: jest.fn(),
            updatePMUtilization: jest.fn(),
          },
        },
        {
          provide: SystemCollector,
          useValue: {
            setActiveConnections: jest.fn(),
            updateDatabaseMetrics: jest.fn(),
            recordDatabaseQuery: jest.fn(),
            incrementErrors: jest.fn(),
            incrementUnhandledExceptions: jest.fn(),
            recordCICDPipeline: jest.fn(),
          },
        },
        {
          provide: QueueCollector,
          useValue: {
            updateQueueMetrics: jest.fn(),
            updateWebSocketMetrics: jest.fn(),
            incrementWebSocketMessages: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    httpCollector = module.get(HttpCollector);
    businessCollector = module.get(BusinessCollector);
    systemCollector = module.get(SystemCollector);
    queueCollector = module.get(QueueCollector);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('HTTP Metrics', () => {
    it('should delegate to HttpCollector', () => {
      const data = { method: 'GET', path: '/test', statusCode: 200, duration: 0.1 };
      service.recordHttpRequest(data);
      expect(httpCollector.recordRequest).toHaveBeenCalledWith(data);
    });
  });

  describe('Business Metrics', () => {
    it('should delegate ticket metrics', () => {
      service.incrementTicketsReceived('p1');
      expect(businessCollector.incrementTicketsReceived).toHaveBeenCalledWith('p1');
    });

    it('should delegate AI metrics', () => {
      const data = { provider: 'cursor', status: 'success' as const, duration: 1 };
      service.recordAIExecution(data);
      expect(businessCollector.recordAIExecution).toHaveBeenCalledWith(data);
    });
  });

  describe('System Metrics', () => {
    it('should delegate system metrics', () => {
      service.setActiveConnections(10);
      expect(systemCollector.setActiveConnections).toHaveBeenCalledWith(10);
    });
  });

  describe('Queue Metrics', () => {
    it('should delegate queue metrics', () => {
      const data = {
        queueName: 'q1',
        depth: 5,
        processingRate: 10,
        consumerCount: 1,
      };
      service.updateQueueMetrics(data);
      expect(queueCollector.updateQueueMetrics).toHaveBeenCalledWith(data);
    });
  });
});
