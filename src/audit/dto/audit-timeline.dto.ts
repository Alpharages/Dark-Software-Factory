import { ApiProperty } from '@nestjs/swagger';

// Using any for Prisma JsonValue to avoid import issues
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AuditLogDto {
  id: string;
  timestamp: Date;
  agent_name: string;
  action: string;
  reasoning: string;
  ticket_id: string;
  execution_id?: string | null;
  input_data: any; // Prisma JsonValue
  output_data: any; // Prisma JsonValue
  confidence: number;
  execution?: {
    id: string;
    status: string;
    ai_provider: string;
  } | null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Swagger documentation for timeline response
export class TimelineResponseDto {
  @ApiProperty({ example: 'DSF-123', description: 'Ticket ID' })
  ticketId!: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid-here' },
        timestamp: { type: 'string', example: '2025-12-22T10:30:00.000Z' },
        agent_name: { type: 'string', example: 'AIExecutionConsumer' },
        action: { type: 'string', example: 'ai_provider_selection' },
        reasoning: { type: 'string', example: 'Selected Cursor...' },
        ticket_id: { type: 'string', example: 'DSF-123' },
        execution_id: { type: 'string', nullable: true },
        input_data: { type: 'object' },
        output_data: { type: 'object' },
        confidence: { type: 'number', example: 0.85 },
      },
    },
    description: 'Chronological list of decisions',
  })
  decisions!: AuditLogDto[];

  @ApiProperty({ example: 8, description: 'Total decision count' })
  totalDecisions!: number;
}
