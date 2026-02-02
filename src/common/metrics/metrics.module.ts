import { Module, Global } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrometheusMetricsController } from './prometheus-metrics.controller';
import { HttpCollector, BusinessCollector, SystemCollector, QueueCollector } from './collectors';
import {
  HTTP_METRICS,
  WEBHOOK_METRICS,
  TICKET_METRICS,
  AI_METRICS,
  QA_METRICS,
  DEPLOYMENT_METRICS,
  COST_METRICS,
  PM_METRICS,
  SYSTEM_METRICS,
  QUEUE_METRICS,
  DATABASE_METRICS,
  WEBSOCKET_METRICS,
  ERROR_METRICS,
  CICD_METRICS,
  GITHUB_METRICS,
  UX_METRICS,
  AETHERFLOW_METRICS,
  CONTAINER_METRICS,
  METRICS_CONSTANTS,
  LABELS,
} from './metrics.constants';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      controller: PrometheusMetricsController,
      defaultMetrics: {
        enabled: true,
        config: { prefix: METRICS_CONSTANTS.PREFIX },
      },
      defaultLabels: {
        app: 'ai-dev-orchestrator',
        environment: process.env.NODE_ENV || 'development',
      },
    }),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    HttpCollector,
    BusinessCollector,
    SystemCollector,
    QueueCollector,

    // HTTP Metrics
    makeHistogramProvider({
      name: HTTP_METRICS.REQUEST_DURATION,
      help: 'Duration of HTTP requests in seconds',
      labelNames: [LABELS.METHOD, LABELS.PATH, LABELS.STATUS_CODE],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeCounterProvider({
      name: HTTP_METRICS.REQUEST_TOTAL,
      help: 'Total number of HTTP requests',
      labelNames: [LABELS.METHOD, LABELS.PATH, LABELS.STATUS_CODE],
    }),

    // Webhook Metrics (Story 2.1 - NFR-O5)
    makeCounterProvider({
      name: WEBHOOK_METRICS.RECEIVED_TOTAL,
      help: 'Total number of webhooks received',
      labelNames: ['event_type'],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.PROCESSED_TOTAL,
      help: 'Total number of webhooks successfully processed',
      labelNames: ['event_type', LABELS.STATUS],
    }),
    makeHistogramProvider({
      name: WEBHOOK_METRICS.PROCESSING_DURATION,
      help: 'Webhook processing duration in seconds',
      labelNames: ['event_type'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.ERRORS_TOTAL,
      help: 'Total number of webhook processing errors',
      labelNames: ['event_type', LABELS.ERROR_TYPE],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.DUPLICATES_TOTAL,
      help: 'Total number of duplicate webhooks detected',
      labelNames: ['event_type'],
    }),

    // Ticket Metrics
    makeCounterProvider({
      name: TICKET_METRICS.RECEIVED_TOTAL,
      help: 'Total number of tickets received from ClickUp',
      labelNames: [LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: TICKET_METRICS.PROCESSED_TOTAL,
      help: 'Total number of tickets processed',
      labelNames: [LABELS.PROJECT, LABELS.STATUS],
    }),
    makeGaugeProvider({
      name: TICKET_METRICS.QUEUE_SIZE,
      help: 'Current number of tickets in processing queue',
    }),

    // AI Execution Metrics
    makeCounterProvider({
      name: AI_METRICS.EXECUTIONS_TOTAL,
      help: 'Total number of AI executions',
      labelNames: [LABELS.PROVIDER, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: AI_METRICS.EXECUTION_DURATION,
      help: 'Duration of AI executions in seconds',
      labelNames: [LABELS.PROVIDER, LABELS.STATUS, LABELS.PROJECT],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600], // Up to 10 minutes
    }),
    makeCounterProvider({
      name: AI_METRICS.TOKENS_INPUT_TOTAL,
      help: 'Total input tokens used by AI providers',
      labelNames: [LABELS.PROVIDER, 'model', 'agent_name', 'operation_type', LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: AI_METRICS.TOKENS_OUTPUT_TOTAL,
      help: 'Total output tokens used by AI providers',
      labelNames: [LABELS.PROVIDER, 'model', 'agent_name', 'operation_type', LABELS.PROJECT],
    }),
    makeGaugeProvider({
      name: AI_METRICS.PROVIDER_STATUS,
      help: 'AI provider health status (1=healthy, 0=unhealthy)',
      labelNames: [LABELS.PROVIDER],
    }),

    // QA Metrics
    makeCounterProvider({
      name: QA_METRICS.CHECKS_TOTAL,
      help: 'Total number of QA checks performed',
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT, LABELS.PROVIDER],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'Duration of QA checks in seconds',
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT, LABELS.PROVIDER],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
    }),
    makeGaugeProvider({
      name: QA_METRICS.COVERAGE_PERCENT,
      help: 'Test coverage percentage per project',
      labelNames: [LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: QA_METRICS.VULNERABILITIES,
      help: 'Total security vulnerabilities detected',
      labelNames: [LABELS.SEVERITY, LABELS.PROJECT],
    }),

    // Deployment Metrics
    makeCounterProvider({
      name: DEPLOYMENT_METRICS.TOTAL,
      help: 'Total number of deployments',
      labelNames: [LABELS.ENVIRONMENT, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: DEPLOYMENT_METRICS.DURATION,
      help: 'Duration of deployments in seconds',
      labelNames: [LABELS.ENVIRONMENT, LABELS.STATUS, LABELS.PROJECT],
      buckets: [10, 30, 60, 120, 300, 600], // Up to 10 minutes
    }),
    makeGaugeProvider({
      name: DEPLOYMENT_METRICS.SUCCESS_RATE,
      help: 'Deployment success rate per environment',
      labelNames: [LABELS.ENVIRONMENT, 'time_window'],
    }),
    makeGaugeProvider({
      name: DEPLOYMENT_METRICS.IN_PROGRESS,
      help: 'Current deployments in progress',
      labelNames: [LABELS.ENVIRONMENT],
    }),
    // Story 4.7: Rollback Metrics
    makeCounterProvider({
      name: DEPLOYMENT_METRICS.ROLLBACKS_TOTAL,
      help: 'Total deployment rollbacks',
      labelNames: [LABELS.ENVIRONMENT, LABELS.STATUS],
    }),

    // Cost Metrics
    makeHistogramProvider({
      name: COST_METRICS.PER_PROJECT,
      help: 'Cost per project in USD',
      labelNames: [LABELS.PROJECT, LABELS.PROVIDER, 'model', 'agent_name', 'operation_type'],
      buckets: METRICS_CONSTANTS.COST_BUCKETS,
    }),
    makeCounterProvider({
      name: COST_METRICS.TOTAL,
      help: 'Total cost in USD',
      labelNames: [LABELS.PROVIDER, 'model', 'agent_name', 'operation_type'],
    }),
    makeGaugeProvider({
      name: COST_METRICS.BUDGET_UTILIZATION,
      help: 'Budget utilization percentage per project',
      labelNames: [LABELS.PROJECT],
    }),

    // PM Metrics
    makeGaugeProvider({
      name: PM_METRICS.UTILIZATION_PERCENT,
      help: 'PM utilization percentage',
      labelNames: [LABELS.PM_ID],
    }),
    makeGaugeProvider({
      name: PM_METRICS.TICKETS_MANAGED,
      help: 'Number of tickets managed by PM',
      labelNames: [LABELS.PM_ID],
    }),
    makeGaugeProvider({
      name: PM_METRICS.PROJECTS_ACTIVE,
      help: 'Number of active projects per PM',
      labelNames: [LABELS.PM_ID],
    }),
    makeCounterProvider({
      name: UX_METRICS.KEYBOARD_SHORTCUT_USAGE,
      help: 'Total keyboard shortcut usage',
      labelNames: [LABELS.SHORTCUT],
    }),

    // System Metrics
    makeGaugeProvider({
      name: SYSTEM_METRICS.MEMORY_USAGE,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.CPU_USAGE,
      help: 'CPU usage in seconds',
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.ACTIVE_CONNECTIONS,
      help: 'Number of active connections',
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.UPTIME,
      help: 'Application uptime in seconds',
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.EVENT_LOOP_LAG,
      help: 'Event loop lag in seconds',
    }),

    // Queue Metrics (FR101)
    makeGaugeProvider({
      name: QUEUE_METRICS.DEPTH,
      help: 'Current queue depth',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.PROCESSING_RATE,
      help: 'Queue processing rate (messages per minute)',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.OLDEST_MESSAGE_AGE,
      help: 'Age of oldest message in queue (seconds)',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.DEAD_LETTER_COUNT,
      help: 'Number of messages in dead letter queue',
      labelNames: [LABELS.QUEUE],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.CONSUMER_COUNT,
      help: 'Number of active consumers',
      labelNames: [LABELS.QUEUE],
    }),

    // Database Metrics
    makeGaugeProvider({
      name: DATABASE_METRICS.CONNECTIONS,
      help: 'Database connection count by state',
      labelNames: [LABELS.CONNECTION_STATE],
    }),
    makeHistogramProvider({
      name: DATABASE_METRICS.QUERY_DURATION,
      help: 'Database query duration in seconds',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    }),
    makeGaugeProvider({
      name: DATABASE_METRICS.POOL_SIZE,
      help: 'Database connection pool size',
    }),

    // WebSocket Metrics
    makeGaugeProvider({
      name: WEBSOCKET_METRICS.CONNECTIONS_ACTIVE,
      help: 'Number of active WebSocket connections',
    }),
    makeCounterProvider({
      name: WEBSOCKET_METRICS.MESSAGES_TOTAL,
      help: 'Total WebSocket messages',
      labelNames: [LABELS.DIRECTION],
    }),
    makeGaugeProvider({
      name: WEBSOCKET_METRICS.ROOMS_ACTIVE,
      help: 'Number of active WebSocket rooms',
    }),

    // Error Metrics
    makeCounterProvider({
      name: ERROR_METRICS.TOTAL,
      help: 'Total errors by type',
      labelNames: [LABELS.ERROR_TYPE],
    }),
    makeCounterProvider({
      name: ERROR_METRICS.UNHANDLED_EXCEPTIONS,
      help: 'Total unhandled exceptions',
    }),

    // CI/CD Metrics
    makeCounterProvider({
      name: CICD_METRICS.PIPELINE_TRIGGERS,
      help: 'Total CI/CD pipeline triggers',
      labelNames: [LABELS.PROVIDER, LABELS.STATUS],
    }),
    makeHistogramProvider({
      name: CICD_METRICS.PIPELINE_DURATION,
      help: 'CI/CD pipeline duration in seconds',
      labelNames: [LABELS.PROVIDER],
      buckets: [10, 30, 60, 120, 300, 600, 1800], // Up to 30 minutes
    }),
    makeHistogramProvider({
      name: CICD_METRICS.WORKFLOW_POLL_DURATION,
      help: 'Time spent polling deployment status',
      labelNames: [LABELS.ENVIRONMENT],
      buckets: [5, 10, 30, 60, 120, 300],
    }),

    // GitHub Metrics (Story 4.1, 4.3)
    makeCounterProvider({
      name: GITHUB_METRICS.OPERATIONS_TOTAL,
      help: 'Total GitHub operations',
      labelNames: ['operation', 'status'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.RATE_LIMIT_HITS,
      help: 'Total GitHub rate limit hits',
    }),
    makeGaugeProvider({
      name: GITHUB_METRICS.RATE_LIMIT_REMAINING,
      help: 'GitHub rate limit remaining',
    }),
    // Story 4.3: Commit-specific metrics
    makeCounterProvider({
      name: GITHUB_METRICS.COMMITS_CREATED_TOTAL,
      help: 'Total GitHub commits created',
      labelNames: ['status', 'repository', 'ai_provider'],
    }),
    makeHistogramProvider({
      name: GITHUB_METRICS.COMMIT_DURATION_SECONDS,
      help: 'GitHub commit operation duration',
      labelNames: ['repository', 'operation'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.PUSH_SUCCESS_TOTAL,
      help: 'Total successful GitHub pushes',
      labelNames: ['repository', 'branch_type'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.FILES_PUSHED_TOTAL,
      help: 'Total files pushed to GitHub',
      labelNames: ['repository', 'file_type'],
    }),
    makeHistogramProvider({
      name: GITHUB_METRICS.COMMIT_SIZE_BYTES,
      help: 'GitHub commit size in bytes',
      labelNames: ['repository'],
      buckets: [1024, 10240, 102400, 1024000, 10240000, 102400000], // 1KB to 100MB
    }),

    // Story 4.8: New GitHub Metrics
    makeCounterProvider({
      name: GITHUB_METRICS.PUSH_TOTAL,
      help: 'Total GitHub push operations',
      labelNames: ['status', LABELS.ERROR_TYPE, 'repository'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.PR_CREATED_TOTAL,
      help: 'Total PR creation attempts',
      labelNames: ['status', 'repository'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.BRANCH_TOTAL,
      help: 'Total branch creation operations',
      labelNames: ['status', 'repository'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.COMMIT_TOTAL,
      help: 'Total commit generation and push operations',
      labelNames: ['status', 'repository'],
    }),
    makeCounterProvider({
      name: GITHUB_METRICS.API_CALLS_TOTAL,
      help: 'Total GitHub API calls',
      labelNames: ['operation', 'status', 'account_type'],
    }),
    makeHistogramProvider({
      name: GITHUB_METRICS.PUSH_DURATION,
      help: 'Time to push commits to GitHub',
      labelNames: ['repository', 'file_count_bucket'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
    }),
    makeHistogramProvider({
      name: GITHUB_METRICS.API_CALL_DURATION,
      help: 'GitHub API call latency',
      labelNames: ['operation', 'account_type'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    }),
    makeHistogramProvider({
      name: GITHUB_METRICS.PR_CREATION_DURATION,
      help: 'Time to create PR via API',
      labelNames: ['repository'],
      buckets: [0.5, 1, 2, 5, 10],
    }),
    // Story 4.7: GitHub Error Metrics
    makeCounterProvider({
      name: GITHUB_METRICS.ERRORS_TOTAL,
      help: 'Total GitHub operation errors',
      labelNames: ['operation', 'error_type'],
    }),

    // AetherFlow Integration Metrics (Story 5.5.1.1)
    makeCounterProvider({
      name: AETHERFLOW_METRICS.API_CALLS_TOTAL,
      help: 'Total AetherFlow API calls',
      labelNames: [LABELS.PATH, LABELS.STATUS],
    }),
    makeHistogramProvider({
      name: AETHERFLOW_METRICS.API_DURATION,
      help: 'AetherFlow API call duration in seconds',
      labelNames: [LABELS.PATH],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    }),
    makeCounterProvider({
      name: AETHERFLOW_METRICS.TICKETS_CREATED_TOTAL,
      help: 'Total tickets created from conversations via AetherFlow',
    }),
    makeCounterProvider({
      name: AETHERFLOW_METRICS.TICKET_CREATION_FAILURES_TOTAL,
      help: 'Total failures creating tickets from conversations',
      labelNames: [LABELS.ERROR_TYPE],
    }),

    // Story 22.4: Container Execution Log Streaming Metrics
    makeCounterProvider({
      name: CONTAINER_METRICS.LOG_BYTES_TOTAL,
      help: 'Total bytes streamed from containers',
      labelNames: ['execution_id', 'source'],
    }),
    makeHistogramProvider({
      name: CONTAINER_METRICS.EXEC_DURATION_SECONDS,
      help: 'Container execution duration in seconds',
      labelNames: ['execution_id', 'status'],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600],
    }),
    makeCounterProvider({
      name: CONTAINER_METRICS.STREAM_ERRORS_TOTAL,
      help: 'Total container stream errors',
      labelNames: ['execution_id', 'error_type'],
    }),
    makeGaugeProvider({
      name: CONTAINER_METRICS.LOG_SUBSCRIPTIONS_ACTIVE,
      help: 'Active log subscriptions for executions',
      labelNames: ['execution_id'],
    }),
  ],
  exports: [MetricsService],
})
export class AppMetricsModule {}
