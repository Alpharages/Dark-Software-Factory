import * as Joi from 'joi';

/**
 * Joi validation schema for environment variables
 * Application will fail to start if required variables are missing or invalid
 */
export const envValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // Database (REQUIRED)
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required()
    .messages({
      'any.required':
        'DATABASE_URL is required. Example: postgresql://user:pass@localhost:5432/dbname',
      'string.uri': 'DATABASE_URL must be a valid PostgreSQL connection string',
    }),

  // Message Queue (REQUIRED)
  RABBITMQ_URL: Joi.string().uri({ scheme: 'amqp' }).required().messages({
    'any.required': 'RABBITMQ_URL is required. Example: amqp://guest:guest@localhost:5672',
    'string.uri': 'RABBITMQ_URL must be a valid AMQP connection string',
  }),

  // Authentication (REQUIRED)
  JWT_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_SECRET is required. Generate with: openssl rand -base64 32',
    'string.min': 'JWT_SECRET must be at least 32 characters for security',
  }),
  AUTH_SERVICE_URL: Joi.string().uri().required(),

  // AI Providers (Story 2.3)
  CURSOR_HEADLESS_ENABLED: Joi.boolean().default(false),
  CURSOR_HEADLESS_HEALTH_URL: Joi.string().allow('').optional(),
  CURSOR_HEADLESS_TIMEOUT: Joi.number().default(300000),
  CURSOR_MAX_CONCURRENT: Joi.number().default(3),

  CLAUDE_CODE_ENABLED: Joi.boolean().default(false),
  ANTHROPIC_API_KEY: Joi.string().when('CLAUDE_CODE_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  CLAUDE_CODE_TIMEOUT: Joi.number().default(180000),
  CLAUDE_MAX_CONCURRENT: Joi.number().default(5),

  AI_COMPLEXITY_THRESHOLD: Joi.number().default(10),
  AI_RETRY_DELAY_MINUTES: Joi.number().default(5),
  AI_ALERT_THRESHOLD_MINUTES: Joi.number().default(15),

  // GitHub Integration (REQUIRED)
  GITHUB_TOKEN: Joi.string()
    .pattern(/^(ghp_|ghs_|github_pat_)/)
    .required()
    .messages({
      'any.required': 'GITHUB_TOKEN is required for GitHub integration',
      'string.pattern.base':
        'GITHUB_TOKEN must be a valid GitHub token (starts with ghp_, ghs_, or github_pat_)',
    }),

  // GitHub App (optional, alternative to token)
  GITHUB_APP_ID: Joi.number().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: Joi.string().optional(),

  // ClickUp Integration (REQUIRED)
  CLICKUP_API_KEY: Joi.string().required(),
  CLICKUP_WEBHOOK_SECRET: Joi.string().min(16).required().messages({
    'any.required': 'CLICKUP_WEBHOOK_SECRET is required for webhook signature verification',
    'string.min': 'CLICKUP_WEBHOOK_SECRET must be at least 16 characters',
  }),

  // Monitoring (optional but recommended)
  SENTRY_DSN: Joi.string().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional(),
  SENTRY_RELEASE: Joi.string().optional(),
  SENTRY_DEBUG: Joi.boolean().default(false),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  SERVICE_NAME: Joi.string().default('ai-dev-orchestrator'),
  LOG_DIR: Joi.string().default('logs'),
  LOG_FILE_ENABLED: Joi.boolean().default(true),
  LOG_REDACT_FIELDS: Joi.string().optional(),

  // Security
  RATE_LIMIT_PER_USER: Joi.number().default(1000),
  RATE_LIMIT_PER_IP: Joi.number().default(5000),
  CORS_ORIGINS: Joi.string().default('http://localhost:3001'),

  // External Services
  AETHERFLOW_SERVICE_URL: Joi.string().uri().optional(),
  REDIS_URL: Joi.string().uri({ scheme: 'redis' }).optional(),

  // Feature Flags
  FEATURE_SELF_HEALING: Joi.boolean().default(true),
  FEATURE_COST_TRACKING: Joi.boolean().default(true),
  FEATURE_QUALITY_GATES: Joi.boolean().default(true),

  // Story 2.6: Cursor CLI Configuration (optional - has defaults)
  CURSOR_CLI_PATH: Joi.string().default('cursor'),
  CURSOR_HEADLESS_TIMEOUT_MS: Joi.number().min(30000).max(600000).default(300000),
  CURSOR_WORKSPACES_ROOT: Joi.string().default('/tmp/cursor-workspaces'),
  CURSOR_MAX_CONCURRENT_WORKSPACES: Joi.number().min(1).max(50).default(10),
  CURSOR_PRESERVE_FAILED_WORKSPACES: Joi.boolean().default(true),
  CURSOR_WORKSPACE_CLEANUP_AGE_MS: Joi.number().default(7 * 24 * 60 * 60 * 1000),
  CURSOR_GIT_USER_NAME: Joi.string().default('Dark Factory'),
  CURSOR_GIT_USER_EMAIL: Joi.string().email().default('bot@darkfactory.ai'),

  // Story 2.7: Anthropic API Configuration (optional - provider disabled if not set)
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),
  ANTHROPIC_MAX_TOKENS: Joi.number().min(1000).max(100000).default(8000),
  ANTHROPIC_TIMEOUT_MS: Joi.number().min(30000).max(300000).default(120000),
  CLAUDE_WORKSPACES_ROOT: Joi.string().default('/tmp/claude-workspaces'),

  // Story 2.11: Quality Scoring Configuration (optional - has sensible defaults)
  QUALITY_SCORE_THRESHOLD_EXCELLENT: Joi.number().integer().min(0).max(100).default(90),
  QUALITY_SCORE_THRESHOLD_GOOD: Joi.number().integer().min(0).max(100).default(70),
  QUALITY_SCORE_THRESHOLD_FAIR: Joi.number().integer().min(0).max(100).default(50),
  QUALITY_MINIMUM_THRESHOLD: Joi.number().integer().min(0).max(100).default(50),
  QUALITY_SCORE_CACHE_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(300),

  // Story 2.12: Context Extraction Configuration (optional - has sensible defaults)
  // FR3: PM can attach context documents (PDF, MD, TXT, DOCX)
  // FR59: System extracts project context
  CONTEXT_MAX_FILE_SIZE_MB: Joi.number().integer().min(1).max(50).default(10),
  CONTEXT_CACHE_TTL_HOURS: Joi.number().integer().min(1).max(168).default(24), // Max 1 week
  CONTEXT_STORAGE_PATH: Joi.string().default('./uploads/context'),
  CONTEXT_SUPPORTED_FORMATS: Joi.string().default('pdf,md,txt,docx'),
});
