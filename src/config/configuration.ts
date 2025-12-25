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

    // AI Providers (Story 2.3: Multi-Provider Strategy)
    ai: {
      providers: {
        cursorHeadless: {
          enabled: process.env.CURSOR_HEADLESS_ENABLED === 'true',
          healthCheckUrl: process.env.CURSOR_HEADLESS_HEALTH_URL || '',
          timeout: parseInt(process.env.CURSOR_HEADLESS_TIMEOUT || '300000', 10), // 5 min
          maxConcurrent: parseInt(process.env.CURSOR_MAX_CONCURRENT || '3', 10),
        },
        claudeCode: {
          enabled: process.env.CLAUDE_CODE_ENABLED === 'true',
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          healthCheckUrl: 'https://api.anthropic.com/v1/messages',
          timeout: parseInt(process.env.CLAUDE_CODE_TIMEOUT || '180000', 10), // 3 min
          maxConcurrent: parseInt(process.env.CLAUDE_MAX_CONCURRENT || '5', 10),
        },
      },
      routing: {
        complexityThreshold: parseInt(process.env.AI_COMPLEXITY_THRESHOLD || '10', 10),
        retryDelayMinutes: parseInt(process.env.AI_RETRY_DELAY_MINUTES || '5', 10),
        alertThresholdMinutes: parseInt(process.env.AI_ALERT_THRESHOLD_MINUTES || '15', 10),
      },
    },

    // GitHub Integration
    github: {
      token: process.env.GITHUB_TOKEN,
      defaultRepository: process.env.GITHUB_DEFAULT_REPOSITORY,
      appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID, 10) : undefined,
      privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
      autoMergeLowRisk: process.env.GITHUB_AUTO_MERGE_LOW_RISK === 'true',
      remindersEnabled: process.env.GITHUB_REMINDERS_ENABLED !== 'false',
    },

    // ClickUp Integration
    clickup: {
      apiKey: process.env.CLICKUP_API_KEY,
      apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
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
      // Story 3.4: Security Scanning Configuration
      blockOnCritical: process.env.SECURITY_BLOCK_ON_CRITICAL !== 'false',
      blockOnHigh: process.env.SECURITY_BLOCK_ON_HIGH !== 'false',
      maxComplexity: parseInt(process.env.SECURITY_MAX_COMPLEXITY || '20', 10),
      maxFunctionLength: parseInt(process.env.SECURITY_MAX_FUNCTION_LENGTH || '100', 10),
      scanTimeoutMs: parseInt(process.env.SECURITY_SCAN_TIMEOUT_MS || '180000', 10),
      dependencyScanTimeoutMs: parseInt(process.env.SECURITY_DEP_SCAN_TIMEOUT_MS || '60000', 10),
      secretsScanTimeoutMs: parseInt(process.env.SECURITY_SECRETS_SCAN_TIMEOUT_MS || '30000', 10),
      complexityScanTimeoutMs: parseInt(
        process.env.SECURITY_COMPLEXITY_SCAN_TIMEOUT_MS || '60000',
        10,
      ),
      patternScanTimeoutMs: parseInt(process.env.SECURITY_PATTERN_SCAN_TIMEOUT_MS || '30000', 10),
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

    // Story 2.6: Cursor CLI Headless Configuration
    cursor: {
      // Cursor docs recommend `cursor-agent` for headless automation:
      // https://cursor.com/docs/cli/headless
      cliPath: process.env.CURSOR_CLI_PATH || 'cursor-agent',
      headlessTimeoutMs: parseInt(process.env.CURSOR_HEADLESS_TIMEOUT_MS || '300000', 10),
      workspacesRoot: process.env.CURSOR_WORKSPACES_ROOT || '/tmp/cursor-workspaces',
      maxConcurrentWorkspaces: parseInt(process.env.CURSOR_MAX_CONCURRENT_WORKSPACES || '10', 10),
      preserveFailedWorkspaces: process.env.CURSOR_PRESERVE_FAILED_WORKSPACES === 'true',
      workspaceCleanupAgeMs: parseInt(
        process.env.CURSOR_WORKSPACE_CLEANUP_AGE_MS || String(7 * 24 * 60 * 60 * 1000),
        10,
      ),
      gitUserName: process.env.CURSOR_GIT_USER_NAME || 'Dark Factory',
      gitUserEmail: process.env.CURSOR_GIT_USER_EMAIL || 'bot@darkfactory.ai',
    },

    // Story 2.7: Anthropic Claude API Configuration
    // Note: Claude provider reuses WorkspaceService from Story 2.6 (shared workspace management)
    // Model: claude-sonnet-4-20250514 is the latest Sonnet model as of implementation
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8000', 10),
      timeoutMs: parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '120000', 10),
      // Reserved for future provider-specific workspace isolation (currently uses shared WorkspaceService)
      workspacesRoot: process.env.CLAUDE_WORKSPACES_ROOT || '/tmp/claude-workspaces',
    },

    // Story 2.8: Orchestrator Configuration
    // Controls multi-provider orchestration and fallback behavior
    orchestrator: {
      // Maximum fallback attempts before giving up
      maxFallbackAttempts: parseInt(process.env.ORCHESTRATOR_MAX_FALLBACK_ATTEMPTS || '2', 10),
      // Delay in milliseconds before attempting fallback
      fallbackDelayMs: parseInt(process.env.ORCHESTRATOR_FALLBACK_DELAY_MS || '1000', 10),
      // Complexity score threshold for HIGH (routes to Cursor)
      complexityThresholdHigh: parseInt(
        process.env.ORCHESTRATOR_COMPLEXITY_THRESHOLD_HIGH || '10',
        10,
      ),
      // Complexity score threshold for MEDIUM
      complexityThresholdMedium: parseInt(
        process.env.ORCHESTRATOR_COMPLEXITY_THRESHOLD_MEDIUM || '5',
        10,
      ),
    },

    // Story 2.9: Retry Configuration
    retry: {
      maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
      baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
      backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
      maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
    },

    // Story 2.11: Quality Scoring Configuration
    // FR4: PM ticket quality visibility before submission
    quality: {
      thresholdExcellent: parseInt(process.env.QUALITY_SCORE_THRESHOLD_EXCELLENT || '90', 10),
      thresholdGood: parseInt(process.env.QUALITY_SCORE_THRESHOLD_GOOD || '70', 10),
      thresholdFair: parseInt(process.env.QUALITY_SCORE_THRESHOLD_FAIR || '50', 10),
      minimumThreshold: parseInt(process.env.QUALITY_MINIMUM_THRESHOLD || '50', 10),
      cacheTtlSeconds: parseInt(process.env.QUALITY_SCORE_CACHE_TTL_SECONDS || '300', 10),
    },

    // Story 2.12: Context Extraction Configuration
    // FR3: PM can attach context documents
    // FR59: System extracts project context
    context: {
      maxFileSizeMb: parseInt(process.env.CONTEXT_MAX_FILE_SIZE_MB || '10', 10),
      cacheTtlHours: parseInt(process.env.CONTEXT_CACHE_TTL_HOURS || '24', 10),
      storagePath: process.env.CONTEXT_STORAGE_PATH || './uploads/context',
      supportedFormats: (process.env.CONTEXT_SUPPORTED_FORMATS || 'pdf,md,txt,docx').split(','),
    },

    // Story 3.2: QA Automation Configuration
    // FR67: Automated test execution
    qa: {
      testTimeoutMs: parseInt(process.env.QA_TEST_TIMEOUT_MS || '300000', 10), // 5 minutes default
      dockerMemoryLimit: process.env.QA_DOCKER_MEMORY || '2g',
      dockerCpuLimit: process.env.QA_DOCKER_CPUS || '2',
      // Story 3.3: Coverage Enforcement
      coverageThreshold: parseInt(process.env.QA_COVERAGE_THRESHOLD || '80', 10),
      coverageEnforcementEnabled: process.env.QA_COVERAGE_ENFORCEMENT !== 'false',
      baseBranch: process.env.QA_BASE_BRANCH || 'main',
      generateHtmlReport: process.env.QA_GENERATE_HTML_REPORT !== 'false',
      // Story 3.7: RabbitMQ QA Queue Processing
      check: {
        concurrency: parseInt(process.env.QA_CHECK_CONCURRENCY || '5', 10),
        maxRetries: parseInt(process.env.QA_CHECK_MAX_RETRIES || '3', 10),
        timeoutMs: parseInt(process.env.QA_CHECK_TIMEOUT_MS || '300000', 10), // 5 minutes
        depthIntervalMs: parseInt(process.env.QA_QUEUE_DEPTH_INTERVAL_MS || '30000', 10), // 30 seconds
      },
    },

    // Story 3.5: Quality Gate Configuration
    // FR70: System blocks deployment if quality gates fail
    qualityGate: {
      minTestPassRate: parseInt(process.env.QG_MIN_TEST_PASS_RATE || '100', 10),
      minCoverage: parseInt(process.env.QG_MIN_COVERAGE || '80', 10),
      targetCoverage: parseInt(process.env.QG_TARGET_COVERAGE || '90', 10),
      maxLintingErrors: parseInt(process.env.QG_MAX_LINTING_ERRORS || '0', 10),
      maxLintingWarnings: parseInt(process.env.QG_MAX_LINTING_WARNINGS || '10', 10),
      blockOnCriticalSecurity: process.env.QG_BLOCK_CRITICAL !== 'false',
      blockOnHighSecurity: process.env.QG_BLOCK_HIGH !== 'false',
      maxComplexity: parseInt(process.env.QG_MAX_COMPLEXITY || '20', 10),
      allowOverride: process.env.QG_ALLOW_OVERRIDE === 'true',
      // Per-category timeouts (ms)
      lintingTimeoutMs: parseInt(process.env.QG_LINTING_TIMEOUT_MS || '60000', 10),
      testingTimeoutMs: parseInt(process.env.QG_TESTING_TIMEOUT_MS || '300000', 10),
      coverageTimeoutMs: parseInt(process.env.QG_COVERAGE_TIMEOUT_MS || '60000', 10),
      securityTimeoutMs: parseInt(process.env.QG_SECURITY_TIMEOUT_MS || '180000', 10),
      // Story 3.6: QA Results pagination
      results: {
        defaultPageSize: parseInt(process.env.QA_RESULTS_DEFAULT_PAGE_SIZE || '20', 10),
        maxPageSize: parseInt(process.env.QA_RESULTS_MAX_PAGE_SIZE || '100', 10),
      },
      // Story 13.4: Self-Healing Configuration
      selfHealing: {
        enabled: process.env.SELF_HEALING_ENABLED !== 'false', // Defaults to true
      },
    },

    // Story 14.3: Storage Manager Configuration
    storage: {
      diskThresholdPercent: parseInt(process.env.STORAGE_DISK_THRESHOLD_PERCENT || '85', 10),
      retentionDays: parseInt(process.env.STORAGE_RETENTION_DAYS || '30', 10),
    },

    // Story 14.4: Post-Deployment Health Monitoring Configuration
    health: {
      enabled: process.env.HEALTH_MONITORING_ENABLED !== 'false',
      monitoringWindowMs: parseInt(process.env.HEALTH_MONITORING_WINDOW_MS || '300000', 10), // 5 min
      pollIntervalMs: parseInt(process.env.HEALTH_POLL_INTERVAL_MS || '30000', 10), // 30s
      errorRateThresholdPercent: parseInt(process.env.HEALTH_ERROR_RATE_THRESHOLD || '50', 10),
      latencyThresholdMs: parseInt(process.env.HEALTH_LATENCY_THRESHOLD_MS || '200', 10),
      baselineWindowMs: parseInt(process.env.HEALTH_BASELINE_WINDOW_MS || '300000', 10), // 5 min
    },

    // Story 14.5: Observability Dashboard Configuration
    observability: {
      rabbitmqManagementUrl: process.env.RABBITMQ_MANAGEMENT_URL || 'http://localhost:15672',
      rabbitmqManagementUser: process.env.RABBITMQ_MANAGEMENT_USER || 'guest',
      rabbitmqManagementPassword: process.env.RABBITMQ_MANAGEMENT_PASSWORD || 'guest',
      prometheusUrl: process.env.PROMETHEUS_URL || 'http://localhost:9090',
    },
  };
};
