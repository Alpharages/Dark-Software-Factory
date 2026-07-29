import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAiAccountDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiProperty({
    required: false,
    description: 'Replace stored credentials (provider-shaped). Omit to leave unchanged.',
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  quota_config?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Whether the account is eligible for A5 selection' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
