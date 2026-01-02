import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class HistoricalRoiQueryDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
    required: true,
  })
  @IsString()
  projectId!: string;

  @ApiProperty({
    description: 'Start date (ISO 8601)',
    example: '2025-12-01T00:00:00Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    description: 'End date (ISO 8601)',
    example: '2025-12-31T23:59:59Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

export class RoiDataPointDto {
  @ApiProperty({
    description: 'Date string (YYYY-MM-DD)',
    example: '2025-12-01',
  })
  date!: string;

  @ApiProperty({
    description: 'ROI percentage on this date',
    example: 15.5,
  })
  roi!: number;

  @ApiProperty({
    description: 'Total cost to date',
    example: '1250.00',
  })
  cost!: string;

  @ApiProperty({
    description: 'Total value to date',
    example: '5000.00',
  })
  value!: string;
}

export class HistoricalRoiResponseDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
  })
  projectId!: string;

  @ApiProperty({
    description: 'Time series data points',
    type: [RoiDataPointDto],
  })
  timeSeries!: RoiDataPointDto[];
}
