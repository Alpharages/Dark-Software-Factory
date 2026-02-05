import { ExecutionStatus } from '@/prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for execution control operations
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class ExecutionControlResponse {
  @ApiProperty({
    description: 'Execution ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  executionId!: string;

  @ApiProperty({
    description: 'Current execution status',
    enum: ExecutionStatus,
    example: ExecutionStatus.PAUSED,
  })
  status!: ExecutionStatus;

  @ApiProperty({
    description: 'Timestamp of the operation',
    example: '2026-02-05T12:00:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'ID of the user who performed the operation',
    example: 'user_123',
  })
  performedBy!: string;

  @ApiProperty({
    description: 'Reason for the operation',
    example: 'Investigating unexpected behavior',
    required: false,
  })
  reason?: string;

  @ApiProperty({
    description: 'Optional notes about resuming the execution',
    example: 'Issue resolved, resuming execution',
    required: false,
  })
  resumeNotes?: string;

  @ApiProperty({
    description: 'Whether container control operations were skipped (e.g., container_id was null)',
    example: false,
    required: false,
  })
  containerControlSkipped?: boolean;
}

/**
 * Response DTO for decision override operation
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class DecisionOverrideResponse {
  @ApiProperty({
    description: 'Execution ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  executionId!: string;

  @ApiProperty({
    description: 'Whether the decision was overridden',
    example: true,
  })
  decisionOverridden!: boolean;

  @ApiProperty({
    description: 'ID of the user who performed the override',
    example: 'user_123',
  })
  overriddenBy!: string;

  @ApiProperty({
    description: 'Timestamp of the override',
    example: '2026-02-05T12:00:00.000Z',
  })
  overriddenAt!: string;

  @ApiProperty({
    description: 'The original AI decision (if available)',
    example: 'REJECT',
    required: false,
  })
  originalDecision?: string | null;

  @ApiProperty({
    description: 'The new decision after override',
    example: 'APPROVE',
  })
  newDecision!: string;

  @ApiProperty({
    description: 'Reason for the override',
    example: 'False positive in security scan',
  })
  reason!: string;
}
