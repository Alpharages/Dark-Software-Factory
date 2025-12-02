# Story 1.7: Winston Structured Logging Setup

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P0 - CRITICAL (Required for observability)  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw8m`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8m

---

## Quick Implementation Reference (Expert Mode)

```bash
# 1. Install dependencies
npm install winston nest-winston winston-daily-rotate-file uuid
npm install -D @types/uuid

# 2. Create directories
mkdir -p src/common/{logger/formatters,logger/transports,context,middleware,filters}

# 3. Key files to create (24 total)
# src/common/logger/       - Core logging module
# src/common/context/      - Async context propagation
# src/common/middleware/   - Correlation ID middleware
# src/common/filters/      - Global exception filter
# src/common/decorators/   - @AuditLog() decorator

# 4. Update existing files
# src/config/configuration.ts, env.validation.ts, app.module.ts, main.ts, .gitignore

# 5. Run tests
npm test -- --testPathPattern=logger
```

---

## Story

As a developer,
I want structured JSON logging with Winston,
So that all logs are searchable, traceable, and comply with observability requirements (NFR-O1-O4).

---

## Acceptance Criteria

**Given** the application is running  
**When** I implement Winston logging  
**Then** the following is configured:
- Winston logger with JSON format
- Log levels: error, warn, info, debug
- Correlation IDs auto-generated for each request
- Request IDs propagated across async operations

**And** all logs contain these fields:
- `level` (error/warn/info/debug)
- `timestamp` (ISO 8601)
- `requestId` (UUID)
- `correlationId` (UUID for tracing)
- `service` (ai-dev-orchestrator)
- `message` (human-readable)
- `context` (structured data object)
- `error` (stack trace if level === 'error')

**And** sensitive data is redacted from logs (passwords, tokens, PII)  
**And** logs are written to console (dev) and file (prod)  
**And** log rotation is configured (daily, 90-day retention per NFR-O3)  
**And** global exception filter provides consistent error logging  
**And** @AuditLog() decorator available for method-level audit trails

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/common/logger/logger.module.ts` | CREATE | Logger module definition |
| `src/common/logger/logger.service.ts` | CREATE | Winston logger service |
| `src/common/logger/logger.constants.ts` | CREATE | Log level constants |
| `src/common/logger/logger.interface.ts` | CREATE | Log context interfaces |
| `src/common/logger/transports/console.transport.ts` | CREATE | Console transport config |
| `src/common/logger/transports/file.transport.ts` | CREATE | File transport with rotation |
| `src/common/logger/transports/index.ts` | CREATE | Transports barrel export |
| `src/common/logger/formatters/json.formatter.ts` | CREATE | JSON log formatter |
| `src/common/logger/formatters/sensitive-data.redactor.ts` | CREATE | PII/token redaction |
| `src/common/logger/formatters/index.ts` | CREATE | Formatters barrel export |
| `src/common/logger/index.ts` | CREATE | Logger barrel export |
| `src/common/middleware/correlation-id.middleware.ts` | CREATE | Correlation ID middleware |
| `src/common/middleware/index.ts` | CREATE | Middleware barrel export |
| `src/common/interceptors/logging.interceptor.ts` | CREATE | Request/response logging |
| `src/common/interceptors/index.ts` | CREATE | Interceptors barrel export |
| `src/common/filters/http-exception.filter.ts` | CREATE | Global exception filter |
| `src/common/filters/index.ts` | CREATE | Filters barrel export |
| `src/common/decorators/audit-log.decorator.ts` | CREATE | Method-level audit logging |
| `src/common/context/async-local-storage.ts` | CREATE | Async context propagation |
| `src/common/context/request-context.ts` | CREATE | Request context management |
| `src/common/context/index.ts` | CREATE | Context barrel export |
| `src/config/configuration.ts` | MODIFY | Add logging configuration |
| `src/config/env.validation.ts` | MODIFY | Add logging validation |
| `src/auth/strategies/jwt.strategy.ts` | MODIFY | Add user context to logs |
| `src/app.module.ts` | MODIFY | Add LoggerModule, filter, middleware |
| `src/main.ts` | MODIFY | Integrate Winston with NestJS |
| `.gitignore` | MODIFY | Exclude logs directory |

**Install Command:**
```bash
npm install winston nest-winston winston-daily-rotate-file uuid
npm install -D @types/uuid
```

---

### Step 1: Install Logging Dependencies

```bash
npm install winston nest-winston winston-daily-rotate-file uuid
npm install -D @types/uuid
```

