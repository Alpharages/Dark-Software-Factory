import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  SENTRY_CONSTANTS,
  ErrorSeverity,
  ErrorCategory,
  SENTRY_TAGS,
  IGNORED_ERRORS,
  SENSITIVE_FIELDS,
} from './sentry.constants';
import {
  SentryConfig,
  CaptureErrorOptions,
  SentryUser,
  RequestContext,
  BreadcrumbData,
} from './sentry.interface';

@Injectable()
export class SentryService implements OnModuleInit, OnModuleDestroy {
  private isInitialized = false;
  private config: SentryConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = this.loadConfig();
  }

  onModuleInit(): void {
    if (this.config.enabled && !this.isInitialized) {
      this.initializeSentry();
    }
  }

  onModuleDestroy(): void {
    if (this.isInitialized) {
      // Flush pending events before shutdown
      Sentry.close(2000).then(() => {
        this.logger.log('Sentry client closed', 'SentryService');
      });
    }
  }

  private loadConfig(): SentryConfig {
    const environment = this.configService.get<string>('NODE_ENV', 'development');
    const isProduction = environment === 'production';

    return {
      dsn: this.configService.get<string>('SENTRY_DSN', ''),
      environment,
      release: this.configService.get<string>('SENTRY_RELEASE'),
      sampleRate: isProduction
        ? SENTRY_CONSTANTS.PRODUCTION_SAMPLE_RATE
        : SENTRY_CONSTANTS.DEVELOPMENT_SAMPLE_RATE,
      tracesSampleRate: SENTRY_CONSTANTS.TRACES_SAMPLE_RATE,
      profilesSampleRate: SENTRY_CONSTANTS.PROFILES_SAMPLE_RATE,
      debug: this.configService.get<boolean>('SENTRY_DEBUG', false),
      enabled: !!this.configService.get<string>('SENTRY_DSN'),
    };
  }

  /**
   * Initialize Sentry SDK
   * MUST be called in main.ts BEFORE NestJS app bootstrap
   */
  initializeSentry(): void {
    if (this.isInitialized || !this.config.enabled) {
      return;
    }

    Sentry.init({
      dsn: this.config.dsn,
      environment: this.config.environment,
      release: this.config.release,
      sampleRate: this.config.sampleRate,
      tracesSampleRate: this.config.tracesSampleRate,
      profilesSampleRate: this.config.profilesSampleRate,
      debug: this.config.debug,

      // Integrations
      integrations: [nodeProfilingIntegration()],

      // Breadcrumbs
      maxBreadcrumbs: SENTRY_CONSTANTS.MAX_BREADCRUMBS,

      // Data scrubbing
      beforeSend: (event: Sentry.ErrorEvent) => this.beforeSend(event),
      beforeBreadcrumb: (breadcrumb: Sentry.Breadcrumb) => this.beforeBreadcrumb(breadcrumb),

      // Ignore specific errors
      ignoreErrors: [...IGNORED_ERRORS],

      // Additional options
      maxValueLength: SENTRY_CONSTANTS.MAX_VALUE_LENGTH,
      normalizeDepth: 10,
      attachStacktrace: true,
    });

    this.isInitialized = true;
    this.logger.log(
      `Sentry initialized for ${this.config.environment} (sample rate: ${this.config.sampleRate * 100}%)`,
      'SentryService',
    );
  }

  /**
   * Capture an exception with context
   */
  captureException(error: Error, options: CaptureErrorOptions = {}): string {
    const {
      severity = ErrorSeverity.CRITICAL,
      category = ErrorCategory.UNKNOWN,
      tags = {},
      extra = {},
      user,
      fingerprint,
    } = options;

    // Increment metrics (integration with Story 1.8)
    this.metricsService.incrementErrors(category);
    if (severity === ErrorSeverity.FATAL) {
      this.metricsService.incrementUnhandledExceptions();
    }

    // Log the error
    this.logger.error(`[${category}] ${error.message}`, error.stack, 'SentryService');

    // Capture to Sentry
    const eventId = Sentry.captureException(error, {
      level: severity,
      tags: {
        [SENTRY_TAGS.ERROR_CATEGORY]: category,
        ...tags,
      },
      extra: {
        category,
        ...extra,
      },
      user: user ? this.formatUser(user) : undefined,
      fingerprint: fingerprint || this.generateFingerprint(error, category),
    });

    return eventId;
  }

  /**
   * Capture a message (non-exception event)
   */
  captureMessage(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    extra?: Record<string, unknown>,
  ): string {
    return Sentry.captureMessage(message, {
      level: severity,
      extra,
    });
  }

  /**
   * Add breadcrumb for error trail
   */
  addBreadcrumb(data: BreadcrumbData): void {
    Sentry.addBreadcrumb({
      category: data.category,
      message: data.message,
      level: data.level || 'info',
      data: data.data,
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Set user context for current scope
   */
  setUser(user: SentryUser | null): void {
    if (user) {
      Sentry.setUser(this.formatUser(user));
    } else {
      Sentry.setUser(null);
    }
  }

  /**
   * Set request context
   */
  setRequestContext(context: RequestContext): void {
    Sentry.setContext('request', {
      method: context.method,
      url: context.url,
      headers: this.scrubSensitiveData(context.headers),
      query: context.query,
      params: context.params,
      correlationId: context.correlationId,
    });

    // Add correlation ID as tag for filtering
    if (context.correlationId) {
      Sentry.setTag('correlation_id', context.correlationId);
    }
  }

  /**
   * Set tag on current scope
   */
  setTag(key: string, value: string): void {
    Sentry.setTag(key, value);
  }

  /**
   * Set extra context data
   */
  setExtra(key: string, value: unknown): void {
    Sentry.setExtra(key, value);
  }

  /**
   * Run callback with isolated scope
   */
  withScope<T>(callback: (scope: Sentry.Scope) => T): T {
    return Sentry.withScope(callback);
  }

  /**
   * Start a new transaction for performance monitoring
   */
  startTransaction(name: string, op: string): Sentry.Span | undefined {
    return Sentry.startInactiveSpan({
      name,
      op,
      forceTransaction: true,
    });
  }

  /**
   * Check if Sentry is enabled and initialized
   */
  isEnabled(): boolean {
    return this.config.enabled && this.isInitialized;
  }

  // ============= Private Methods =============

  private beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
    // Scrub sensitive data from event
    if (event.request) {
      event.request.headers = this.scrubSensitiveData(
        event.request.headers as Record<string, string>,
      );
      if (event.request.data) {
        event.request.data = this.scrubSensitiveData(event.request.data as Record<string, unknown>);
      }
    }

    // Add custom processing here if needed
    return event;
  }

  private beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
    // Filter out noisy breadcrumbs
    if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
      return null;
    }

    // Scrub sensitive data from breadcrumb
    if (breadcrumb.data) {
      breadcrumb.data = this.scrubSensitiveData(breadcrumb.data as Record<string, unknown>);
    }

    return breadcrumb;
  }

  private scrubSensitiveData<T extends Record<string, unknown>>(data: T): T {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const scrubbed: Record<string, unknown> = { ...data };

    for (const [key, value] of Object.entries(scrubbed)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))) {
        Reflect.set(scrubbed, key, '[REDACTED]');
      } else if (typeof value === 'object' && value !== null) {
        Reflect.set(scrubbed, key, this.scrubSensitiveData(value as Record<string, unknown>));
      }
    }

    return scrubbed as T;
  }

  private formatUser(user: SentryUser): Sentry.User {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      ip_address: user.ipAddress,
      // Custom data
      data: {
        role: user.role,
      },
    };
  }

  private generateFingerprint(error: Error, category: ErrorCategory): string[] {
    // Group similar errors together
    return [
      category,
      error.name,
      error.message.replace(/[0-9a-f-]{36}/gi, '<uuid>').substring(0, 100),
    ];
  }
}
