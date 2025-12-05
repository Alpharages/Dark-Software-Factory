/**
 * QA Results Storage & Retrieval DTOs
 * Story 3.6: FR38 - Lead QA can view automated QA results
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsObject,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QaResultFilterStatus } from '../interfaces';

/**
 * Main QA Result response DTO
 */
export class QaResultDto {
  @ApiProperty({
    description: 'QA Result ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'Execution ID',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  execution_id!: string;

  @ApiProperty({ description: 'Linting check passed', example: true })
  linting_passed!: boolean;

  @ApiPropertyOptional({
    description: 'Linting errors details',
    example: {
      errors: [{ file: 'src/app.ts', line: 10, message: 'Unexpected any' }],
    },
  })
  linting_errors?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Tests passed', example: true })
  tests_passed!: boolean;

  @ApiPropertyOptional({
    description: 'Test results details',
    example: { total: 50, passed: 48, failed: 2, skipped: 0 },
  })
  test_results?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Test coverage percentage',
    example: 85.5,
  })
  test_coverage?: number | null;

  @ApiProperty({ description: 'Code review passed', example: true })
  code_review_passed!: boolean;

  @ApiPropertyOptional({
    description: 'Code review issues',
    example: { issues: [{ severity: 'warning', message: 'Unused variable' }] },
  })
  code_review_issues?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Overall QA passed', example: true })
  overall_passed!: boolean;

  @ApiProperty({
    description: 'Created timestamp',
    example: '2025-12-03T10:30:00Z',
  })
  created_at!: Date;

  @ApiProperty({
    description: 'Updated timestamp',
    example: '2025-12-03T10:35:00Z',
  })
  updated_at!: Date;
}

/**
 * Execution summary for nested response
 */
export class ExecutionSummaryDto {
  @ApiProperty({ example: '660e8400-e29b-41d4-a716-446655440001' })
  id!: string;

  @ApiProperty({ example: '770e8400-e29b-41d4-a716-446655440002' })
  ticket_id!: string;

  @ApiProperty({ example: 'claude-3-opus' })
  ai_provider!: string;

  @ApiProperty({ example: 'completed' })
  status!: string;

  @ApiPropertyOptional()
  ticket?: {
    id: string;
    title: string;
    project_id: string;
    clickup_task_id: string;
  };
}

/**
 * QA Result with execution details
 */
export class QaResultWithExecutionDto extends QaResultDto {
  @ApiPropertyOptional({
    description: 'Associated execution details',
    type: ExecutionSummaryDto,
  })
  execution?: ExecutionSummaryDto;
}

/**
 * Query parameters for QA results
 */
export class QaResultsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by ticket ID' })
  @IsOptional()
  @IsString()
  ticketId?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: QaResultFilterStatus,
    default: QaResultFilterStatus.ALL,
  })
  @IsOptional()
  @IsEnum(QaResultFilterStatus)
  status?: QaResultFilterStatus;

  @ApiPropertyOptional({
    description: 'Start date for date range filter (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for date range filter (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Results per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Pagination info
 */
export class PageInfoDto {
  @ApiProperty({ example: 150 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 8 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}

/**
 * Paginated QA results response
 */
export class QaResultsPageDto {
  @ApiProperty({ type: [QaResultWithExecutionDto] })
  data!: QaResultWithExecutionDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

/**
 * Create QA result input
 */
export class CreateQaResultDto {
  @ApiProperty({ description: 'Execution ID' })
  @IsString()
  executionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  linting_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  linting_errors?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tests_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  test_results?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  test_coverage?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  code_review_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  code_review_issues?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overall_passed?: boolean;
}

/**
 * Update QA result input
 */
export class UpdateQaResultDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  linting_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  linting_errors?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tests_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  test_results?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  test_coverage?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  code_review_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  code_review_issues?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overall_passed?: boolean;
}

/**
 * Daily trend data point
 */
export class TrendDataDto {
  @ApiProperty({ example: '2025-12-03' })
  date!: string;

  @ApiProperty({ example: 15 })
  passed!: number;

  @ApiProperty({ example: 3 })
  failed!: number;

  @ApiProperty({ example: 82 })
  coverage!: number;
}

/**
 * Aggregated QA metrics response
 */
export class QaResultMetricsDto {
  @ApiProperty({
    description: 'Project ID',
    example: '880e8400-e29b-41d4-a716-446655440003',
  })
  projectId!: string;

  @ApiProperty({ description: 'Date range' })
  dateRange!: {
    start: Date;
    end: Date;
  };

  @ApiProperty({ description: 'Total executions', example: 100 })
  totalExecutions!: number;

  @ApiProperty({ description: 'Passed count', example: 85 })
  passedCount!: number;

  @ApiProperty({ description: 'Failed count', example: 15 })
  failedCount!: number;

  @ApiProperty({ description: 'Pass rate (0-100)', example: 85.0 })
  passRate!: number;

  @ApiProperty({ description: 'Average test coverage (0-100)', example: 78.5 })
  averageCoverage!: number;

  @ApiProperty({ description: 'Linting pass rate (0-100)', example: 92.0 })
  lintingPassRate!: number;

  @ApiProperty({ description: 'Test pass rate (0-100)', example: 88.0 })
  testPassRate!: number;

  @ApiProperty({ description: 'Security pass rate (0-100)', example: 95.0 })
  securityPassRate!: number;

  @ApiProperty({ description: 'Daily trends', type: [TrendDataDto] })
  trends!: TrendDataDto[];
}

/**
 * Date range filter input
 */
export class DateRangeDto {
  @ApiProperty({ description: 'Start date' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'End date' })
  @IsDateString()
  endDate!: string;
}

/**
 * Quality Gate Override DTO
 * Used for emergency override of failed quality gates
 */
export class QualityGateOverrideDto {
  @ApiProperty({
    description: 'Reason for overriding the quality gate',
    example: 'Critical hotfix required - security patch',
  })
  @IsString()
  reason!: string;

  @ApiProperty({
    description: 'User ID of the approver',
    example: 'user-123',
  })
  @IsString()
  approvedBy!: string;
}
