/**
 * Type-safe configuration object
 * Loaded from environment variables with validation
 */
import * as os from 'os';
import * as path from 'path';

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
    },

    // GitHub Integration
    github: {
      token: process.env.GITHUB_TOKEN,
      defaultRepository: process.env.GITHUB_DEFAULT_REPOSITORY,
      appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID, 10) : undefined,
      appSlug: process.env.GITHUB_APP_SLUG,
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
      autoMergeLowRisk: process.env.GITHUB_AUTO_MERGE_LOW_RISK === 'true',
      remindersEnabled: process.env.GITHUB_REMINDERS_ENABLED !== 'false',
      // Global default for the PR-open approval gate. When true (default), an
      // execution's branch is pushed to GitHub on success but the PR is only
      // opened after PM approval. When false, the PR is opened immediately after
      // the push. Overridable per-project via Project.require_pr_approval (the
      // project value wins when non-null). Consumed by the code-delivery
      // listener (push → conditional PR) and the approval gate (approve → PR).
      requireApprovalForPr: process.env.GITHUB_REQUIRE_PR_APPROVAL !== 'false',
    },

    // ClickUp Integration
    clickup: {
      // CLICKUP_API_KEY removed in CS1-7 — auth via ProjectIntegration.access_token (CS0-5)
      clientId: process.env.CLICKUP_CLIENT_ID || '',
      clientSecret: process.env.CLICKUP_CLIENT_SECRET || '',
      redirectUri: process.env.CLICKUP_REDIRECT_URI || '',
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
      publicUrl: process.env.DSF_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
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

    // Story 20.1: Webhook Configuration
    webhooks: {
      // Deduplication settings
      dedupTtlMs: parseInt(process.env.WEBHOOK_DEDUP_TTL_MS || '300000', 10), // 5 minutes
      // Retry and DLQ settings
      maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
      retryDelayMs: parseInt(process.env.WEBHOOK_RETRY_DELAY_MS || '1000', 10),
      // Feature flags
      useRedisDeduplication: process.env.WEBHOOK_USE_REDIS_DEDUP !== 'false', // Default true
    },

    // Feature Flags
    features: {
      costTracking: process.env.FEATURE_COST_TRACKING === 'true',
      qualityGates: process.env.FEATURE_QUALITY_GATES === 'true',
      // When true, automatically approves executions after QA passes,
      // skipping the AWAITING_APPROVAL manual gate. This ensures the workspace
      // is still alive when the GitHub push is triggered. Useful when PM review
      // is not needed or when QA checks are temporarily disabled.
      autoApproveAfterQa: process.env.FEATURE_AUTO_APPROVE_AFTER_QA === 'true',
    },

    // Story 2.6: Reserved for future provider configuration

    openharness: {
      binaryPath: process.env.OPENHARNESS_BINARY_PATH || 'oh',
      model: process.env.OPENHARNESS_MODEL || 'gpt-5.4',
      // Agent runtime that executes a leg. 'oh' (default) drives the OpenHarness
      // CLI; 'claude' drives the first-party Claude Code CLI via
      // scripts/claude-run-skill.sh. The 'claude' runtime exists because `oh`,
      // as a third-party app, cannot draw a Claude subscription from plan limits
      // (Anthropic routes third-party apps to extra usage), whereas Claude Code
      // is first-party. See docs/openharness/runs/ohp-2.6-*.report.md.
      runtime: process.env.OPENHARNESS_RUNTIME || 'oh',
      // Model used only when runtime === 'claude' (an alias like 'sonnet'/'opus'
      // or a full model id). Independent of `model`, which targets the oh CLI.
      claudeModel: process.env.OPENHARNESS_CLAUDE_MODEL || 'sonnet',
      // Root under which each Claude AiAccount's Claude-Code config dir lives
      // (one dir per account id). The runner injects CLAUDE_CONFIG_DIR=<root>/<id>
      // so the selected account's own logged-in subscription session drives the
      // run — the only headless way to switch between Claude accounts (the CLI
      // has no email/password login). Each dir must be logged in once out of band.
      claudeAccountsDir:
        process.env.OPENHARNESS_CLAUDE_ACCOUNTS_DIR ||
        path.join(os.homedir(), '.dsf', 'claude-accounts'),
      // When true, each run executes in an isolated git worktree (clean checkout
      // at the repo HEAD) instead of `workspaceDir` directly, so agents never
      // mutate the live working tree and concurrent runs cannot collide
      // (OHP-2.6 safety finding). The worktree is removed on every terminal path.
      isolateWorkspace: process.env.OPENHARNESS_ISOLATE_WORKSPACE === 'true',
      defaultSkill: process.env.OPENHARNESS_DEFAULT_SKILL || 'clickup-dev-implement',
      workspaceDir: process.env.OPENHARNESS_WORKSPACE_DIR || process.cwd(),
      // Root under which per-project repo clones are kept (one clone per project,
      // reused across runs). Each ticket's run executes in — and pushes from — a
      // clone of its own project repo, not the DSF backend repo. Defaults to a
      // tmp dir; set to a persistent path in production to avoid re-cloning.
      projectWorkspacesRoot: process.env.OPENHARNESS_PROJECT_WORKSPACES_ROOT || undefined,
      maxTurns: parseInt(process.env.OPENHARNESS_MAX_TURNS || '200', 10),
      runTimeoutMs: parseInt(process.env.OPENHARNESS_RUN_TIMEOUT_MS || '1800000', 10),
      mandatedMcpServers: (process.env.OPENHARNESS_MANDATED_MCP_SERVERS || 'gitnexus')
        .split(',')
        .map((server) => server.trim())
        .filter(Boolean),
      mandatedToolsMode: process.env.OPENHARNESS_MANDATED_TOOLS_MODE === 'fail' ? 'fail' : 'warn',
      formatEnabled: process.env.OPENHARNESS_FORMAT_ENABLED !== 'false',
      formatCommand: process.env.OPENHARNESS_FORMAT_COMMAND || 'pnpm exec prettier --write',
      mcpConfigPath:
        process.env.OPENHARNESS_MCP_CONFIG_PATH ||
        process.env.MCP_CONFIG_PATH ||
        './openharness/mcp-config.json',
    },

    // Claude subscription completion (QA F8: replaces the removed direct,
    // pay-per-token Anthropic API path). All one-shot AI calls (PM field
    // auto-fill, PR title/body, file-conflict prediction) go through the
    // first-party `claude` CLI on the subscription via
    // SubscriptionCompletionService — zero marginal cost, consistent with the
    // agent execution runtime. ANTHROPIC_API_KEY is intentionally not read.
    anthropic: {
      // Model alias/id for subscription completions (flat-rate; model choice
      // does not affect cost). Falls back to the agent-runtime Claude model.
      subscriptionModel:
        process.env.ANTHROPIC_SUBSCRIPTION_MODEL ||
        process.env.OPENHARNESS_CLAUDE_MODEL ||
        'sonnet',
      // Path to the first-party Claude Code CLI.
      subscriptionCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
      // Hard timeout (ms) for a single one-shot completion.
      subscriptionTimeoutMs: parseInt(process.env.ANTHROPIC_SUBSCRIPTION_TIMEOUT_MS || '30000', 10),
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
