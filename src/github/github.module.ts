import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubService } from './github.service';
import { GitHubAuthService } from './github-auth.service';
import { GitHubClientService } from './github-client.service';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [ConfigModule, AuditLogModule, AppMetricsModule, SentryModule, RabbitMQModule],
  providers: [GitHubService, GitHubAuthService, GitHubClientService],
  exports: [GitHubService],
})
export class GitHubModule {}
