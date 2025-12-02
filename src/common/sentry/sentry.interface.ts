import { ErrorSeverity, ErrorCategory } from './sentry.constants';

/**
 * Sentry configuration options
 */
export interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  sampleRate: number;
  tracesSampleRate: number;
  profilesSampleRate: number;
  debug: boolean;
  enabled: boolean;
}

/**
 * Error capture options
 */
export interface CaptureErrorOptions {
  severity?: ErrorSeverity;
  category?: ErrorCategory;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: SentryUser;
  fingerprint?: string[];
}

/**
 * Sentry user context
 */
export interface SentryUser {
  id?: string;
  email?: string;
  username?: string;
  role?: string;
  ipAddress?: string;
}

/**
 * Request context for error enrichment
 */
export interface RequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  correlationId?: string;
}

/**
 * Breadcrumb data for error trail
 */
export interface BreadcrumbData {
  category: string;
  message: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}

/**
 * Error report for structured logging
 */
export interface ErrorReport {
  eventId: string;
  timestamp: Date;
  error: Error;
  severity: ErrorSeverity;
  category: ErrorCategory;
  context?: RequestContext;
  user?: SentryUser;
  tags: Record<string, string>;
}
