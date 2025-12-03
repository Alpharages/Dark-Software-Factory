/**
 * Sentry Error Tracking Constants
 * Per architecture.md "Error Tracking" section (NFR-R4-R7)
 */

export const SENTRY_CONSTANTS = {
  // Sample rates (per NFR-O6 cost control)
  DEVELOPMENT_SAMPLE_RATE: 1.0, // 100% in development
  PRODUCTION_SAMPLE_RATE: 0.1, // 10% in production (cost control)
  TRACES_SAMPLE_RATE: 0.1, // 10% performance traces
  PROFILES_SAMPLE_RATE: 0.1, // 10% profiling data

  // Error grouping fingerprints
  FINGERPRINT_SEPARATOR: '::',

  // Breadcrumb limits
  MAX_BREADCRUMBS: 100,

  // Context limits
  MAX_VALUE_LENGTH: 8192,
} as const;

/**
 * Error severity levels (aligned with Sentry severity)
 * Maps to alert configurations
 */
export enum ErrorSeverity {
  FATAL = 'fatal', // Application crash
  CRITICAL = 'error', // Critical error requiring immediate attention
  HIGH = 'warning', // High priority issue
  MEDIUM = 'info', // Medium priority
  LOW = 'debug', // Low priority, informational
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  // Application errors
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DATABASE = 'database',

  // Integration errors
  AI_PROVIDER = 'ai_provider',
  GITHUB = 'github',
  CLICKUP = 'clickup',
  RABBITMQ = 'rabbitmq',

  // System errors
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  NETWORK = 'network',
  UNKNOWN = 'unknown',

  // Story 2.9: Retry Logic
  AI_EXECUTION = 'ai_execution',
  RETRY_HANDLER = 'retry_handler',
}

/**
 * Tags for error filtering in Sentry dashboard
 */
export const SENTRY_TAGS = {
  PROJECT_ID: 'project_id',
  TICKET_ID: 'ticket_id',
  EXECUTION_ID: 'execution_id',
  AI_PROVIDER: 'ai_provider',
  ENVIRONMENT: 'environment',
  SERVICE: 'service',
  USER_ROLE: 'user_role',
  ERROR_CATEGORY: 'error_category',
} as const;

/**
 * Ignored errors (don't send to Sentry)
 */
export const IGNORED_ERRORS = [
  'NotFoundException', // 404s are normal
  'UnauthorizedException', // Auth failures tracked via metrics
  'BadRequestException', // Validation errors tracked via metrics
] as const;

/**
 * Sensitive data to scrub from error reports
 */
export const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'jwt',
  'creditCard',
  'credit_card',
  'ssn',
] as const;
