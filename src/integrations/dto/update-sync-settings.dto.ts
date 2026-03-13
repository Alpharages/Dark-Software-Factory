import { IsBoolean, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSyncSettingsDto {
  @ApiProperty({ description: 'Enable or disable polling' })
  @IsBoolean()
  polling_enabled!: boolean;

  @ApiProperty({ description: 'Polling interval in minutes', minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  polling_interval_min!: number;

  @ApiProperty({ description: 'Enable or disable webhooks' })
  @IsBoolean()
  webhook_enabled!: boolean;
}
