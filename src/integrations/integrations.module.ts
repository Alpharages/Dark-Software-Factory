import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ClickUpModule } from '../clickup/clickup.module';

@Module({
    imports: [ClickUpModule],
    controllers: [IntegrationsController],
})
export class IntegrationsModule { }
