import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class ShareLinkQueryDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
    required: true,
  })
  @IsString()
  projectId!: string;

  @ApiProperty({
    description: 'Expiration in days (1-30)',
    example: 7,
    required: false,
    default: 7,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  expireDays?: number = 7;
}

export class ShareLinkResponseDto {
  @ApiProperty({
    description: 'Generated shareable URL',
    example: 'http://localhost:3000/shared/abc-123',
  })
  shareUrl!: string;

  @ApiProperty({
    description: 'Expiration timestamp',
    example: '2026-01-07T12:00:00Z',
  })
  expiresAt!: string;
}
