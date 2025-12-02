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
