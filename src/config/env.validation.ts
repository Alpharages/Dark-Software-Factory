import * as Joi from 'joi';
import * as path from 'path';

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

  // AI Providers (Story 2.3)
  CLAUDE_CODE_ENABLED: Joi.boolean().default(false),
  GEMINI_ENABLED: Joi.boolean().default(false),
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  GEMINI_BASE_URL: Joi.string().uri().allow('').default(''),
  GEMINI_MODEL: Joi.string().default('gemini-2.5-pro'),
  CODEX_ENABLED: Joi.boolean().default(false),
  KIMI_ENABLED: Joi.boolean().default(false),
  // OpenAI Codex provider
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  OPENAI_BASE_URL: Joi.string().uri().allow('').default(''),
  CODEX_MODEL: Joi.string().default('codex-1'),
  // Kimi provider
  KIMI_API_KEY: Joi.string().allow('').default(''),
  KIMI_BASE_URL: Joi.string().uri().allow('').default(''),
  KIMI_MODEL: Joi.string().default('kimi-k2'),
  // ANTHROPIC_API_KEY: Joi.string().when('CLAUDE_CODE_ENABLED', {
  //   is: true,
  //   then: Joi.required(),
  //   otherwise: Joi.optional().allow(''),
  // }),
  CLAUDE_CODE_TIMEOUT: Joi.number().default(180000),
  CLAUDE_MAX_CONCURRENT: Joi.number().default(5),

  AI_COMPLEXITY_THRESHOLD: Joi.number().default(10),
  AI_RETRY_DELAY_MINUTES: Joi.number().default(5),
  AI_ALERT_THRESHOLD_MINUTES: Joi.number().default(15),
  AI_PRIMARY_PROVIDER: Joi.string()
    .valid('CLAUDE_CODE', 'GEMINI', 'CODEX', 'KIMI')
    .optional()
    .allow('')
    .description('Force routing all tickets to this provider, bypassing complexity scoring'),

  // Story 11.2: AI Decision Audit Configuration
  AI_CONFIDENCE_THRESHOLD: Joi.number()
    .min(0)
    .max(1)
    .default(0.5)
    .description('Alert threshold for low-confidence AI decisions (0-1 range)'),

  // Story 13.2: AI Cost Optimization Configuration
  AI_COST_OPTIMIZATION_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable AI cost optimization (select cheaper models for simple tasks)'),
  AI_CACHE_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86400)
    .default(3600)
    .description('AI response cache TTL in seconds (default: 1 hour)'),

  // Story 8.2: AI Code Review Interface
  AI_REVIEW_RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).max(60).default(10),
  AI_REVIEW_MAX_DIFF_LINES: Joi.number().integer().min(100).max(5000).default(1000),

  // GitHub Integration (REQUIRED)
  GITHUB_TOKEN: Joi.string()
    .pattern(/^(ghp_|ghs_|github_pat_)/)
    .required()
    .messages({
      'any.required': 'GITHUB_TOKEN is required for GitHub integration',
      'string.pattern.base':
        'GITHUB_TOKEN must be a valid GitHub token (starts with ghp_, ghs_, or github_pat_)',
    }),

  // GitHub Webhooks (optional - endpoint will reject signatures if not configured)
  GITHUB_WEBHOOK_SECRET: Joi.string().min(16).optional().messages({
    'string.min': 'GITHUB_WEBHOOK_SECRET must be at least 16 characters',
  }),
  GITHUB_AUTO_MERGE_LOW_RISK: Joi.boolean().default(false),
  GITHUB_REMINDERS_ENABLED: Joi.boolean().default(true),

  // GitHub App (optional, alternative to token)
  GITHUB_APP_ID: Joi.number().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: Joi.string().optional(),

  // GitHub Repository Mapping (Story 4.9) - Temporary fallback
  GITHUB_DEFAULT_REPOSITORY: Joi.string()
    .uri({ scheme: ['http', 'https', 'git'] })
    .required()
    .messages({
      'any.required':
        'GITHUB_DEFAULT_REPOSITORY is required until Story 4.9 implements Projects table. Example: https://github.com/your-org/your-repo',
      'string.uri': 'GITHUB_DEFAULT_REPOSITORY must be a valid repository URL',
    }),

  // ClickUp Integration (Legacy — CLICKUP_API_KEY removed CS1-7; OAuth via ProjectIntegration CS0-5)
  // OAuth client ID/secret/redirect remain for ClickUp OAuth app flow:
  CLICKUP_CLIENT_ID: Joi.string().optional().allow(''),
  CLICKUP_CLIENT_SECRET: Joi.string().optional().allow(''),
  CLICKUP_REDIRECT_URI: Joi.string().uri().optional().allow(''),

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

  // Story 2.6: Reserved for future provider configuration

  // Story 2.7: Anthropic API Configuration (optional - provider disabled if not set)
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),
  ANTHROPIC_COMMIT_MESSAGE_MODEL: Joi.string()
    .default('claude-3-haiku-20240307')
    .description('Model for commit message generation (default: Haiku 3.5)'),
  ANTHROPIC_MAX_TOKENS: Joi.number().min(1000).max(100000).default(8000),
  ANTHROPIC_TIMEOUT_MS: Joi.number().min(30000).max(3000000).default(120000),
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

  // Story 3.3: Coverage Configuration
  QA_COVERAGE_THRESHOLD: Joi.number().min(0).max(100).default(80),
  QA_COVERAGE_ENFORCEMENT: Joi.string().valid('true', 'false').default('true'),
  QA_BASE_BRANCH: Joi.string().default('main'),
  QA_GENERATE_HTML_REPORT: Joi.string().valid('true', 'false').default('true'),

  // Story 3.4: Security Scanning Configuration (optional - has sensible defaults)
  // FR68: Security vulnerability scanning, secrets detection, code complexity, OWASP patterns
  SECURITY_BLOCK_ON_CRITICAL: Joi.string().valid('true', 'false').default('true'),
  SECURITY_BLOCK_ON_HIGH: Joi.string().valid('true', 'false').default('true'),
  SECURITY_MAX_COMPLEXITY: Joi.number().integer().min(10).max(50).default(20),
  SECURITY_MAX_FUNCTION_LENGTH: Joi.number().integer().min(50).max(500).default(100),
  SECURITY_SCAN_TIMEOUT_MS: Joi.number().integer().min(60000).max(600000).default(180000), // 1-10 min
  SECURITY_DEP_SCAN_TIMEOUT_MS: Joi.number().integer().min(30000).max(300000).default(60000), // 30s-5min
  SECURITY_SECRETS_SCAN_TIMEOUT_MS: Joi.number().integer().min(10000).max(120000).default(30000), // 10s-2min
  SECURITY_COMPLEXITY_SCAN_TIMEOUT_MS: Joi.number().integer().min(30000).max(300000).default(60000),
  SECURITY_PATTERN_SCAN_TIMEOUT_MS: Joi.number().integer().min(10000).max(120000).default(30000),

  // Story 3.5: Quality Gate Configuration (optional - has sensible defaults)
  // FR70: System blocks deployment if quality gates fail
  QG_MIN_TEST_PASS_RATE: Joi.number().integer().min(0).max(100).default(100),
  QG_MIN_COVERAGE: Joi.number().integer().min(0).max(100).default(80),
  QG_TARGET_COVERAGE: Joi.number().integer().min(0).max(100).default(90),
  QG_MAX_LINTING_ERRORS: Joi.number().integer().min(0).default(0),
  QG_MAX_LINTING_WARNINGS: Joi.number().integer().min(0).default(10),
  QG_BLOCK_CRITICAL: Joi.string().valid('true', 'false').default('true'),
  QG_BLOCK_HIGH: Joi.string().valid('true', 'false').default('true'),
  QG_MAX_COMPLEXITY: Joi.number().integer().min(5).max(50).default(20),
  QG_ALLOW_OVERRIDE: Joi.string().valid('true', 'false').default('false'),
  // Per-category timeouts
  QG_LINTING_TIMEOUT_MS: Joi.number().integer().min(10000).max(300000).default(60000), // 10s-5min
  QG_TESTING_TIMEOUT_MS: Joi.number().integer().min(30000).max(900000).default(300000), // 30s-15min
  QG_COVERAGE_TIMEOUT_MS: Joi.number().integer().min(10000).max(300000).default(60000), // 10s-5min
  QG_SECURITY_TIMEOUT_MS: Joi.number().integer().min(60000).max(600000).default(180000), // 1-10min

  // Story 13.4: Self-Healing Configuration
  SELF_HEALING_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable AI self-healing for QA failures'),

  // Story 14.4: Post-Deployment Health Monitoring Configuration
  HEALTH_MONITORING_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable post-deployment health monitoring with auto-rollback'),
  HEALTH_MONITORING_WINDOW_MS: Joi.number()
    .integer()
    .min(60000)
    .max(600000)
    .default(300000)
    .description('Health monitoring window duration (1-10 min)'),
  HEALTH_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(10000)
    .max(120000)
    .default(30000)
    .description('Health polling interval (10s-2min)'),
  HEALTH_ERROR_RATE_THRESHOLD: Joi.number()
    .integer()
    .min(0)
    .max(200)
    .default(50)
    .description('Error rate increase threshold in percentage'),
  HEALTH_LATENCY_THRESHOLD_MS: Joi.number()
    .integer()
    .min(0)
    .max(10000)
    .default(200)
    .description('Latency increase threshold in milliseconds'),
  HEALTH_BASELINE_WINDOW_MS: Joi.number()
    .integer()
    .min(60000)
    .max(600000)
    .default(300000)
    .description('Baseline capture window duration (1-10 min)'),

  // Story 22.3: Sandbox Workspace Configuration
  SANDBOX_WORKSPACES_ROOT: Joi.string()
    .default(path.join(process.cwd(), 'workspaces'))
    .description('Root directory for sandbox workspaces'),
  SANDBOX_LOGS_ROOT: Joi.string()
    .default('/tmp/dsf-agent-logs')
    .description('Root directory for sandbox container logs'),

  // Story 22.4: Container Execution Log Streaming Configuration
  ENABLE_CONTAINER_EXECUTION: Joi.boolean()
    .default(false)
    .description('Feature flag to enable container execution mode'),
  DOCKER_CONTAINER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(60000)
    .max(7200000)
    .default(3000000)
    .description('Max container execution time in milliseconds (default: 50min, max: 2hr)'),
  LOG_STREAM_THROTTLE_MS: Joi.number()
    .integer()
    .min(50)
    .max(1000)
    .default(100)
    .description('Throttle interval for WebSocket log emits in milliseconds'),

  // Story 23.1: Local Git Mirror Service Configuration
  GIT_MIRROR_BASE_PATH: Joi.string()
    .default('/tmp/dsf/git-mirrors')
    .description('Root directory for all git mirrors'),
  GIT_MIRROR_TTL_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(168)
    .default(24)
    .description('Hours before mirror considered stale (default: 24h)'),
  GIT_MIRROR_MAX_SIZE_GB: Joi.number()
    .integer()
    .min(1)
    .max(500)
    .default(50)
    .description('Max total size for all mirrors in GB (default: 50GB)'),
  GIT_MIRROR_MIN_FREE_SPACE_GB: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
    .description('Min free space before triggering eviction in GB (default: 10GB)'),
  GIT_MIRROR_CLEANUP_INTERVAL_MS: Joi.number()
    .integer()
    .min(60000)
    .max(86400000)
    .default(3600000)
    .description('Cleanup job interval in milliseconds (default: 1 hour)'),
  ENABLE_GIT_MIRRORING: Joi.boolean()
    .default(true)
    .description('Feature flag to enable git mirroring (default: true)'),

  // Story 23.2: Automated Container Cleanup Configuration
  ENABLE_AUTO_CLEANUP: Joi.boolean()
    .default(true)
    .description('Master switch for automatic container and workspace cleanup'),
  CLEANUP_DEBUG_MODE_DEFAULT: Joi.boolean()
    .default(false)
    .description('Global default for debug mode (preserves workspaces)'),
  CLEANUP_TIMEOUT_MS: Joi.number()
    .integer()
    .min(5000)
    .max(120000)
    .default(30000)
    .description('Max time allowed for cleanup operation (default: 30s)'),
  CLEANUP_RETRY_ATTEMPTS: Joi.number()
    .integer()
    .min(0)
    .max(5)
    .default(3)
    .description('Number of retry attempts for failed cleanups'),
  CLEANUP_SCHEDULE_CRON: Joi.string()
    .default('0 */5 * * * *')
    .description('Background cleanup frequency (default: every 5 minutes)'),

  // Story 23.3: Resource Limit Enforcement Configuration
  // Note: SANDBOX_ENABLE_RESOURCE_LIMITS and SANDBOX_MEMORY_SWAP_LIMIT_MB removed — unused.
  // These will be fully replaced by OPENSANDBOX_DEFAULT_MEMORY_LIMIT in Epic OS.
  SANDBOX_MEMORY_LIMIT_MB: Joi.number()
    .integer()
    .min(64)
    .max(8192)
    .default(512)
    .description('Memory limit per container in MB (default: 512MB)'),
  SANDBOX_CPU_LIMIT_PERCENT: Joi.number()
    .integer()
    .min(10)
    .max(400)
    .default(100)
    .description('CPU limit as percentage of single core (default: 100% = 1 core)'),

  // Story 5.5: Client Communication Intelligence
  // OpenAI API for Whisper transcription and GPT-4 analysis
  CONVERSATIONS_STORAGE_PATH: Joi.string()
    .default('./storage/conversations')
    .description('Storage path for conversation audio files'),
  MAX_AUDIO_FILE_SIZE_MB: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(25)
    .description('Maximum audio file size in MB (Whisper API limit)'),
  AUDIO_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(90)
    .description('Audio file retention period in days'),

  // Story 5.5.1: AetherFlow ClickUp Integration
  AETHERFLOW_API_URL: Joi.string()
    .uri()
    .optional()
    .allow('')
    .messages({
      'any.required':
        'AETHERFLOW_API_URL is required for ClickUp integration via AetherFlow (Story 5.5.1)',
    })
    .description('AetherFlow API base URL'),
  AETHERFLOW_API_KEY: Joi.string()
    .min(32)
    .optional()
    .allow('')
    .messages({
      'any.required': 'AETHERFLOW_API_KEY is required for AetherFlow authentication',
      'string.min': 'AETHERFLOW_API_KEY must be at least 32 characters for security',
    })
    .description('Shared API key for DSF->AetherFlow authentication'),
  AETHERFLOW_DEFAULT_CLICKUP_LIST: Joi.string()
    .optional()
    .description('Default ClickUp list name for conversation-derived tickets'),

  // Story 17.1: User Invitation System
  FRONTEND_URL: Joi.string().uri().required().messages({
    'any.required': 'FRONTEND_URL is required for invitation links',
  }),
  DSF_PUBLIC_URL: Joi.string().uri().optional(),

  // Email Configuration (SMTP)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  SMTP_FROM: Joi.string().email().required().messages({
    'any.required': 'SMTP_FROM is required. Example: noreply@dsf.com',
  }),

  // Epic OS-1: OpenSandbox server connection
  OPENSANDBOX_DOMAIN: Joi.string()
    .default('localhost:8080')
    .description('OpenSandbox server address (host:port, no scheme)'),
  OPENSANDBOX_API_KEY: Joi.string()
    .allow('')
    .default('')
    .description('API key for OpenSandbox server authentication (required in production)'),
  OPENSANDBOX_PROTOCOL: Joi.string()
    .valid('http', 'https')
    .default('http')
    .description('Protocol for OpenSandbox server communication'),
  OPENSANDBOX_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(60000)
    .description('HTTP request timeout for sandbox management calls (ms)'),
  OPENSANDBOX_AGENT_IMAGE: Joi.string()
    .default('opensandbox/code-interpreter:v1.0.2')
    .description('Docker image for sandbox executions'),
  OPENSANDBOX_SANDBOX_TIMEOUT_S: Joi.number()
    .integer()
    .min(60)
    .max(7200)
    .default(3600)
    .description('Maximum sandbox lifetime in seconds (default: 1 hour)'),
  OPENSANDBOX_MAX_CONCURRENT: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(10)
    .description('Maximum number of sandboxes running simultaneously'),
  OPENSANDBOX_DEFAULT_CPU_LIMIT: Joi.string()
    .default('1')
    .description(
      'Default CPU limit for medium resource profile (Kubernetes-style: "0.5", "1", "2")',
    ),
  OPENSANDBOX_DEFAULT_MEMORY_LIMIT: Joi.string()
    .default('512Mi')
    .description('Default memory limit for medium resource profile (e.g., "512Mi", "1Gi")'),
  OPENSANDBOX_SECURE_RUNTIME: Joi.string()
    .allow('')
    .valid('', 'gvisor', 'kata-qemu', 'firecracker')
    .default('')
    .description(
      'Secure container runtime ("" = standard Docker, "gvisor", "kata-qemu", "firecracker")',
    ),
  OPENSANDBOX_NETWORK_DEFAULT_ACTION: Joi.string()
    .valid('ALLOW', 'DENY')
    .default('ALLOW')
    .description('Default egress policy for sandboxes'),
});
