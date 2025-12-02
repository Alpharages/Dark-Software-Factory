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
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'creditCard',
  'ssn',
  'email',
  'phone', // PII - redact in production
] as const;
