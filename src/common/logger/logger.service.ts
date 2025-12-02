import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { createLogger, Logger } from 'winston';
import { ConfigService } from '@nestjs/config';
import { LOGGER_CONSTANTS, LOG_LEVELS, LogLevel } from './logger.constants';
import { LogContext } from './logger.interface';
import { createConsoleTransport } from './transports/console.transport';
import { createCombinedFileTransport, createErrorFileTransport } from './transports/file.transport';
import { getRequestContext } from '../context';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;
  private readonly serviceName: string;

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('nodeEnv', 'development');
    const isProduction = nodeEnv === 'production';

    const logLevel = this.configService.get<string>('monitoring.logging.level', 'info');
    const logDir = this.configService.get<string>(
      'monitoring.logging.dir',
      LOGGER_CONSTANTS.LOG_DIR,
    );
    const enableFile = this.configService.get<boolean>('monitoring.logging.file', isProduction);
    const redactFields = this.configService.get<string[]>('monitoring.logging.redactFields', []);

    this.serviceName = this.configService.get<string>(
      'monitoring.logging.serviceName',
      LOGGER_CONSTANTS.SERVICE_NAME,
    );

    const transports = [
      createConsoleTransport(this.serviceName, isProduction, redactFields) as any,
    ];

    if (enableFile) {
      transports.push(
        createCombinedFileTransport(this.serviceName, logDir, redactFields) as any,
        createErrorFileTransport(this.serviceName, logDir, redactFields) as any,
      );
    }

    this.logger = createLogger({
      level: logLevel,
      levels: LOG_LEVELS,
      transports: transports as any,
      exceptionHandlers: enableFile
        ? [createErrorFileTransport(this.serviceName, logDir, redactFields)]
        : undefined,
      rejectionHandlers: enableFile
        ? [createErrorFileTransport(this.serviceName, logDir, redactFields)]
        : undefined,
    });
  }

  log(message: string, context?: string | LogContext): void {
    this.writeLog('info', message, context);
  }

  error(message: string, trace?: string, context?: string | LogContext): void {
    const logContext = this.normalizeContext(context);
    if (trace) logContext.stack = trace;
    this.writeLog('error', message, logContext);
  }

  warn(message: string, context?: string | LogContext): void {
    this.writeLog('warn', message, context);
  }

  debug(message: string, context?: string | LogContext): void {
    this.writeLog('debug', message, context);
  }

  verbose(message: string, context?: string | LogContext): void {
    this.writeLog('debug', message, context);
  }

  fatal(message: string, context?: string | LogContext): void {
    const logContext = this.normalizeContext(context);
    logContext.fatal = true;
    this.writeLog('error', message, logContext);
  }

  logWithContext(level: LogLevel, message: string, context: LogContext): void {
    this.writeLog(level, message, context);
  }

  createChildLogger(defaultContext: LogContext): Logger {
    return this.logger.child(defaultContext);
  }

  private writeLog(level: LogLevel, message: string, context?: string | LogContext): void {
    const reqContext = getRequestContext();
    const logContext = this.normalizeContext(context);

    this.logger.log({
      level,
      message,
      requestId: reqContext?.requestId || 'system',
      correlationId: reqContext?.correlationId || 'system',
      userId: reqContext?.userId,
      context: { ...logContext, userRole: reqContext?.userRole, timings: reqContext?.timings },
    });
  }

  private normalizeContext(context?: string | LogContext): LogContext {
    if (!context) return {};
    if (typeof context === 'string') return { module: context };
    return context;
  }
}
