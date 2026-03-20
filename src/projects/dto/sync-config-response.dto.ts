import { ApiProperty } from '@nestjs/swagger';
import { ProjectIntegration } from '@prisma/client';

export class SyncConfigResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty({ nullable: true }) ai_trigger_status!: string | null;
  @ApiProperty({ nullable: true }) container_id!: string | null;
  @ApiProperty() polling_enabled!: boolean;
  @ApiProperty() polling_interval_min!: number;
  @ApiProperty() webhook_enabled!: boolean;
  @ApiProperty({ nullable: true }) webhook_id!: string | null;
}

export function toSyncConfigResponse(i: ProjectIntegration): SyncConfigResponseDto {
  const cfg = (i.provider_config as Record<string, unknown>) ?? {};
  return {
    id: i.id,
    provider: String(i.provider),
    ai_trigger_status: i.ai_trigger_status,
    container_id: typeof cfg.containerId === 'string' ? cfg.containerId : null,
    polling_enabled: i.polling_enabled,
    polling_interval_min: i.polling_interval_min,
    webhook_enabled: i.webhook_enabled,
    webhook_id: i.webhook_id ?? null,
  };
}

/** Full integration response for GET /projects/:id/integrations (used by the PM Tool Integration panel) */
export interface PmIntegrationResponseDto extends SyncConfigResponseDto {
  status: 'ACTIVE';
  projectId: string;
  workspaceName: string;
  botUserId: string | null;
  botUsername: string | null;
  pollingEnabled: boolean;
  pollingIntervalMin: number;
  pollingLastRunAt: string | null;
  webhookEnabled: boolean;
  webhookId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPmIntegrationResponse(i: ProjectIntegration): PmIntegrationResponseDto {
  const cfg = (i.provider_config as Record<string, unknown>) ?? {};
  return {
    id: i.id,
    status: 'ACTIVE',
    provider: String(i.provider),
    projectId: i.project_id,
    workspaceName: i.workspace_name,
    botUserId: i.bot_user_id ?? null,
    botUsername: i.bot_username ?? null,
    ai_trigger_status: i.ai_trigger_status,
    container_id: typeof cfg.containerId === 'string' ? cfg.containerId : null,
    polling_enabled: i.polling_enabled,
    polling_interval_min: i.polling_interval_min,
    pollingEnabled: i.polling_enabled,
    pollingIntervalMin: i.polling_interval_min,
    pollingLastRunAt: i.polling_last_run_at ? i.polling_last_run_at.toISOString() : null,
    webhook_enabled: i.webhook_enabled,
    webhook_id: i.webhook_id ?? null,
    webhookEnabled: i.webhook_enabled,
    webhookId: i.webhook_id ?? null,
    createdAt: i.created_at.toISOString(),
    updatedAt: i.updated_at.toISOString(),
  };
}
