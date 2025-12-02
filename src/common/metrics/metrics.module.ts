import { Module, Global } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpCollector, BusinessCollector, SystemCollector, QueueCollector } from './collectors';
import {
  HTTP_METRICS,
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
  METRICS_CONSTANTS,
  LABELS,
} from './metrics.constants';

@Global()
@Module({
  imports: [
    PrometheusModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        path: '/metrics',
        defaultMetrics: {
          enabled: configService.get<boolean>('metrics.collectDefaultMetrics', true),
          config: {
            prefix: METRICS_CONSTANTS.PREFIX,
          },
        },
        defaultLabels: {
          app: 'ai-dev-orchestrator',
          environment: configService.get<string>('nodeEnv', 'development'),
        },
      }),
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
      name: AI_METRICS.TOKENS_USED,
      help: 'Total tokens used by AI providers',
      labelNames: [LABELS.PROVIDER],
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
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'Duration of QA checks in seconds',
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    }),
    makeGaugeProvider({
      name: QA_METRICS.COVERAGE_PERCENT,
      help: 'Test coverage percentage per project',
      labelNames: [LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: QA_METRICS.VULNERABILITIES,
      help: 'Total security vulnerabilities detected',
      labelNames: [LABELS.SEVERITY],
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
      labelNames: [LABELS.ENVIRONMENT],
    }),

    // Cost Metrics
    makeHistogramProvider({
      name: COST_METRICS.PER_PROJECT,
      help: 'Cost per project in USD',
      labelNames: [LABELS.PROJECT, LABELS.PROVIDER],
      buckets: METRICS_CONSTANTS.COST_BUCKETS,
    }),
    makeCounterProvider({
      name: COST_METRICS.TOTAL,
      help: 'Total cost in USD',
      labelNames: [LABELS.PROVIDER],
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
  ],
  exports: [MetricsService],
})
export class AppMetricsModule {}
