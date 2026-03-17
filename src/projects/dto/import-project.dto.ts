import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum, IsNumberString } from 'class-validator';
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
}
