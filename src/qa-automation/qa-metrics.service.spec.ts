import { Test, TestingModule } from '@nestjs/testing';
import { QaMetricsService } from './qa-metrics.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { LoggerService } from '../common/logger/logger.service';

describe('QaMetricsService', () => {
  let service: QaMetricsService;
  let mockMetricsService: Partial<MetricsService>;
  let mockLogger: Partial<LoggerService>;

  beforeEach(async () => {
    mockMetricsService = {
      recordQACheck: jest.fn(),
      incrementVulnerabilities: jest.fn(),
    };
    mockLogger = { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    // Mock Prometheus metric objects
    const mockCounter = {
      labels: jest.fn().mockReturnThis(),
      inc: jest.fn(),
    };
    const mockGauge = {
      labels: jest.fn().mockReturnThis(),
      set: jest.fn(),
    };
    const mockHistogram = {
      observe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaMetricsService,
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: 'PROM_METRIC_DSF_BUG_ESCAPES_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_DSF_BUG_ESCAPE_RATE_PERCENT', useValue: mockGauge },
        { provide: 'PROM_METRIC_DSF_BUG_ESCAPE_THRESHOLD_BREACHES_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_DSF_BUG_ESCAPE_RESOLUTION_TIME_HOURS', useValue: mockHistogram },
      ],
    }).compile();

    service = module.get<QaMetricsService>(QaMetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordCheckComplete', () => {
    it('should convert ms to seconds and call metricsService', () => {
      service.recordCheckComplete('linting', true, 5500, {
        projectId: 'proj-1',
        aiProvider: 'cursor',
      });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'linting',
        status: 'passed',
        duration: 5.5,
        projectId: 'proj-1',
        aiProvider: 'cursor',
      });
    });

    it('should record failed status', () => {
      service.recordCheckComplete('testing', false, 10000, {});

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', duration: 10 }),
      );
    });

    it('should log debug message', () => {
      service.recordCheckComplete('security', true, 2500);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'QA metric: security passed in 2.50s',
        'QaMetricsService',
      );
    });

    it('should handle all check types', () => {
      const checkTypes: Array<'linting' | 'testing' | 'security' | 'coverage'> = [
        'linting',
        'testing',
        'security',
        'coverage',
      ];

      checkTypes.forEach((checkType) => {
        service.recordCheckComplete(checkType, true, 1000);
        expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
          expect.objectContaining({ checkType }),
        );
      });
    });
  });

  describe('recordCheckError', () => {
    it('should record timeout status', () => {
      service.recordCheckError('testing', 'timeout', 60000, {
        projectId: 'proj-2',
        aiProvider: 'claude',
      });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'testing',
        status: 'timeout',
        duration: 60,
        projectId: 'proj-2',
        aiProvider: 'claude',
      });
    });

    it('should record error status', () => {
      service.recordCheckError('linting', 'error', 3000);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          duration: 3,
        }),
      );
    });
  });

  describe('setCoverage', () => {
    it('should record coverage via recordQACheck', () => {
      service.setCoverage('proj-3', 87.5);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: 'coverage',
          projectId: 'proj-3',
          coverage: 87.5,
        }),
      );
    });

    it('should set duration to 0 for coverage metric', () => {
      service.setCoverage('proj-4', 92);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 0 }),
      );
    });

    it('should mark coverage as passed', () => {
      service.setCoverage('proj-5', 75);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'passed' }),
      );
    });
  });

  describe('recordVulnerabilities', () => {
    it('should skip if count is 0', () => {
      service.recordVulnerabilities('low', 0);
      expect(mockMetricsService.incrementVulnerabilities).not.toHaveBeenCalled();
    });

    it('should skip if count is negative', () => {
      service.recordVulnerabilities('medium', -5);
      expect(mockMetricsService.incrementVulnerabilities).not.toHaveBeenCalled();
    });

    it('should call metricsService with severity, count, and projectId', () => {
      service.recordVulnerabilities('critical', 3, 'proj-2');

      expect(mockMetricsService.incrementVulnerabilities).toHaveBeenCalledWith(
        'critical',
        3,
        'proj-2',
      );
    });

    it('should handle all severity levels', () => {
      const severities: Array<'critical' | 'high' | 'medium' | 'low'> = [
        'critical',
        'high',
        'medium',
        'low',
      ];

      severities.forEach((severity, index) => {
        service.recordVulnerabilities(severity, index + 1, 'proj-x');
        expect(mockMetricsService.incrementVulnerabilities).toHaveBeenCalledWith(
          severity,
          index + 1,
          'proj-x',
        );
      });
    });

    it('should work without projectId', () => {
      service.recordVulnerabilities('high', 2);

      expect(mockMetricsService.incrementVulnerabilities).toHaveBeenCalledWith(
        'high',
        2,
        undefined,
      );
    });
  });

  describe('recordGateDecision', () => {
    it('should record gate check type', () => {
      service.recordGateDecision(true, { projectId: 'proj-4' });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'gate',
        status: 'passed',
        duration: 0,
        projectId: 'proj-4',
        aiProvider: undefined,
      });
    });

    it('should record failed gate decision', () => {
      service.recordGateDecision(false, { projectId: 'proj-5', aiProvider: 'cursor' });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'gate',
        status: 'failed',
        duration: 0,
        projectId: 'proj-5',
        aiProvider: 'cursor',
      });
    });

    it('should work without context', () => {
      service.recordGateDecision(true);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: 'gate',
          status: 'passed',
        }),
      );
    });
  });
});
