import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubService } from './github.service';
import { GitHubAuthService } from './github-auth.service';
import { GitHubClientService } from './github-client.service';
import { GitHubBranchService } from './services/github-branch.service';
import { GitHubPROrchestrator } from './services/github-pr-orchestrator.service';
import { DeploymentOrchestrator } from './services/deployment-orchestrator.service';
import { DeploymentTriggerConsumer } from './services/deployment-trigger.consumer';
import { DeploymentStatusSyncService } from './services/deployment-status-sync.service';
import { GitHubErrorMonitor } from './services/github-error-monitor.service';
import { DeploymentSuccessRateCalculator } from './services/deployment-success-rate-calculator.service';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { GitHubAuthFlowController } from './github-auth-flow.controller';
import { BranchStrategistService } from './services/branch-strategist.service';
import { PRRiskAssessorService } from './services/pr-risk-assessor.service';
import { PRAutoMergeService } from './services/pr-auto-merge.service';
import { PRReminderService } from './services/pr-reminder.service';
import { PRReminderConsumer } from './services/pr-reminder.consumer';
import { GitHubWebhookConsumer } from './services/github-webhook.consumer';
import { GitHubTokenResolverService } from './github-token-resolver.service';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LoggerModule } from '../common/logger/logger.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { DatabaseModule } from '../database/database.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ClickUpModule } from '../clickup/clickup.module';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
import { DeploymentHealthMonitorService } from './services/deployment-health-monitor.service';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { ExecutionModule } from '../execution/execution.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { ApprovalGateModule } from '@/approval-gate/approval-gate.module';
import { SubscriptionCompletionModule } from '@/common/ai/subscription-completion.module';

@Module({
  imports: [
    ConfigModule,
    SubscriptionCompletionModule,
    DatabaseModule,
    AuditLogModule,
    AppMetricsModule,
    SentryModule,
    LoggerModule, // Required for winston logger injection
    RabbitMQModule,
    forwardRef(() => WebhooksModule),
    ClickUpModule,
    // Story 11.4: AI Decision Audit Logging
    AIDecisionLoggerModule,
    EncryptionModule,
    IntegrationsModule,
    RealtimeModule,
    forwardRef(() => ApprovalGateModule),
    forwardRef(() => ExecutionModule),
  ],
  controllers: [GitHubAuthFlowController],
  providers: [
    GitHubService,
    GitHubAuthFlowService,
    GitHubAuthService,
    GitHubClientService,
    GitHubBranchService,
    GitHubPROrchestrator,
    DeploymentOrchestrator,
    DeploymentTriggerConsumer,
    DeploymentStatusSyncService,
    DeploymentHealthMonitorService,
    GitHubErrorMonitor,
    DeploymentSuccessRateCalculator,
    BranchStrategistService,
    PRRiskAssessorService,
    PRAutoMergeService,
    PRReminderService,
    PRReminderConsumer,
    GitHubWebhookConsumer,
    GitHubTokenResolverService,
    // Story 14.4: Health Monitoring Prometheus Metrics (AC#6)
    makeCounterProvider({
      name: 'deployment_health_checks_total',
      help: 'Health checks performed',
      labelNames: ['environment', 'status'],
    }),
    makeCounterProvider({
      name: 'deployment_rollback_total',
      help: 'Deployments rolled back',
      labelNames: ['environment', 'reason'],
    }),
    makeHistogramProvider({
      name: 'deployment_health_window_duration_seconds',
      help: 'Health monitoring window duration',
      buckets: [30, 60, 90, 120, 180, 240, 300],
    }),
  ],
  exports: [
    GitHubService,
    GitHubAuthService,
    GitHubClientService,
    GitHubBranchService,
    GitHubPROrchestrator,
    DeploymentOrchestrator,
    DeploymentStatusSyncService,
    DeploymentHealthMonitorService,
    GitHubErrorMonitor,
    DeploymentSuccessRateCalculator,
    BranchStrategistService,
    PRRiskAssessorService,
    PRAutoMergeService,
    PRReminderService,
    GitHubTokenResolverService,
  ],
})
export class GitHubModule {}
