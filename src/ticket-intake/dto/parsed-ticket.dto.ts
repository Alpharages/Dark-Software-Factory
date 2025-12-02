import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for parsed ticket data
 * FR57: Parse ticket details from ClickUp
 */
export class ParsedTicketDto {
  @ApiProperty({ description: 'ClickUp task ID' })
  clickupTaskId!: string;

  @ApiProperty({ description: 'Project ID' })
  projectId!: string;

  @ApiProperty({ description: 'Ticket title (min 10 chars)' })
  title!: string;

  @ApiProperty({ description: 'Ticket description' })
  description!: string;

  @ApiProperty({ description: 'Acceptance criteria extracted from description' })
  acceptanceCriteria!: string;

  @ApiProperty({ description: 'Tags/labels', type: [String] })
  tags!: string[];

  @ApiPropertyOptional({ description: 'Priority level' })
  priority!: string | null;

  @ApiProperty({ description: 'Creator email' })
  creatorEmail!: string;

  @ApiProperty({ description: 'ClickUp task URL' })
  taskUrl!: string;

  @ApiProperty({ description: 'Correlation ID for tracing' })
  correlationId!: string;
}
