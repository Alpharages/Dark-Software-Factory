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

// User interfaces
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';

// External integrations
import { IntegrationModule } from './integration/integration.module';
import { ClickUpModule } from './clickup/clickup.module';
import { ProjectModule } from './projects/project.module';

// Dependency Management
import { DependenciesModule } from './dependencies/dependencies.module';
import { FileLocksModule } from './file-locks/file-locks.module';
import { StorageModule } from './storage/storage.module';

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

    // User interfaces
    DashboardsModule,
    RealtimeModule,

    // External integrations
    IntegrationModule,
    ClickUpModule,
    ProjectModule,

    // Dependency Management
    DependenciesModule, // Story 12.1: Circular Dependency Detection
    FileLocksModule, // Story 12.3: File Lock Manager
    StorageModule, // Story 14.3: Storage Manager Service
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
