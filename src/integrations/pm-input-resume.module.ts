import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { DispatcherModule } from '@/dispatcher/dispatcher.module';
import { IntegrationsModule } from './integrations.module';
import { PmInputResumeService } from './pm-input-resume.service';

/**
 * Owns the "agent asks a question → PM answers on the task → run resumes" loop.
 *
 * Standalone so the import edges stay one-directional:
 *   PmInputResumeModule → DispatcherModule → OpenHarnessModule
 *   PmInputResumeModule → IntegrationsModule
 * Nothing imports this module back, so it can depend on the dispatcher without
 * closing a cycle.
 */
@Module({
  imports: [DatabaseModule, DispatcherModule, IntegrationsModule],
  providers: [PmInputResumeService],
})
export class PmInputResumeModule {}
