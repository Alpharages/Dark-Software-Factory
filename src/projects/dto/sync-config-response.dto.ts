import { ApiProperty } from '@nestjs/swagger';
import { ProjectIntegration } from '@prisma/client';

export class SyncConfigResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty({ nullable: true }) ai_trigger_status!: string | null;
  @ApiProperty() polling_enabled!: boolean;
  @ApiProperty() polling_interval_min!: number;
  @ApiProperty() webhook_enabled!: boolean;
  @ApiProperty({ nullable: true }) webhook_id!: string | null;
}

export function toSyncConfigResponse(i: ProjectIntegration): SyncConfigResponseDto {
  return {
    id: i.id,
    provider: String(i.provider),
    ai_trigger_status: i.ai_trigger_status,
    polling_enabled: i.polling_enabled,
    polling_interval_min: i.polling_interval_min,
    webhook_enabled: i.webhook_enabled,
    webhook_id: i.webhook_id ?? null,
  };
}
