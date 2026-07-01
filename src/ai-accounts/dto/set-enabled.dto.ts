import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAiAccountEnabledDto {
  @ApiProperty({ example: false, description: 'Whether the account is eligible for A5 selection' })
  @IsBoolean()
  enabled!: boolean;
}