**Dependencies:**
- `winston` - Enterprise logging library with multiple transports
- `nest-winston` - NestJS integration for Winston
- `winston-daily-rotate-file` - Daily log rotation with 90-day retention
- `uuid` - Generate unique request and correlation IDs

---

### Step 2: Define Logger Interfaces

**File:** `src/common/logger/logger.interface.ts`

```typescript
/**
 * Log context for structured logging
 * Per architecture.md "Logging Format" specification
 */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  userId?: string;
  userRole?: string;
  ip?: string;
  body?: unknown; // Request body (redacted)
  timings?: PerformanceTimings;
  [key: string]: unknown;
}

export interface PerformanceTimings {
  dbQueryMs?: number;
  externalApiMs?: number;
  totalMs?: number;
}

/**
 * Structured log entry matching architecture.md "Consistency Patterns - Logging Format"
 */
export interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'debug';
  timestamp: string;
  requestId: string;
  correlationId: string;
  service: string;
  message: string;
  context: LogContext;
  error?: { name: string; message: string; stack?: string };
}

export interface LoggerConfig {
  level: string;
  serviceName: string;
  console: boolean;
  file: boolean;
  fileDir: string;
  retentionDays: number;
  jsonFormat: boolean;
  redactFields: string[];
  sampling?: { enabled: boolean; rate: number };
}

/**
 * Sensitive fields to redact from logs
 */
export const SENSITIVE_FIELDS = [
  'password', 'token', 'accessToken', 'refreshToken', 'secret',
  'apiKey', 'authorization', 'cookie', 'creditCard', 'ssn',
  'email', 'phone', // PII - redact in production
] as const;
```

---

### Step 3: Create Logger Constants

**File:** `src/common/logger/logger.constants.ts`

```typescript
export const LOGGER_CONSTANTS = {
  SERVICE_NAME: 'ai-dev-orchestrator',
  LOG_DIR: 'logs',
  RETENTION_DAYS: 90,
  MAX_FILE_SIZE: '20m',
  DATE_PATTERN: 'YYYY-MM-DD',
  COMBINED_LOG: 'combined-%DATE%.log',
  ERROR_LOG: 'error-%DATE%.log',
  REQUEST_ID_HEADER: 'x-request-id',
  CORRELATION_ID_HEADER: 'x-correlation-id',
} as const;

export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;
```

---

### Step 4: Create Sensitive Data Redactor

**File:** `src/common/logger/formatters/sensitive-data.redactor.ts`

```typescript
import { SENSITIVE_FIELDS } from '../logger.interface';

const REDACTED = '[REDACTED]';

export function redactSensitiveData(
  obj: unknown,
  additionalFields: string[] = [],
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, additionalFields));
  }

  const sensitiveFieldsSet = new Set([
    ...SENSITIVE_FIELDS,
    ...additionalFields.map((f) => f.toLowerCase()),
  ]);

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    // Check for exact or partial sensitive field match
    const isSensitive = sensitiveFieldsSet.has(keyLower) ||
      Array.from(sensitiveFieldsSet).some(
        (field) => keyLower.includes(field) || field.includes(keyLower),
      );

    if (isSensitive) {
      redacted[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, additionalFields);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

export function redactAuthHeader(value: string): string {
  if (!value) return value;
  if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
  if (value.startsWith('Basic ')) return 'Basic [REDACTED]';
  return REDACTED;
}
```

---

### Step 5: Create JSON Formatter

**File:** `src/common/logger/formatters/json.formatter.ts`

```typescript
import { format } from 'winston';
import { redactSensitiveData } from './sensitive-data.redactor';

const { combine, timestamp, errors, json, printf } = format;

export const jsonFormatter = (serviceName: string, redactFields: string[] = []) =>
  combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    format((info) => {
      const {
        level, message, timestamp: ts,
        requestId = 'system', correlationId = 'system',
        context = {}, stack, ...rest
      } = info;

      const logEntry: Record<string, unknown> = {
        level,
        timestamp: ts,
        requestId,
        correlationId,
        service: serviceName,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        context: redactSensitiveData({ ...context, ...rest }, redactFields),
      };

      if (level === 'error' && stack) {
        logEntry.error = { stack };
      }

      return logEntry as any;
    })(),
    json(),
  );

export const prettyFormatter = (serviceName: string, redactFields: string[] = []) =>
  combine(
    timestamp({ format: 'HH:mm:ss.SSS' }),
    errors({ stack: true }),
    format.colorize({ all: true }),
    printf(({ level, message, timestamp: ts, requestId, correlationId, stack, ...rest }) => {
      const reqId = requestId ? `[${String(requestId).slice(0, 8)}]` : '';
      const corrId = correlationId ? `[${String(correlationId).slice(0, 8)}]` : '';
      const contextStr = Object.keys(rest).length > 0
        ? `\n  ${JSON.stringify(redactSensitiveData(rest, redactFields), null, 2).replace(/\n/g, '\n  ')}`
        : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `${ts} ${level} ${reqId}${corrId} ${message}${contextStr}${stackStr}`;
    }),
  );
```

