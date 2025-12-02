import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClickUpEventType } from '../interfaces';

/**
 * Internal DTO representing a processed webhook event
 * Used for passing events to downstream services (ticket-intake, queue)
 */
export class TaskEventDto {
  /** Correlation ID for distributed tracing */
  @ApiProperty({ description: 'Correlation ID for distributed tracing' })
  correlationId!: string;

  /** Original webhook event ID (idempotency key) */
  @ApiProperty({ description: 'Original webhook event ID (idempotency key)' })
  webhookEventId!: string;

  /** Type of event */
  @ApiProperty({ description: 'Type of event', enum: ClickUpEventType })
  eventType!: ClickUpEventType;

  /** ClickUp task ID */
  @ApiProperty({ description: 'ClickUp task ID' })
  taskId!: string;

  /** Task name/title */
  @ApiProperty({ description: 'Task name/title' })
  taskName!: string;

  /** Task description (may contain markdown) */
  @ApiPropertyOptional({ description: 'Task description (may contain markdown)' })
  taskDescription!: string | null;

  /** Task status */
  @ApiProperty({ description: 'Task status' })
  taskStatus!: string;

  /** ClickUp list ID (used to determine project) */
  @ApiProperty({ description: 'ClickUp list ID' })
  listId!: string;

  /** ClickUp list name */
  @ApiProperty({ description: 'ClickUp list name' })
  listName!: string;

  /** ClickUp space ID */
  @ApiProperty({ description: 'ClickUp space ID' })
  spaceId!: string;

  /** ClickUp project ID */
  @ApiProperty({ description: 'ClickUp project ID' })
  projectId!: string;

  /** ClickUp project name */
  @ApiProperty({ description: 'ClickUp project name' })
  projectName!: string;

  /** Task URL for reference */
  @ApiProperty({ description: 'Task URL for reference' })
  taskUrl!: string;

  /** Task tags */
  @ApiProperty({ description: 'Task tags', type: [String] })
  tags!: string[];

  /** Custom fields (parsed) */
  @ApiProperty({ description: 'Custom fields (parsed)' })
  customFields!: Map<string, unknown>;

  /** Creator email */
  @ApiProperty({ description: 'Creator email' })
  creatorEmail!: string;

  /** When event was created in ClickUp */
  @ApiProperty({ description: 'When event was created in ClickUp' })
  eventTimestamp!: Date;

  /** When we received the webhook */
  @ApiProperty({ description: 'When we received the webhook' })
  receivedAt!: Date;
}

/**
 * Response DTO for webhook acknowledgment
 */
export class WebhookResponseDto {
  /** Always true for successful receipt */
  @ApiProperty({ description: 'Always true for successful receipt', example: true })
  success!: boolean;

  /** Message for logging/debugging */
  @ApiProperty({
    description: 'Message for logging/debugging',
    example: 'Webhook received and queued',
  })
  message!: string;

  /** Correlation ID for tracing */
  @ApiProperty({
    description: 'Correlation ID for tracing',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  correlationId!: string;

  /** Whether the event will be processed */
  @ApiProperty({ description: 'Whether the event will be processed', example: true })
  willProcess!: boolean;

  /** Timestamp of acknowledgment */
  @ApiProperty({ description: 'Timestamp of acknowledgment', example: '2025-01-01T00:00:00.000Z' })
  timestamp!: string;
}
