import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EscapeCategory } from '@/prisma/client';

export class BugEscapeDetailDto {
  @ApiProperty({ description: 'Unique ID' })
  id!: string;

  @ApiProperty({ description: 'Production Error ID' })
  production_error_id!: string;

  @ApiProperty({ description: 'Ticket ID' })
  ticket_id!: string;

  @ApiPropertyOptional({ description: 'Execution ID' })
  execution_id?: string;

  @ApiPropertyOptional({ description: 'QA Result ID' })
  qa_result_id?: string;

  @ApiPropertyOptional({ description: 'QA Review Queue ID' })
  qa_review_queue_id?: string;

  @ApiProperty({ description: 'Root cause category', enum: EscapeCategory })
  escape_category!: EscapeCategory;

  @ApiProperty({ description: 'Date detected' })
  detected_at!: Date;

  @ApiPropertyOptional({ description: 'Date resolved' })
  resolved_at?: Date;

  @ApiPropertyOptional({ description: 'Resolution time in hours' })
  resolution_time_hours?: number;

  @ApiProperty({ description: 'Project ID' })
  project_id!: string;

  @ApiPropertyOptional({ description: 'AI Provider' })
  ai_provider?: string;

  @ApiPropertyOptional({ description: 'Complexity Score' })
  complexity_score?: number;

  // Expanded details
  @ApiPropertyOptional({ description: 'Error message' })
  error_message?: string;

  @ApiPropertyOptional({ description: 'Stack trace' })
  stack_trace?: string;

  @ApiPropertyOptional({ description: 'Ticket title' })
  ticket_title?: string;

  @ApiPropertyOptional({ description: 'Reviewer ID if manual review failed' })
  reviewer_id?: string;
}
