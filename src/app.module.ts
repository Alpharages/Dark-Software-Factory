import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration & Database (Global modules)
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';

// Authentication
import { AuthModule } from './auth/auth.module';

// Core workflow modules
import { WebhooksModule } from './webhooks/webhooks.module';
import { TicketIntakeModule } from './ticket-intake/ticket-intake.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { AiRoutingModule } from './ai-routing/ai-routing.module';
import { ExecutionModule } from './execution/execution.module';

// Quality & Deployment
import { QaAutomationModule } from './qa-automation/qa-automation.module';
import { GithubModule } from './github/github.module';
import { DeploymentModule } from './deployment/deployment.module';

// Monitoring & Metrics
import { ProductionMonitoringModule } from './production-monitoring/production-monitoring.module';
import { CostTrackingModule } from './cost-tracking/cost-tracking.module';
import { MetricsModule } from './metrics/metrics.module';

// User interfaces
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';

// External integrations
import { IntegrationModule } from './integration/integration.module';

@Module({
  imports: [
    // Configuration
    ConfigModule,

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
    GithubModule,
    DeploymentModule,

    // Monitoring & Metrics
    ProductionMonitoringModule,
    CostTrackingModule,
    MetricsModule,

    // User interfaces
    DashboardsModule,
    RealtimeModule,

    // External integrations
    IntegrationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
