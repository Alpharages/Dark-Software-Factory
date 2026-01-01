import { Module, forwardRef } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { ProjectRepository } from './project.repository';
import { DatabaseModule } from '../database/database.module';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

import { ClickUpModule } from '@/clickup/clickup.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => ClickUpModule)],
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
  ],
  exports: [ProjectService],
})
export class ProjectModule { }
