import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TicketIntakeModule } from './ticket-intake/ticket-intake.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { AiRoutingModule } from './ai-routing/ai-routing.module';
import { ExecutionModule } from './execution/execution.module';
import { QaAutomationModule } from './qa-automation/qa-automation.module';
import { GithubModule } from './github/github.module';
import { DeploymentModule } from './deployment/deployment.module';
import { ProductionMonitoringModule } from './production-monitoring/production-monitoring.module';
import { CostTrackingModule } from './cost-tracking/cost-tracking.module';
import { MetricsModule } from './metrics/metrics.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';
import { IntegrationModule } from './integration/integration.module';

describe('AppModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    // Note: Environment variables are set globally in test/jest-setup.ts
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should import ConfigModule', () => {
    const configModule = module.get(ConfigModule);
    expect(configModule).toBeDefined();
  });

  it('should import DatabaseModule', () => {
    const databaseModule = module.get(DatabaseModule);
    expect(databaseModule).toBeDefined();
  });

  it('should import all feature modules', () => {
    const modules = [
      AuthModule,
      WebhooksModule,
      TicketIntakeModule,
      RabbitmqModule,
      AiRoutingModule,
      ExecutionModule,
      QaAutomationModule,
      GithubModule,
      DeploymentModule,
      ProductionMonitoringModule,
      CostTrackingModule,
      MetricsModule,
      DashboardsModule,
      RealtimeModule,
      IntegrationModule,
    ];

    modules.forEach((ModuleClass) => {
      const moduleInstance = module.get(ModuleClass);
      expect(moduleInstance).toBeDefined();
    });
  });
});
