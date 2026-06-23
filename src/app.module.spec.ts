/**
 * AppModule Unit Tests
 * Tests for the main application module structure
 *
 * NOTE: Prisma 7 requires an adapter/accelerateUrl at runtime, making it difficult
 * to test the full AppModule with real PrismaService. These tests verify module
 * structure and imports exist without instantiating the full dependency tree.
 */

import { register } from 'prom-client';
import { AppModule } from './app.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TicketIntakeModule } from './ticket-intake/ticket-intake.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { ExecutionModule } from './execution/execution.module';
import { QaAutomationModule } from './qa-automation/qa-automation.module';
import { GitHubModule } from './github/github.module';
import { DeploymentModule } from './deployment/deployment.module';
import { ProductionMonitoringModule } from './production-monitoring/production-monitoring.module';
import { CostTrackingModule } from './cost-tracking/cost-tracking.module';
import { MetricsModule } from './metrics/metrics.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';
import { IntegrationsModule } from '@/integrations/integrations.module';

describe('AppModule', () => {
  beforeEach(() => {
    // Clear metrics registry to avoid conflicts between tests
    register.clear();
  });

  describe('Module Structure (Static Analysis)', () => {
    it('should be defined', () => {
      expect(AppModule).toBeDefined();
    });

    it('should export a module class', () => {
      expect(typeof AppModule).toBe('function');
      expect(AppModule.name).toBe('AppModule');
    });
  });

  describe('Feature Modules Existence', () => {
    const modules = [
      { name: 'ConfigModule', module: ConfigModule },
      { name: 'DatabaseModule', module: DatabaseModule },
      { name: 'AuthModule', module: AuthModule },
      { name: 'WebhooksModule', module: WebhooksModule },
      { name: 'TicketIntakeModule', module: TicketIntakeModule },
      { name: 'RabbitMQModule', module: RabbitMQModule },
      { name: 'ExecutionModule', module: ExecutionModule },
      { name: 'QaAutomationModule', module: QaAutomationModule },
      { name: 'GitHubModule', module: GitHubModule },
      { name: 'DeploymentModule', module: DeploymentModule },
      { name: 'ProductionMonitoringModule', module: ProductionMonitoringModule },
      { name: 'CostTrackingModule', module: CostTrackingModule },
      { name: 'MetricsModule', module: MetricsModule },
      { name: 'DashboardsModule', module: DashboardsModule },
      { name: 'RealtimeModule', module: RealtimeModule },
      { name: 'IntegrationsModule', module: IntegrationsModule },
    ];

    test.each(modules)('$name should be defined', ({ module }) => {
      expect(module).toBeDefined();
      expect(typeof module).toBe('function');
    });
  });

  describe('Module Metadata', () => {
    it('should have @Module decorator metadata', () => {
      // NestJS stores module metadata using Reflect
      const imports = Reflect.getMetadata('imports', AppModule);
      expect(imports).toBeDefined();
      expect(Array.isArray(imports)).toBe(true);
    });

    it('should import at least core modules', () => {
      const imports = Reflect.getMetadata('imports', AppModule);
      expect(imports.length).toBeGreaterThan(0);
    });

    it('should have controllers defined', () => {
      const controllers = Reflect.getMetadata('controllers', AppModule);
      expect(controllers).toBeDefined();
      expect(Array.isArray(controllers)).toBe(true);
    });

    it('should have providers defined', () => {
      const providers = Reflect.getMetadata('providers', AppModule);
      expect(providers).toBeDefined();
      expect(Array.isArray(providers)).toBe(true);
    });
  });
});
