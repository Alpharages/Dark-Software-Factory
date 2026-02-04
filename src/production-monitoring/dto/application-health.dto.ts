/**
 * Application Health DTOs
 * Story 9-U-5: Production Error Dashboard - AC#6
 *
 * DTOs for the application health heatmap.
 */

import { ApiProperty } from '@nestjs/swagger';

export enum HealthStatus {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  ORANGE = 'ORANGE',
  RED = 'RED',
}

export class ApplicationHealthDto {
  @ApiProperty({ description: 'Application name' })
  application!: string;

  @ApiProperty({ description: 'Total error count in last 24 hours' })
  errorCount24h!: number;

  @ApiProperty({ description: 'Number of CRITICAL errors' })
  criticalCount!: number;

  @ApiProperty({ description: 'Number of HIGH errors' })
  highCount!: number;

  @ApiProperty({ description: 'Number of MEDIUM errors' })
  mediumCount!: number;

  @ApiProperty({ description: 'Number of LOW errors' })
  lowCount!: number;

  @ApiProperty({ description: 'Health status', enum: HealthStatus })
  healthStatus!: HealthStatus;

  @ApiProperty({ description: 'Timestamp of the last error', required: false })
  lastErrorAt?: Date;
}

export class ApplicationHealthResponseDto {
  @ApiProperty({ description: 'List of application health statuses', type: [ApplicationHealthDto] })
  applications!: ApplicationHealthDto[];
}
