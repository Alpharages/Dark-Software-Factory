import { Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
import { StatusSkillMapAdminService } from './status-skill-map-admin.service';
import { StatusSkillMapAdminController } from './status-skill-map-admin.controller';
import { DatabaseModule } from '@/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { OpenHarnessModule } from '@/openharness/openharness.module';

@Module({
  imports: [DatabaseModule, ConfigModule, OpenHarnessModule],
  controllers: [SystemConfigController, StatusSkillMapAdminController],
  providers: [SystemConfigService, StatusSkillMapAdminService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
