import { Module, forwardRef } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { ProjectRepository } from './project.repository';
import { DatabaseModule } from '../database/database.module';
import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

import { ClickUpModule } from '@/clickup/clickup.module';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';
import { IntegrationsModule } from '@/integrations/integrations.module';
import { ConnectedAppsModule } from '@/connected-apps/connected-apps.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => ClickUpModule),
    AIDecisionLoggerModule,
    IntegrationsModule,
    ConnectedAppsModule,
    EncryptionModule,
  ],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    ProjectRepository,
    makeCounterProvider({
      name: 'project_operations_total',
      help: 'Total number of project operations',
      labelNames: ['operation', 'status'],
    }),
    makeCounterProvider({
      name: 'project_lookups_total',
      help: 'Total number of project lookups',
      labelNames: ['type', 'status'],
    }),
    makeGaugeProvider({
      name: 'projects_by_status',
      help: 'Number of projects by status',
      labelNames: ['status'], // active, inactive
    }),
    makeCounterProvider({
      name: 'project_deletion_total',
      help: 'Total number of project deletions',
      labelNames: ['status', 'force'],
    }),
    makeCounterProvider({
      name: 'project_sync_total',
      help: 'Total number of project syncs from ClickUp',
      labelNames: ['status'],
    }),
  ],
  exports: [ProjectService],
})
export class ProjectModule {}
