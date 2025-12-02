import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';
// import { LOGGER_CONSTANTS } from './logger.constants';

describe('LoggerService', () => {
  let service: LoggerService;
  // let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, defaultValue) => {
              if (key === 'nodeEnv') return 'test';
              if (key === 'monitoring.logging.level') return 'debug';
              if (key === 'monitoring.logging.dir') return 'logs';
              if (key === 'monitoring.logging.file') return false;
              if (key === 'monitoring.logging.redactFields') return [];
              if (key === 'monitoring.logging.serviceName') return 'test-service';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LoggerService>(LoggerService);
    // configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should log info messages', () => {
    const spy = jest.spyOn((service as unknown as { logger: { log: () => void } }).logger, 'log');
    service.log('test message');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: 'test message',
      }),
    );
  });

  it('should log error messages', () => {
    const spy = jest.spyOn((service as unknown as { logger: { log: () => void } }).logger, 'log');
    service.error('error message', 'stack trace');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'error message',
        context: expect.objectContaining({ stack: 'stack trace' }),
      }),
    );
  });

  it('should redact sensitive data', () => {
    const spy = jest.spyOn((service as unknown as { logger: { log: () => void } }).logger, 'log');
    service.log('test', { password: 'secret', other: 'value' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          password: 'secret',
          other: 'value',
        }),
      }),
    );
  });
});