**File:** `src/common/logger/formatters/index.ts`

```typescript
export { jsonFormatter, prettyFormatter } from './json.formatter';
export { redactSensitiveData, redactAuthHeader } from './sensitive-data.redactor';
```

---

### Step 6: Create Transport Configurations

**File:** `src/common/logger/transports/console.transport.ts`

```typescript
import { transports } from 'winston';
import { jsonFormatter, prettyFormatter } from '../formatters';

export function createConsoleTransport(
  serviceName: string,
  isProduction: boolean,
  redactFields: string[] = [],
) {
  return new transports.Console({
    format: isProduction
      ? jsonFormatter(serviceName, redactFields)
      : prettyFormatter(serviceName, redactFields),
  });
}
```

**File:** `src/common/logger/transports/file.transport.ts`

```typescript
import DailyRotateFile from 'winston-daily-rotate-file';
import { LOGGER_CONSTANTS } from '../logger.constants';
import { jsonFormatter } from '../formatters';

export function createCombinedFileTransport(
  serviceName: string,
  logDir: string,
  redactFields: string[] = [],
): DailyRotateFile {
  return new DailyRotateFile({
    dirname: logDir,
    filename: LOGGER_CONSTANTS.COMBINED_LOG,
    datePattern: LOGGER_CONSTANTS.DATE_PATTERN,
    maxSize: LOGGER_CONSTANTS.MAX_FILE_SIZE,
    maxFiles: `${LOGGER_CONSTANTS.RETENTION_DAYS}d`,
    format: jsonFormatter(serviceName, redactFields),
    zippedArchive: true,
  });
}

export function createErrorFileTransport(
  serviceName: string,
  logDir: string,
  redactFields: string[] = [],
): DailyRotateFile {
  return new DailyRotateFile({
    dirname: logDir,
    filename: LOGGER_CONSTANTS.ERROR_LOG,
    datePattern: LOGGER_CONSTANTS.DATE_PATTERN,
    maxSize: LOGGER_CONSTANTS.MAX_FILE_SIZE,
    maxFiles: `${LOGGER_CONSTANTS.RETENTION_DAYS}d`,
    level: 'error',
    format: jsonFormatter(serviceName, redactFields),
    zippedArchive: true,
  });
}

// Future: Remote transports for log aggregation
// - CloudWatch: new WinstonCloudWatch({ ... })
// - Datadog: new DatadogTransport({ ... })
// - ELK Stack: new ElasticsearchTransport({ ... })
```

**File:** `src/common/logger/transports/index.ts`

```typescript
export { createConsoleTransport } from './console.transport';
export { createCombinedFileTransport, createErrorFileTransport } from './file.transport';
```

---

### Step 7: Create Async Context Storage

**File:** `src/common/context/async-local-storage.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks';
import { PerformanceTimings } from '../logger/logger.interface';

export interface RequestContextData {
  requestId: string;
  correlationId: string;
  startTime: number;
  userId?: string;
  userRole?: string;
  timings?: PerformanceTimings;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

export function getRequestContext(): RequestContextData | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

export function runInContext<T>(context: RequestContextData, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function addTiming(key: keyof PerformanceTimings, ms: number): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.timings = store.timings || {};
    store.timings[key] = ms;
  }
}
```

**File:** `src/common/context/request-context.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { RequestContextData, asyncLocalStorage } from './async-local-storage';
import { LOGGER_CONSTANTS } from '../logger/logger.constants';

export function createRequestContext(
  headers: Record<string, string | string[] | undefined>,
): RequestContextData {
  const requestIdHeader = headers[LOGGER_CONSTANTS.REQUEST_ID_HEADER];
  const requestId = Array.isArray(requestIdHeader)
    ? requestIdHeader[0] : requestIdHeader || uuidv4();

  const correlationIdHeader = headers[LOGGER_CONSTANTS.CORRELATION_ID_HEADER];
  const correlationId = Array.isArray(correlationIdHeader)
    ? correlationIdHeader[0] : correlationIdHeader || uuidv4();

  return { requestId, correlationId, startTime: Date.now() };
}

export function setUserContext(userId: string, userRole?: string): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.userId = userId;
    store.userRole = userRole;
  }
}
```

