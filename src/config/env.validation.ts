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

  // AI Providers (at least one required)
  CURSOR_API_KEY: Joi.string().allow(''),
  WINDSURF_API_KEY: Joi.string().allow(''),
  ANTIGRAVITY_API_KEY: Joi.string().allow(''),

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
  SENTRY_DSN: Joi.string().uri().optional(),
  SENTRY_ENVIRONMENT: Joi.string().optional(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),

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
})
  // Custom validation: At least one AI provider must be configured
  .custom((value, helpers) => {
    const hasAnyProvider =
      value.CURSOR_API_KEY || value.WINDSURF_API_KEY || value.ANTIGRAVITY_API_KEY;

    if (!hasAnyProvider) {
      return helpers.error('any.custom', {
        message:
          'At least one AI provider API key must be configured (CURSOR_API_KEY, WINDSURF_API_KEY, or ANTIGRAVITY_API_KEY)',
      });
    }

    return value;
  });
