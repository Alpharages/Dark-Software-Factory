import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OverrideDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

/**
 * DTO for overriding an AI decision
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class OverrideDecisionDto {
  @ApiProperty({
    description: 'The new decision to override with',
    enum: OverrideDecision,
    example: 'APPROVE',
  })
  @IsEnum(OverrideDecision)
  decision!: OverrideDecision;

  @ApiProperty({
    description: 'Reason for overriding the decision',
    example: 'AI incorrectly rejected valid code - security scan is a false positive',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({
    description: 'Optional additional data about the override',
    example: { reviewedFiles: ['src/auth.service.ts'], reviewerNotes: 'Verified safe' },
    required: false,
  })
  @IsObject()
  @IsOptional()
  overrideData?: Record<string, unknown>;
}