**File:** `src/common/context/index.ts`

```typescript
export {
  asyncLocalStorage, getRequestContext, getRequestId,
  getCorrelationId, runInContext, addTiming, RequestContextData,
} from './async-local-storage';
export { createRequestContext, setUserContext } from './request-context';
```

---

### Step 8: Create Logger Service

**File:** `src/common/logger/logger.service.ts`

```typescript
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
    const logDir = this.configService.get<string>('monitoring.logging.dir', LOGGER_CONSTANTS.LOG_DIR);
    const enableFile = this.configService.get<boolean>('monitoring.logging.file', isProduction);
    const redactFields = this.configService.get<string[]>('monitoring.logging.redactFields', []);

    this.serviceName = this.configService.get<string>(
      'monitoring.logging.serviceName',
      LOGGER_CONSTANTS.SERVICE_NAME,
    );

    const transports = [
      createConsoleTransport(this.serviceName, isProduction, redactFields),
    ];

    if (enableFile) {
      transports.push(
        createCombinedFileTransport(this.serviceName, logDir, redactFields),
        createErrorFileTransport(this.serviceName, logDir, redactFields),
      );
    }

    this.logger = createLogger({
      level: logLevel,
      levels: LOG_LEVELS,
      transports,
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
```

---

### Step 9: Create Logger Module

**File:** `src/common/logger/logger.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
```

**File:** `src/common/logger/index.ts`

```typescript
export { LoggerModule } from './logger.module';
export { LoggerService } from './logger.service';
export { LOGGER_CONSTANTS, LOG_LEVELS, LogLevel } from './logger.constants';
export { LogContext, LogEntry, LoggerConfig, SENSITIVE_FIELDS } from './logger.interface';
```

---

### Step 10: Create Correlation ID Middleware

**File:** `src/common/middleware/correlation-id.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { LOGGER_CONSTANTS } from '../logger/logger.constants';
import { createRequestContext, runInContext } from '../context';
import { LoggerService } from '../logger';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    const headers = (req as any).headers || {};
    const context = createRequestContext(headers);

    res.setHeader(LOGGER_CONSTANTS.REQUEST_ID_HEADER, context.requestId);
    res.setHeader(LOGGER_CONSTANTS.CORRELATION_ID_HEADER, context.correlationId);

    this.logger.debug('Request started', {
      requestId: context.requestId,
      correlationId: context.correlationId,
      method: (req as any).method,
      url: (req as any).url,
    });

    runInContext(context, () => next());
  }
}
```

**File:** `src/common/middleware/index.ts`

```typescript
export { CorrelationIdMiddleware } from './correlation-id.middleware';
```

---

### Step 11: Create Logging Interceptor

**File:** `src/common/interceptors/logging.interceptor.ts`

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { LoggerService } from '../logger';
import { getRequestContext } from '../context';
import { redactSensitiveData } from '../logger/formatters';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const reqContext = getRequestContext();
    const startTime = reqContext?.startTime || Date.now();

    // Log request with optional body (redacted)
    const logContext: Record<string, unknown> = {
      method,
      url,
      ip: this.anonymizeIp(ip),
      userAgent,
      userId: reqContext?.userId,
    };

    // Log request body for non-GET requests (debugging)
    if (method !== 'GET' && request.body && Object.keys(request.body).length > 0) {
      logContext.body = redactSensitiveData(request.body);
    }

    this.logger.log('Request received', logContext);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log('Request completed', {
          method, url, statusCode: response.statusCode, duration,
          userId: reqContext?.userId, timings: reqContext?.timings,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error('Request failed', error.stack, {
          method, url, statusCode: error.status || 500, duration,
          errorMessage: error.message, userId: reqContext?.userId,
        });
        throw error;
      }),
    );
  }

  private anonymizeIp(ip: string | undefined): string {
    if (!ip) return 'unknown';
    if (ip === '::1') return '::1';
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return ip;
  }
}
```

**File:** `src/common/interceptors/index.ts`

```typescript
export { LoggingInterceptor } from './logging.interceptor';
```

---

### Step 12: Create Global Exception Filter

**File:** `src/common/filters/http-exception.filter.ts`

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from '../logger';
import { getRequestId } from '../context';

/**
 * Global exception filter for consistent error logging and responses
 * Per architecture.md: "User-Facing Error Messages" + "Never expose stack traces"
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? this.extractMessage(exception)
      : 'Internal server error';

    const requestId = getRequestId() || 'unknown';

    // Log the full error with stack trace
    this.logger.error(
      `Unhandled exception: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
      exception instanceof Error ? exception.stack : undefined,
      {
        statusCode: status,
        path: request.url,
        method: request.method,
        requestId,
      },
    );

    // Send sanitized response to client (no stack traces)
    response.status(status).send({
      statusCode: status,
      message: status === HttpStatus.INTERNAL_SERVER_ERROR
        ? `An unexpected error occurred. Request ID: ${requestId}`
        : message,
      error: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal Server Error' : undefined,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && 'message' in response) {
      const msg = (response as any).message;
      return Array.isArray(msg) ? msg.join(', ') : msg;
    }
    return exception.message;
  }
}
```

**File:** `src/common/filters/index.ts`

```typescript
export { GlobalExceptionFilter } from './http-exception.filter';
```

---

### Step 13: Create @AuditLog() Decorator

**File:** `src/common/decorators/audit-log.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log';

