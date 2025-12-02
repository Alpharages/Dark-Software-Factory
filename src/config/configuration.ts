/**
 * Type-safe configuration object
 * Loaded from environment variables with validation
 */
export default () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  return {
    // Application
    nodeEnv,
    port: parseInt(process.env.PORT || '3000', 10),
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',

    // Database
    database: {
      url: process.env.DATABASE_URL,
    },

    // Message Queue
    rabbitmq: {
      url: process.env.RABBITMQ_URL,
    },

    // Authentication
    auth: {
      jwtSecret: process.env.JWT_SECRET,
      authServiceUrl: process.env.AUTH_SERVICE_URL,
    },

    // AI Providers
    aiProviders: {
      cursor: {
        apiKey: process.env.CURSOR_API_KEY,
        enabled: !!process.env.CURSOR_API_KEY,
      },
      windsurf: {
        apiKey: process.env.WINDSURF_API_KEY,
        enabled: !!process.env.WINDSURF_API_KEY,
      },
      antigravity: {
        apiKey: process.env.ANTIGRAVITY_API_KEY,
        enabled: !!process.env.ANTIGRAVITY_API_KEY,
      },
    },

    // GitHub Integration
    github: {
      token: process.env.GITHUB_TOKEN,
      appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID, 10) : undefined,
      privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
    },

    // ClickUp Integration
    clickup: {
      apiKey: process.env.CLICKUP_API_KEY,
      webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
    },

    // Monitoring
    monitoring: {
      sentry: {
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE,
        debug: process.env.SENTRY_DEBUG === 'true',
        enabled: !!process.env.SENTRY_DSN,
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        serviceName: process.env.SERVICE_NAME || 'ai-dev-orchestrator',
        dir: process.env.LOG_DIR || 'logs',
        file: process.env.LOG_FILE_ENABLED === 'true',
        redactFields: process.env.LOG_REDACT_FIELDS?.split(',') || [],
      },
    },

    // Security
    security: {
      rateLimitPerUser: parseInt(process.env.RATE_LIMIT_PER_USER || '1000', 10),
      rateLimitPerIp: parseInt(process.env.RATE_LIMIT_PER_IP || '5000', 10),
      corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001'],
    },

    // External Services
    externalServices: {
      aetherflow: {
        url: process.env.AETHERFLOW_SERVICE_URL,
      },
      redis: {
        url: process.env.REDIS_URL,
        enabled: !!process.env.REDIS_URL,
      },
    },

    // Feature Flags
    features: {
      selfHealing: process.env.FEATURE_SELF_HEALING === 'true',
      costTracking: process.env.FEATURE_COST_TRACKING === 'true',
      qualityGates: process.env.FEATURE_QUALITY_GATES === 'true',
    },
  };
};
