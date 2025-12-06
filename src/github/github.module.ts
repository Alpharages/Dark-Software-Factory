import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubService } from './github.service';
import { GitHubAuthService } from './github-auth.service';
import { GitHubClientService } from './github-client.service';
import { GitHubBranchService } from './services/github-branch.service';
import { GitHubCommitOrchestrator } from './services/github-commit-orchestrator.service';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { DatabaseModule } from '../database/database.module';
import { AiRoutingModule } from '../ai-routing/ai-routing.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditLogModule,
    AppMetricsModule,
    SentryModule,
    RabbitMQModule,
    AiRoutingModule,
  ],
  providers: [
    GitHubService,
    GitHubAuthService,
    GitHubClientService,
    GitHubBranchService,
    GitHubCommitOrchestrator,
  ],
  exports: [GitHubService, GitHubBranchService, GitHubCommitOrchestrator],
})
export class GitHubModule {}
