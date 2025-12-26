import { IsString, IsNotEmpty, IsISO8601, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateReportDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'proj-123',
  })
  @IsString()
  @IsNotEmpty()
  project_id!: string;

  @ApiProperty({
    description: 'Start date for the report (ISO8601)',
    example: '2023-01-01T00:00:00Z',
  })
  @IsISO8601()
  @IsNotEmpty()
  date_start!: string;

  @ApiProperty({
    description: 'End date for the report (ISO8601)',
    example: '2023-01-31T23:59:59Z',
  })
  @IsISO8601()
  @IsNotEmpty()
  date_end!: string;

  @ApiProperty({
    description: 'Optional report title',
    example: 'January Sprint Review',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;
}
