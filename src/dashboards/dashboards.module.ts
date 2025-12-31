import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
import { DashboardGateway } from './gateways/dashboard.gateway';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '@/common/metrics';

@Module({
  imports: [
    DatabaseModule,
    RabbitMQModule,
    AppMetricsModule,
    DecisionDashboardModule,
    CacheModule.register({
      ttl: 300, // 5 minutes
      max: 100, // Maximum items in cache
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [ObservabilityDashboardController, PmDashboardController, WorkloadController],
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
    // Services
    ObservabilityDashboardService,
    PmDashboardService,
    WorkloadService,
    WorkloadSchedulerService,
    DashboardGateway,
  ],
  exports: [ObservabilityDashboardService, PmDashboardService, WorkloadService, DashboardGateway],
})
export class DashboardsModule { }
