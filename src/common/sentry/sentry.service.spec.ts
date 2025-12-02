import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SentryService } from './sentry.service';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import * as Sentry from '@sentry/node';

jest.mock('@sentry/node');
jest.mock('@sentry/profiling-node');

describe('SentryService', () => {
  let service: SentryService;
  let configService: ConfigService;
  let loggerService: LoggerService;
  let metricsService: MetricsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentryService,
        {
          provide: ConfigService,
          useValue: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'SENTRY_DSN') return 'https://example@sentry.io/123';
              if (key === 'NODE_ENV') return 'test';
              if (key === 'SENTRY_DEBUG') return false;
              return defaultValue;
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementErrors: jest.fn(),
            incrementUnhandledExceptions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SentryService>(SentryService);
    configService = module.get<ConfigService>(ConfigService);
    loggerService = module.get<LoggerService>(LoggerService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initializeSentry', () => {
    it('should initialize Sentry with correct config', () => {
      service.initializeSentry();

      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://example@sentry.io/123',
          environment: 'test',
          debug: false,
        }),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Sentry initialized'),
        'SentryService',
      );
    });

    it('should not initialize if disabled', () => {
      (configService.get as jest.Mock).mockImplementation((key) => {
        if (key === 'SENTRY_DSN') return '';
        return null;
      });
      // Re-create service to load new config
      const newService = new SentryService(configService, loggerService, metricsService);
      newService.initializeSentry();

      expect(Sentry.init).not.toHaveBeenCalled();
    });
  });

  describe('captureException', () => {
    it('should capture exception and increment metrics', () => {
      const error = new Error('Test error');
      (Sentry.captureException as jest.Mock).mockReturnValue('event-id');

      const eventId = service.captureException(error);

      expect(Sentry.captureException).toHaveBeenCalledWith(error, expect.any(Object));
      expect(metricsService.incrementErrors).toHaveBeenCalled();
      expect(loggerService.error).toHaveBeenCalled();
      expect(eventId).toBe('event-id');
    });
  });

  describe('captureMessage', () => {
    it('should capture message', () => {
      (Sentry.captureMessage as jest.Mock).mockReturnValue('event-id');

      const eventId = service.captureMessage('Test message');

      expect(Sentry.captureMessage).toHaveBeenCalledWith('Test message', expect.any(Object));
      expect(eventId).toBe('event-id');
    });
  });
});
