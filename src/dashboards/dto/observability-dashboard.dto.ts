import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// ===================================================================
// AC#1: Ticket Timeline DTOs
// ===================================================================

export class TimelineEventDto {
  @ApiProperty({ example: '2025-12-25T12:00:00Z' })
  timestamp!: Date;

  @ApiProperty({ example: 'ai_branch_selection' })
  event_type!: string;

  @ApiProperty({ example: 'Selected branch main for execution' })
  description!: string;

  @ApiProperty({ required: false })
  metadata?: Record<string, unknown>;
}

export class TimelineResponseDto {
  @ApiProperty({ type: [TimelineEventDto] })
  events!: TimelineEventDto[];
}

// ===================================================================
// AC#2: Queue Metrics DTOs
// ===================================================================

export class QueueMetricDto {
  @ApiProperty({ example: 5 })
  depth!: number;

  @ApiProperty({ example: 100 })
  rate!: number;

  @ApiProperty({ example: 300 })
  oldest_message_age_seconds!: number;
}

export class QueueMetricsDto {
  @ApiProperty({ type: QueueMetricDto })
  'qa-check-queue'!: QueueMetricDto;

  @ApiProperty({ type: QueueMetricDto })
  'deployment-queue'!: QueueMetricDto;
}

// ===================================================================
// AC#3: System Health DTOs
// ===================================================================

export class ComponentHealthDto {
  @ApiProperty({ enum: ['up', 'degraded', 'down'] })
  status!: 'up' | 'degraded' | 'down';

  @ApiProperty({ example: 45 })
  latency_ms!: number;

  @ApiProperty({ required: false })
  details?: Record<string, unknown>;
}

export class SystemHealthDto {
  @ApiProperty({ enum: ['up', 'degraded', 'down'] })
  status!: 'up' | 'degraded' | 'down';

  @ApiProperty()
  components!: {
    database: ComponentHealthDto;
    rabbitmq: ComponentHealthDto;
    prometheus: ComponentHealthDto;
  };

  @ApiProperty({ example: 86400 })
  uptime_seconds!: number;
}

// ===================================================================
// AC#4: File Locks DTOs
// ===================================================================

export class WaitingTicketDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  ticket_id!: string;

  @ApiProperty()
  requested_at!: Date;

  @ApiProperty({ example: 120 })
  wait_time_seconds!: number;
}

export class FileLockDto {
  @ApiProperty({ example: 'src/app.ts' })
  file_path!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  locked_by_ticket_id!: string;

  @ApiProperty()
  locked_at!: Date;

  @ApiProperty({ example: 2 })
  waiting_count!: number;

  @ApiProperty({ type: [WaitingTicketDto] })
  waiting_tickets!: WaitingTicketDto[];
}

export class FileLockResponseDto {
  @ApiProperty({ type: [FileLockDto] })
  locks!: FileLockDto[];
}

// ===================================================================
// Request Validation DTOs (still need class for validation)
// ===================================================================

export class TicketIdParamDto {
  @ApiProperty({
    description: 'Ticket UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  ticketId!: string; // Using definite assignment assertion
}
