/**
 * Error Overview DTOs
 * Story 9-U-5: Production Error Dashboard - AC#1
 *
 * DTOs for the error overview widget metrics.
 */

import { ApiProperty } from '@nestjs/swagger';
import { ErrorSeverity } from '@/prisma/enums';

export class ErrorOverviewDto {
  @ApiProperty({ description: 'Total number of active errors (not resolved)' })
  totalActiveErrors!: number;

  @ApiProperty({ description: 'Number of errors created in the last 24 hours' })
  newErrors24h!: number;

  @ApiProperty({ description: 'Number of CRITICAL severity errors' })
  criticalErrors!: number;

  @ApiProperty({ description: 'Number of HIGH severity errors' })
  highErrors!: number;

  @ApiProperty({ description: 'Number of MEDIUM severity errors' })
  mediumErrors!: number;

  @ApiProperty({ description: 'Number of LOW severity errors' })
  lowErrors!: number;

  @ApiProperty({ description: 'Mean Time To Resolution in hours', required: false })
  mttrHours?: number;
}

export class ErrorListItemDto {
  @ApiProperty({ description: 'Error ID' })
  id!: string;

  @ApiProperty({ description: 'Application name' })
  application!: string;

  @ApiProperty({ description: 'Error type/class' })
  error_type!: string;

  @ApiProperty({ description: 'Error message (truncated for list view)' })
  error_message!: string;

  @ApiProperty({ description: 'Error severity', enum: ErrorSeverity })
  severity!: ErrorSeverity;

  @ApiProperty({ description: 'When the error occurred' })
  occurred_at!: Date;

  @ApiProperty({ description: 'Number of affected users' })
  affected_users!: number;

  @ApiProperty({ description: 'Number of occurrences' })
  occurrence_count!: number;

  @ApiProperty({ description: 'Fix ticket ID if created', required: false })
  fix_ticket_id?: string;

  @ApiProperty({ description: 'Fix ticket URL if created', required: false })
  fix_ticket_url?: string;

  @ApiProperty({ description: 'Whether the error is resolved' })
  resolved!: boolean;

  @ApiProperty({ description: 'When the error was acknowledged', required: false })
  acknowledged_at?: Date;

  @ApiProperty({ description: 'User ID who acknowledged', required: false })
  acknowledged_by?: string;
}

export class ErrorListResponseDto {
  @ApiProperty({ description: 'List of errors', type: [ErrorListItemDto] })
  errors!: ErrorListItemDto[];

  @ApiProperty({ description: 'Total count for pagination' })
  total!: number;

  @ApiProperty({ description: 'Current page' })
  page!: number;

  @ApiProperty({ description: 'Items per page' })
  limit!: number;
}

export class ErrorListFiltersDto {
  @ApiProperty({
    description: 'Filter by severities',
    enum: ErrorSeverity,
    isArray: true,
    required: false,
  })
  severity?: ErrorSeverity[];

  @ApiProperty({ description: 'Filter by application names', isArray: true, required: false })
  application?: string[];

  @ApiProperty({ description: 'Filter by status', required: false })
  status?: 'active' | 'ticket_created' | 'in_progress' | 'resolved';

  @ApiProperty({ description: 'Start date for date range', required: false })
  dateFrom?: Date;

  @ApiProperty({ description: 'End date for date range', required: false })
  dateTo?: Date;

  @ApiProperty({ description: 'Page number', default: 1, required: false })
  page?: number;

  @ApiProperty({ description: 'Items per page', default: 20, required: false })
  limit?: number;

  @ApiProperty({ description: 'Sort field', default: 'severity', required: false })
  sortBy?: 'severity' | 'occurred_at' | 'affected_users' | 'application';

  @ApiProperty({ description: 'Sort order', default: 'desc', required: false })
  sortOrder?: 'asc' | 'desc';
}
