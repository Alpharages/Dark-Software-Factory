import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubService } from './github.service';
import { GitHubAuthService } from './github-auth.service';
import { GitHubClientService } from './github-client.service';
import { GitHubBranchService } from './services/github-branch.service';
import { GitHubCommitOrchestrator } from './services/github-commit-orchestrator.service';
import { GitHubPROrchestrator } from './services/github-pr-orchestrator.service';
import { DeploymentOrchestrator } from './services/deployment-orchestrator.service';
import { DeploymentTriggerConsumer } from './services/deployment-trigger.consumer';
import { DeploymentStatusSync } from './services/deployment-status-sync.service';
import { GitHubErrorMonitor } from './services/github-error-monitor.service';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { DatabaseModule } from '../database/database.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ClickUpModule } from '../clickup/clickup.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditLogModule,
    AppMetricsModule,
    SentryModule,
    RabbitMQModule,
    AiRoutingModule,
    WebhooksModule,
    ClickUpModule,
  ],
  providers: [
    GitHubService,
    GitHubAuthService,
    GitHubClientService,
    GitHubBranchService,
    GitHubCommitOrchestrator,
    GitHubPROrchestrator,
    DeploymentOrchestrator,
    DeploymentTriggerConsumer,
    DeploymentStatusSync,
    GitHubErrorMonitor,
  ],
  exports: [
    GitHubService,
    GitHubBranchService,
    GitHubCommitOrchestrator,
    GitHubPROrchestrator,
    DeploymentOrchestrator,
    DeploymentStatusSync,
    GitHubErrorMonitor,
  ],
})
export class GitHubModule {}
