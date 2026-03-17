import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum, IsNumberString, IsOptional, IsUUID } from 'class-validator';
import { PMProvider } from '@/prisma/enums';

export class ImportProjectDto {
  @ApiProperty({
    description: 'Integration provider source',
    enum: PMProvider,
    example: 'CLICKUP',
  })
  @IsEnum(PMProvider)
  @IsNotEmpty()
  provider!: PMProvider;

  @ApiProperty({
    description: 'Resource ID from the provider (e.g., ClickUp List ID)',
    example: '90120123456',
  })
  @IsNumberString()
  @IsNotEmpty()
  resourceId!: string;

  @ApiPropertyOptional({
    description: 'ID of the ConnectedApp to use for auto-creating ProjectIntegration',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  @IsOptional()
  accountId?: string;
}
