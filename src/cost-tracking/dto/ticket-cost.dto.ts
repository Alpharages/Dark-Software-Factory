import { ApiProperty } from '@nestjs/swagger';
import { AIProvider } from '@/prisma/client';

/**
 * DTO for individual cost log entry with execution details
 */
export class CostLogDto {
  @ApiProperty({
    description: 'Cost log unique identifier',
    example: 'log-uuid-1',
  })
  id!: string;

  @ApiProperty({
    description: 'Timestamp of AI invocation (UTC)',
    example: '2025-12-25T10:30:00Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'AI provider used',
    enum: AIProvider,
    example: 'CURSOR_HEADLESS',
  })
  aiProvider!: AIProvider;

  @ApiProperty({
    description: 'AI model name',
    example: 'gpt-4o',
  })
  modelName!: string;

  @ApiProperty({
    description: 'Type of AI operation performed',
    example: 'code_generation',
  })
  operationType!: string;

  @ApiProperty({
    description: 'Input tokens consumed',
    example: 5000,
  })
  tokensInput!: number | null;

  @ApiProperty({
    description: 'Output tokens consumed',
    example: 3000,
  })
  tokensOutput!: number | null;

  @ApiProperty({
    description: 'Cost in USD for this invocation',
    example: '8.50',
  })
  costUsd!: string;

  @ApiProperty({
    description: 'Associated execution details (if available)',
    required: false,
  })
  execution?: {
    id: string;
    status: string;
    aiProvider: string;
    selectedModel: string | null;
  };
}

/**
 * Response DTO for per-ticket cost breakdown
 */
export class TicketCostDto {
  @ApiProperty({
    description: 'Ticket ID',
    example: 'DSF-123',
  })
  ticketId!: string;

  @ApiProperty({
    description: 'Total cost in USD for this ticket',
    example: '12.45',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Total tokens consumed (input + output)',
    example: 35000,
  })
  totalTokens!: number;

  @ApiProperty({
    description: 'Number of AI invocations for this ticket',
    example: 5,
  })
  invocationCount!: number;

  @ApiProperty({
    description: 'Detailed cost log history',
    type: [CostLogDto],
  })
  costLogs!: CostLogDto[];
}
