import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';

/**
 * Escalation reason categories
 */
export enum EscalationReasonCategory {
  LOW_CONFIDENCE = 'low_confidence',
  MISSING_CONTEXT = 'missing_context',
  CONFLICTING_REQUIREMENTS = 'conflicting_requirements',
  NO_BEST_PRACTICE = 'no_best_practice',
  SECURITY_CONCERN = 'security_concern',
  PERFORMANCE_TRADEOFF = 'performance_tradeoff',
  MULTIPLE_VALID_APPROACHES = 'multiple_valid_approaches',
}

/**
 * Query parameters for escalation metrics endpoint
 * Story 7.6 AC#6
 */
export class EscalationMetricsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by project ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  project_id?: string;

  @ApiPropertyOptional({
    description: 'Start date for metrics (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'End date for metrics (ISO 8601)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string;
}

/**
 * Response DTO for escalation metrics
 * Story 7.6 AC#6
 */
export class EscalationMetricsDto {
  total_escalations!: number;
  escalation_rate!: number; // Percentage (0-1)
  by_reason!: Record<string, number>;
  by_provider!: Record<string, number>;
  avg_resolution_time_seconds!: number;
  resolution_outcomes!: {
    guidance_provided: number;
    delegated: number;
    constraint_updated: number;
  };
}