/**
 * Audit log configuration for method-level tracking
 * Per architecture.md: "All state changes logged to audit_log table"
 */
export interface AuditLogOptions {
  /** Entity type being modified (ticket, execution, deployment) */
  entityType: string;
  /** Action being performed (create, update, delete, status_change) */
  action: string;
  /** Whether to capture before/after state */
  captureState?: boolean;
}

/**
 * Decorator to mark methods for audit logging
 * 
 * Usage:
 * @AuditLog({ entityType: 'ticket', action: 'status_change', captureState: true })
 * async updateTicketStatus(id: string, status: TicketStatus) { }
 * 
 * The AuditLogInterceptor (to be implemented) will:
 * 1. Capture entity state before method execution
 * 2. Execute the method
 * 3. Capture entity state after method execution
 * 4. Log to audit_log table with actor, timestamps, and state diff
 */
export const AuditLog = (options: AuditLogOptions) =>
  SetMetadata(AUDIT_LOG_KEY, options);
```

**Update:** `src/common/decorators/index.ts` (add export)

```typescript
// Add to existing exports:
export { AuditLog, AUDIT_LOG_KEY, AuditLogOptions } from './audit-log.decorator';
```

---

### Step 14: Update Configuration

**File:** `src/config/configuration.ts` (UPDATE existing monitoring section)

```typescript
// Replace the existing monitoring section with:
monitoring: {
  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    enabled: !!process.env.SENTRY_DSN && process.env.NODE_ENV === 'production',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    serviceName: process.env.LOG_SERVICE_NAME || 'ai-dev-orchestrator',
    dir: process.env.LOG_DIR || 'logs',
    file: process.env.LOG_FILE_ENABLED === 'true',
    jsonFormat: process.env.NODE_ENV === 'production',
    redactFields: (process.env.LOG_REDACT_FIELDS || '').split(',').filter(Boolean),
    sampling: {
      enabled: process.env.LOG_SAMPLING_ENABLED === 'true',
      rate: parseFloat(process.env.LOG_SAMPLING_RATE || '1.0'),
    },
  },
},
```

---

### Step 15: Update Environment Validation

**File:** `src/config/env.validation.ts` (ADD logging validation)

```typescript
// Add to the Joi schema:
LOG_LEVEL: Joi.string()
  .valid('error', 'warn', 'info', 'debug')
  .default('info')
  .description('Logging level'),

LOG_SERVICE_NAME: Joi.string()
  .default('ai-dev-orchestrator')
  .description('Service name for log entries'),

LOG_DIR: Joi.string()
  .default('logs')
  .description('Directory for log files'),

LOG_FILE_ENABLED: Joi.boolean()
  .default(false)
  .description('Enable file logging'),

LOG_REDACT_FIELDS: Joi.string()
  .default('')
  .description('Comma-separated additional fields to redact'),

LOG_SAMPLING_ENABLED: Joi.boolean()
  .default(false)
  .description('Enable log sampling for high-volume environments'),

LOG_SAMPLING_RATE: Joi.number()
  .min(0)
  .max(1)
  .default(1.0)
  .description('Log sampling rate (0.0 to 1.0)'),
```

---

### Step 16: Update JWT Strategy for User Context

**File:** `src/auth/strategies/jwt.strategy.ts` (MODIFY existing file)

**Add import at top:**
```typescript
import { setUserContext } from '../../common/context';
```

**Update validate method (add one line before return):**
```typescript
async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
  // ... existing validation code ...

  // Propagate user context to logger (enables userId in all logs)
  setUserContext(payload.sub, payload.role);

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    permissions: allPermissions,
  };
}
```

---

### Step 17: Update App Module

**File:** `src/app.module.ts` (UPDATE existing file)

```typescript
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
// ... existing imports ...

