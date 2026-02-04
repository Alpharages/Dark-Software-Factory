/**
 * Bulk Create Tickets DTOs
 * Story 9-U-5: Production Error Dashboard - AC#7
 *
 * DTOs for bulk ticket creation and acknowledge operations.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID } from 'class-validator';

export class BulkCreateTicketsDto {
  @ApiProperty({ description: 'Array of error IDs to create tickets for', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  errorIds!: string[];
}

export class BulkCreateTicketsResponseDto {
  @ApiProperty({ description: 'Number of tickets created' })
  created!: number;

  @ApiProperty({ description: 'Number of errors skipped (already have tickets)' })
  skipped!: number;

  @ApiProperty({ description: 'Array of error messages if any failures', type: [String] })
  errors!: string[];
}

export class AcknowledgeErrorDto {
  @ApiProperty({ description: 'User ID who is acknowledging', required: false })
  @IsString()
  acknowledgedBy?: string;
}

export class ExportErrorsQueryDto {
  @ApiProperty({ description: 'Array of error IDs to export', type: [String], required: false })
  @IsUUID('4', { each: true })
  ids?: string[];
}
