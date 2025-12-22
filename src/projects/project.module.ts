import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { ProjectRepository } from './project.repository';
import { DatabaseModule } from '../database/database.module';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    ProjectRepository,
    makeCounterProvider({
      name: 'project_operations_total',
      help: 'Total project management operations',
      labelNames: ['operation', 'status'],
    }),
    makeCounterProvider({
      name: 'project_lookups_total',
      help: 'Total project lookups',
      labelNames: ['type', 'status'],
    }),
  ],
  exports: [ProjectService, ProjectRepository],
})
export class ProjectModule {}