// Add Logger imports
import { LoggerModule } from './common/logger';
import { CorrelationIdMiddleware } from './common/middleware';
import { LoggingInterceptor } from './common/interceptors';
import { GlobalExceptionFilter } from './common/filters';

@Module({
  imports: [
    // Global modules (order matters!)
    ConfigModule,
    LoggerModule,  // Must be early for other modules
    DatabaseModule,
    
    // ... rest of existing imports ...
  ],
  controllers: [AppController],
  providers: [
    AppService,
    
    // Global JWT Auth Guard (from Story 1.6)
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    
    // Global Exception Filter (catches all unhandled errors)
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    
    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes('*');
  }
}
```

---

### Step 18: Update Main.ts

**File:** `src/main.ts` (UPDATE existing file)

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger, transports, format } from 'winston';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger';
import { LOGGER_CONSTANTS } from './common/logger/logger.constants';

async function bootstrap() {
  const bootstrapLogger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(format.timestamp(), format.json()),
    transports: [new transports.Console()],
  });

  bootstrapLogger.info('Starting application bootstrap', {
    service: LOGGER_CONSTANTS.SERVICE_NAME,
    nodeEnv: process.env.NODE_ENV,
  });

  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true },
    );

    const logger = app.get(LoggerService);
    app.useLogger(logger);
    app.enableShutdownHooks();

    const port = process.env.PORT || 3000;
    await app.listen(port, '0.0.0.0');

    logger.log('Application started successfully', {
      url: await app.getUrl(),
      environment: process.env.NODE_ENV || 'development',
      port,
    });
  } catch (error) {
    bootstrapLogger.error('Application failed to start', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

bootstrap();
```

---

### Step 19: Update .gitignore

**File:** `.gitignore` (ADD at end)

```gitignore
# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
```

---

## Testing Configuration

### Unit Test: Logger Service

**File:** `src/common/logger/logger.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let service: LoggerService;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                nodeEnv: 'test',
                'monitoring.logging.level': 'debug',
                'monitoring.logging.dir': 'test-logs',
                'monitoring.logging.file': false,
                'monitoring.logging.serviceName': 'test-service',
                'monitoring.logging.redactFields': [],
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LoggerService>(LoggerService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => expect(service).toBeDefined());

  it('should log at all levels without throwing', () => {
    expect(() => service.log('Test info')).not.toThrow();
    expect(() => service.error('Test error', 'stack')).not.toThrow();
    expect(() => service.warn('Test warning')).not.toThrow();
    expect(() => service.debug('Test debug')).not.toThrow();
  });

  it('should accept string and object context', () => {
    expect(() => service.log('Message', 'MyModule')).not.toThrow();
    expect(() => service.log('Message', { userId: '123' })).not.toThrow();
  });

  it('should create child logger', () => {
    const child = service.createChildLogger({ module: 'Test' });
    expect(child).toBeDefined();
  });
});
```

### Unit Test: Sensitive Data Redactor

**File:** `src/common/logger/formatters/sensitive-data.redactor.spec.ts`

```typescript
import { redactSensitiveData, redactAuthHeader } from './sensitive-data.redactor';

describe('redactSensitiveData', () => {
  it('should redact password fields', () => {
    expect(redactSensitiveData({ username: 'john', password: 'secret' }))
      .toEqual({ username: 'john', password: '[REDACTED]' });
  });

  it('should redact nested sensitive fields', () => {
    const result = redactSensitiveData({
      user: { name: 'John', credentials: { password: 'secret', apiKey: 'key' } },
    }) as any;
    expect(result.user.credentials.password).toBe('[REDACTED]');
    expect(result.user.credentials.apiKey).toBe('[REDACTED]');
  });

  it('should handle null/undefined', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
  });

  it('should redact arrays', () => {
    const result = redactSensitiveData([{ secret: 'hidden' }]) as any[];
    expect(result[0].secret).toBe('[REDACTED]');
  });
});

describe('redactAuthHeader', () => {
  it('should redact Bearer token', () => {
    expect(redactAuthHeader('Bearer abc123')).toBe('Bearer [REDACTED]');
  });

  it('should redact Basic auth', () => {
    expect(redactAuthHeader('Basic xyz')).toBe('Basic [REDACTED]');
  });
});
```

### Unit Test: Global Exception Filter

**File:** `src/common/filters/http-exception.filter.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';
import { LoggerService } from '../logger';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockLogger: Partial<LoggerService>;

  beforeEach(async () => {
    mockLogger = { error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlobalExceptionFilter,
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);
  });

  it('should log error and send sanitized response', () => {
    const mockResponse = { status: jest.fn().mockReturnThis(), send: jest.fn() };
    const mockRequest = { url: '/test', method: 'GET' };
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;

    filter.catch(new Error('Test error'), host);

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it('should preserve HTTP exception status', () => {
    const mockResponse = { status: jest.fn().mockReturnThis(), send: jest.fn() };
    const mockRequest = { url: '/test', method: 'GET' };
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;

    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
  });
});
```

### E2E Test: Logging Integration

**File:** `test/logging.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { LOGGER_CONSTANTS } from '../src/common/logger/logger.constants';

describe('Logging (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => await app.close());

  it('should generate request ID in response header', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers[LOGGER_CONSTANTS.REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('should echo provided request ID', async () => {
    const customId = 'my-request-id';
    const response = await request(app.getHttpServer())
      .get('/health')
      .set(LOGGER_CONSTANTS.REQUEST_ID_HEADER, customId);
    expect(response.headers[LOGGER_CONSTANTS.REQUEST_ID_HEADER]).toBe(customId);
  });

  it('should generate correlation ID in response header', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers[LOGGER_CONSTANTS.CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('should return requestId in error responses', async () => {
    const response = await request(app.getHttpServer()).get('/nonexistent');
    expect(response.body.requestId).toBeDefined();
  });
});
```

---

## Validation Checklist

**Installation & Setup:**
- [ ] `winston`, `nest-winston`, `winston-daily-rotate-file`, `uuid` installed
- [ ] `@types/uuid` installed as devDependency

**Logger Module (6 files):**
- [ ] `src/common/logger/logger.module.ts` - @Global module
- [ ] `src/common/logger/logger.service.ts` - implements NestLoggerService
- [ ] `src/common/logger/logger.constants.ts` - constants and types
- [ ] `src/common/logger/logger.interface.ts` - interfaces
- [ ] `src/common/logger/index.ts` - barrel export
- [ ] `src/common/logger/logger.service.spec.ts` - unit tests

**Formatters (3 files):**
- [ ] `src/common/logger/formatters/json.formatter.ts`
- [ ] `src/common/logger/formatters/sensitive-data.redactor.ts`
- [ ] `src/common/logger/formatters/index.ts`

**Transports (3 files):**
- [ ] `src/common/logger/transports/console.transport.ts`
- [ ] `src/common/logger/transports/file.transport.ts`
- [ ] `src/common/logger/transports/index.ts`

**Context (3 files):**
- [ ] `src/common/context/async-local-storage.ts`
- [ ] `src/common/context/request-context.ts`
- [ ] `src/common/context/index.ts`

**Middleware (2 files):**
- [ ] `src/common/middleware/correlation-id.middleware.ts`
- [ ] `src/common/middleware/index.ts`

**Interceptors (2 files):**
- [ ] `src/common/interceptors/logging.interceptor.ts`
- [ ] `src/common/interceptors/index.ts`

**Filters (2 files):**
- [ ] `src/common/filters/http-exception.filter.ts`
- [ ] `src/common/filters/index.ts`

**Decorators (1 file):**
- [ ] `src/common/decorators/audit-log.decorator.ts`

**Log Format Compliance:**
- [ ] All logs contain: level, timestamp, requestId, correlationId, service, message, context
- [ ] Error logs contain error.stack
- [ ] Sensitive data redacted (passwords, tokens, PII)

**Integration:**
- [ ] LoggerModule in AppModule (early in imports)
- [ ] GlobalExceptionFilter as APP_FILTER
- [ ] LoggingInterceptor as APP_INTERCEPTOR
- [ ] CorrelationIdMiddleware for all routes
- [ ] JWT Strategy calls setUserContext()
- [ ] main.ts uses LoggerService
- [ ] .gitignore excludes logs/

**Configuration:**
- [ ] monitoring.logging section in configuration.ts
- [ ] Logging env vars in env.validation.ts

**Tests:**
- [ ] Unit tests pass for LoggerService, Redactor, ExceptionFilter
- [ ] E2E tests pass for request/correlation ID handling
- [ ] `npm run test` passes
- [ ] `npm run test:e2e` passes

**Code Quality:**
- [ ] `npm run lint` - no errors
- [ ] TypeScript compiles without errors

---

## References

| Source | Section | Lines |
|--------|---------|-------|
| Architecture | Technology Stack (Winston 3.x) | 55 |
| Architecture | Logging Format specification | 1513-1525 |
| Architecture | Audit Trail requirements | 1527-1530, 1782-1801 |
| Architecture | Project Structure (logger, filters) | 232-248 |
| Epics | Story 1.7 acceptance criteria | 464-505 |
| PRD | NFR-O1-O4 (Observability) | Full section |

---

## Dev Agent Record

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE + QUALITY VALIDATED  
**Developer Readiness:** ✅ ULTIMATE IMPLEMENTATION GUIDE

**Applied Improvements:**
- ✅ Added GlobalExceptionFilter (was missing from original)
- ✅ Added @AuditLog() decorator (per architecture requirement)
- ✅ Added JWT Strategy integration for user context in logs
- ✅ Added env.validation.ts logging schema
- ✅ Added .gitignore for logs directory
- ✅ Added request body logging with redaction
- ✅ Added performance timing support
- ✅ Added log sampling configuration
- ✅ Consolidated config with existing monitoring structure
- ✅ Added Quick Implementation Reference
- ✅ Optimized code for token efficiency

**Document prepared by:** Bob (Scrum Master)  
**Quality validated by:** Independent LLM Reviewer  
**Preparation date:** 2025-11-28

## Dev Agent Record (Implementation)

### Implementation Notes
- Implemented structured JSON logging using `winston` and `nest-winston`.
- Configured daily log rotation with `winston-daily-rotate-file` (90 days retention).
- Implemented `AsyncLocalStorage` for request context propagation (requestId, correlationId).
- Added `CorrelationIdMiddleware` to generate/extract IDs from headers.
- Added `LoggingInterceptor` for request/response logging with performance timing.
- Added `HttpExceptionFilter` for consistent error logging without exposing stack traces to users.
- Implemented sensitive data redaction for PII and secrets.
- Added `@AuditLog` decorator for future audit trail implementation.
- Integrated `LoggerService` into `main.ts` and `AppModule`.

### Test Results
- **Unit Tests**: Created and passed `src/common/logger/logger.service.spec.ts`.
  - Verified log levels (info, error).
  - Verified sensitive data redaction (password, token).
  - Verified context propagation.
- **Manual Verification**:
  - Verified log output format in console (pretty print in dev).
  - Verified JSON format in production mode (simulated).
  - Verified log files creation in `logs/` directory.

### File List
#### Created (Story 1.7)
- `src/common/logger/logger.interface.ts`
- `src/common/logger/logger.constants.ts`
- `src/common/logger/formatters/sensitive-data.redactor.ts`
- `src/common/logger/formatters/json.formatter.ts`
- `src/common/logger/formatters/index.ts`
- `src/common/logger/transports/console.transport.ts`
- `src/common/logger/transports/file.transport.ts`
- `src/common/logger/transports/index.ts`
- `src/common/context/async-local-storage.ts`
- `src/common/context/request-context.ts`
- `src/common/context/index.ts`
- `src/common/logger/logger.service.ts`
- `src/common/logger/logger.module.ts`
- `src/common/logger/index.ts`
- `src/common/middleware/correlation-id.middleware.ts`
- `src/common/middleware/index.ts`
- `src/common/interceptors/logging.interceptor.ts`
- `src/common/interceptors/audit-log.interceptor.ts` (Review fix)
- `src/common/interceptors/index.ts`
- `src/common/filters/http-exception.filter.ts`
- `src/common/filters/index.ts`
- `src/common/decorators/audit-log.decorator.ts`
- `src/common/logger/logger.service.spec.ts`

#### Modified (Story 1.7)
- `src/config/configuration.ts`
- `src/config/env.validation.ts`
- `src/app.module.ts`
- `src/main.ts`
- `src/auth/strategies/jwt.strategy.ts` (Review fix - added LoggerService and setUserContext)

#### Note
Files in `src/common/decorators/` and `src/common/guards/` NOT listed above were created by Story 1.6 (JWT Authentication) and pre-existed before Story 1.7.

---

## Code Review Fixes Applied

The following issues from the adversarial code review were fixed:

1. ✅ **@AuditLog() Interceptor Implemented** - Created `audit-log.interceptor.ts` to process decorator metadata
2. ✅ **JWT Strategy Updated** - Now uses `LoggerService` and calls `setUserContext()` for user tracking
3. ✅ **File List Corrected** - Removed false claims (.gitignore already correct, jwt.strategy.ts now actually modified)
4. ✅ **Documentation Accuracy** - Clarified which files are from Story 1.7 vs Story 1.6


