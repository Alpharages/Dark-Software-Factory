import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration & Database (Global modules)
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './common/logger';
import { AppMetricsModule } from './common/metrics';

// Authentication
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards';

// Core workflow modules
import { WebhooksModule } from './webhooks/webhooks.module';
import { TicketIntakeModule } from './ticket-intake/ticket-intake.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { AiRoutingModule } from './ai-routing/ai-routing.module';
import { ExecutionModule } from './execution/execution.module';

// Quality & Deployment
import { QaAutomationModule } from './qa-automation/qa-automation.module';
import { GitHubModule } from './github/github.module';
import { DeploymentModule } from './deployment/deployment.module';

// Monitoring & Metrics
import { ProductionMonitoringModule } from './production-monitoring/production-monitoring.module';
import { CostTrackingModule } from './cost-tracking/cost-tracking.module';
import { ProgressValidatorModule } from './ai-monitoring/progress-validator.module';
import { FinancialMetricsModule } from './financial-metrics/financial-metrics.module'; // Story 6-R-3

// User interfaces
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ConversationsModule } from './conversations/conversations.module'; // Story 5.5
import { ReportsModule } from './reports/reports.module'; // Story 5.6
import { NotificationsModule } from './notifications/notifications.module'; // Story 10-U-7

// External integrations
import { IntegrationsModule } from './integrations/integrations.module';
import { ClickUpModule } from './clickup/clickup.module';
import { ProjectModule } from './projects/project.module';

// Dependency Management
import { DependenciesModule } from './dependencies/dependencies.module';
import { FileLocksModule } from './file-locks/file-locks.module';
import { StorageModule } from './storage/storage.module';
import { GitMirrorModule } from './git-mirror/git-mirror.module';
import { DockerModule } from './docker/docker.module'; // Story 22.1
import { CleanupModule } from './cleanup/cleanup.module'; // Story 23.2

// Story 15.2
import { SystemConfigModule } from './system-settings/system-config.module';
// Story 7.1
import { ArchitectureReviewModule } from './architecture-review/architecture-review.module';

// Common
import { CorrelationIdMiddleware } from './common/middleware';
import { HttpExceptionFilter } from './common/filters';
import {
  LoggingInterceptor,
  AuditLogInterceptor,
  CorrelationIdInterceptor,
} from './common/interceptors';
import { SentryModule, SentryExceptionFilter, SentryInterceptor } from './common/sentry';

@Module({
  imports: [
    // Configuration
    ConfigModule,
    ScheduleModule.forRoot(),
    // Rate Limiting - 100 requests/minute per NFR-I7
    ThrottlerModule.forRoot([
      {
        name: 'webhook',
        ttl: 60000, // 1 minute in milliseconds
        limit: 100, // 100 requests per minute
      },
    ]),
    LoggerModule,
    SentryModule,
    AppMetricsModule, // Must be early for global metrics availability

    // Infrastructure
    DatabaseModule,
    RabbitMQModule,
    DockerModule, // Story 22.1: Docker Client Integration
    CleanupModule, // Story 23.2: Automated Container Cleanup

    // Authentication
    AuthModule,

    // Core workflow
    WebhooksModule,
    TicketIntakeModule,
    AiRoutingModule,
    ExecutionModule,

    // Quality & Deployment
    QaAutomationModule,
    GitHubModule,
    DeploymentModule,

    // Monitoring & Metrics
    ProductionMonitoringModule,
    CostTrackingModule,
    ProgressValidatorModule, // Story 11.3: AI Progress Validator
    FinancialMetricsModule, // Story 6-R-3: Financial Metrics Business Oversight

    // User interfaces
    DashboardsModule,
    RealtimeModule,
    NotificationsModule,

    // External integrations
    IntegrationsModule,
    ClickUpModule,
    ProjectModule,

    // Story 5.5: Client Communication Intelligence
    ConversationsModule,

    // Story 5.6: Reporting & Analytics Generation
    ReportsModule,

    // Dependency Management
    DependenciesModule, // Story 12.1: Circular Dependency Detection
    FileLocksModule, // Story 12.3: File Lock Manager
    StorageModule, // Story 14.3: Storage Manager Service
    GitMirrorModule, // Story 23.1: Local Git Mirror Service

    // Story 15.2: System Settings
    SystemConfigModule,

    // Story 7.1: Architecture Review (ADR Generation)
    ArchitectureReviewModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // Apply JwtAuthGuard globally
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Apply ThrottlerGuard globally for rate limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global Sentry Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryInterceptor,
    },
    // Global Audit Log Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    // Global Correlation ID Interceptor (ensures response headers)
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
