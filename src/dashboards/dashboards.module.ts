import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  makeGaugeProvider,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { DecisionDashboardModule } from './decision-dashboard.module';
import { ObservabilityDashboardController } from './observability-dashboard.controller';
import { ObservabilityDashboardService } from './services/observability-dashboard.service';
import { PmDashboardController } from './pm-dashboard.controller';
import { PmDashboardService } from './services/pm-dashboard.service';
import { WorkloadController } from './controllers/workload.controller';
import { WorkloadService } from './services/workload.service';
import { WorkloadSchedulerService } from './services/workload-scheduler.service';
import { QaWorkloadController } from './qa-workload.controller';
import { QaWorkloadService } from './services/qa-workload.service';
import { DashboardGateway } from './gateways/dashboard.gateway';
import { QualityDashboardListener } from './listeners/quality-dashboard.listener';
import { EmailModule } from '@/common/email/email.module';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '@/common/metrics';
import { QaAutomationModule } from '@/qa-automation/qa-automation.module';
import { BugEscapeModule } from '@/qa-automation/bug-escape/bug-escape.module';
import { QualityGateConfigModule } from '@/qa-automation/quality-gate-config/quality-gate-config.module';
import { QaDashboardController } from './qa-dashboard.controller';
import { QualityDashboardService } from './services/quality-dashboard.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { AnomalyDetectionController } from './anomaly-detection.controller';
import { AnomalyNotificationListener } from './listeners/anomaly-notification.listener';
import { ConversationsModule } from '@/conversations/conversations.module';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';

@Module({
  imports: [
    DatabaseModule,
    RabbitMQModule,
    AppMetricsModule,
    QaAutomationModule,
    BugEscapeModule,
    QualityGateConfigModule,
    DecisionDashboardModule,
    ConversationsModule,
    AIDecisionLoggerModule,
    EmailModule,
    CacheModule.register({
      ttl: 300, // 5 minutes
      max: 100, // Maximum items in cache
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: '1h',
          algorithm: 'HS256',
        },
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    ObservabilityDashboardController,
    PmDashboardController,
    WorkloadController,
    QaDashboardController,
    QaWorkloadController,
    AnomalyDetectionController,
  ],
  providers: [
    // Workload Metrics (Story 5.4)
    makeGaugeProvider({
      name: 'pm_utilization_percent',
      help: 'PM utilization percentage (active_tickets / max_tickets * 100)',
      labelNames: ['pm_id', 'pm_name'],
    }),
    makeGaugeProvider({
      name: 'pm_burnout_risk_total',
      help: 'Burnout risk flag: 1 if PM >80% utilization, 0 otherwise',
      labelNames: ['pm_id', 'pm_name'],
    }),
    makeGaugeProvider({
      name: 'pm_active_tickets',
      help: 'Number of active tickets assigned to PM',
      labelNames: ['pm_id', 'pm_name'],
    }),
    makeGaugeProvider({
      name: 'pm_max_tickets',
      help: 'PM capacity threshold (max concurrent tickets)',
      labelNames: ['pm_id', 'pm_name'],
    }),
    makeCounterProvider({
      name: 'workload_snapshot_job_total',
      help: 'Total number of workload snapshot job executions',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'workload_snapshot_job_duration_seconds',
      help: 'Duration of workload snapshot jobs',
    }),
    makeCounterProvider({
      name: 'workload_burnout_check_total',
      help: 'Total number of burnout alert checks',
      labelNames: ['status'],
    }),
    makeGaugeProvider({
      name: 'workload_burnout_alerts_triggered',
      help: 'Number of burnout alerts triggered in last check',
    }),
    makeGaugeProvider({
      name: 'workload_snapshot_success_count',
      help: 'Number of successful snapshots in last job',
    }),
    makeGaugeProvider({
      name: 'workload_snapshot_error_count',
      help: 'Number of failed snapshots in last job',
    }),

    // QA Workload Metrics (Story 8.8)
    makeCounterProvider({
      name: 'qa_workload_api_calls_total',
      help: 'Total QA workload API calls by endpoint',
      labelNames: ['endpoint'],
    }),
    makeGaugeProvider({
      name: 'qa_workload_queue_depth',
      help: 'Current depth of the QA review queue',
    }),
    makeHistogramProvider({
      name: 'qa_workload_review_duration_seconds',
      help: 'Duration of QA reviews in seconds',
      buckets: [60, 300, 900, 1800, 3600, 7200, 14400, 28800], // 1m to 8h
    }),
    makeCounterProvider({
      name: 'qa_workload_alerts_total',
      help: 'Total QA workload alerts triggered by type and severity',
      labelNames: ['type', 'severity'],
    }),

    // Quality Dashboard Metrics (Story 8.6)
    makeCounterProvider({
      name: 'quality_dashboard_api_calls_total',
      help: 'Total quality dashboard API calls by endpoint',
      labelNames: ['endpoint'],
    }),
    makeCounterProvider({
      name: 'quality_dashboard_alerts_total',
      help: 'Total quality alerts generated by type and metric',
      labelNames: ['type', 'metric'],
    }),
    makeCounterProvider({
      name: 'quality_dashboard_summary_cache_hits_total',
      help: 'Total cache hits for summary endpoint',
      labelNames: ['endpoint'],
    }),

    // Services
    ObservabilityDashboardService,
    PmDashboardService,
    WorkloadService,
    WorkloadSchedulerService,
    WorkloadSchedulerService,
    DashboardGateway,
    QualityDashboardService,
    QualityDashboardListener,
    QaWorkloadService,
    AnomalyDetectionService,
    AnomalyNotificationListener,
  ],
  exports: [
    ObservabilityDashboardService,
    PmDashboardService,
    WorkloadService,
    DashboardGateway,
    QualityDashboardService,
    AnomalyDetectionService,
  ],
})
export class DashboardsModule {}
