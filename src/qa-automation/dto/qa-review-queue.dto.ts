/**
 * QA Review Queue DTOs
 * Story 8.1: QA Review Queue & Sampling Configuration
 */

import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Queue review status enum
 */
export enum QueueStatus {
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Queue risk level enum
 */
export enum QueueRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Queue list query DTO
 */
export class QueueListQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: QueueStatus,
    default: QueueStatus.PENDING,
  })
  @IsEnum(QueueStatus)
  @IsOptional()
  status?: QueueStatus;

  @ApiPropertyOptional({
    description: 'Filter by risk level',
    enum: QueueRiskLevel,
  })
  @IsEnum(QueueRiskLevel)
  @IsOptional()
  riskLevel?: QueueRiskLevel;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsUUID()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by AI provider', enum: ['cursor', 'claude'] })
  @IsString()
  @IsOptional()
  aiProvider?: string;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ['risk_level', 'created_at'],
    default: 'risk_level',
  })
  @IsString()
  @IsOptional()
  sortBy?: 'risk_level' | 'created_at';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 20, minimum: 1, maximum: 100 })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

/**
 * Queue item response DTO
 */
export class QueueItemDto {
  @ApiProperty({ description: 'Queue entry ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Ticket ID (ClickUp)' })
  @IsString()
  ticketId!: string;

  @ApiPropertyOptional({ description: 'Ticket title' })
  @IsString()
  @IsOptional()
  ticketTitle?: string;

  @ApiProperty({ description: 'Execution ID' })
  @IsString()
  executionId!: string;

  @ApiPropertyOptional({ description: 'PR URL' })
  @IsString()
  @IsOptional()
  prUrl?: string;

  @ApiPropertyOptional({ description: 'PR ID' })
  @IsString()
  @IsOptional()
  prId?: string;

  @ApiProperty({ description: 'Review status', enum: QueueStatus })
  @IsEnum(QueueStatus)
  status!: QueueStatus;

  @ApiProperty({ description: 'Risk level', enum: QueueRiskLevel })
  @IsEnum(QueueRiskLevel)
  riskLevel!: QueueRiskLevel;

  @ApiProperty({ description: 'Risk factors', type: [String] })
  @IsString({ each: true })
  riskFactors!: string[];

  @ApiProperty({ description: 'AI Provider' })
  @IsString()
  aiProvider!: string;

  @ApiProperty({ description: 'Complexity score' })
  @IsNumber()
  complexityScore!: number;

  @ApiProperty({ description: 'Files changed count' })
  @IsNumber()
  filesChanged!: number;

  @ApiProperty({ description: 'Sampling strategy' })
  @IsString()
  samplingStrategy!: string;

  @ApiPropertyOptional({ description: 'Test coverage percentage' })
  @IsNumber()
  @IsOptional()
  testCoverage?: number;

  @ApiProperty({ description: 'Created at' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Reviewed by user ID' })
  @IsString()
  @IsOptional()
  reviewedBy?: string;

  @ApiPropertyOptional({ description: 'Reviewed at' })
  @IsOptional()
  reviewedAt?: Date;

  @ApiPropertyOptional({ description: 'Review notes' })
  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

/**
 * Paginated queue response DTO
 */
export class QueuePageResponseDto {
  @ApiProperty({ description: 'Queue items', type: [QueueItemDto] })
  items!: QueueItemDto[];

  @ApiProperty({ description: 'Total count' })
  @IsNumber()
  total!: number;

  @ApiProperty({ description: 'Current page' })
  @IsNumber()
  page!: number;

  @ApiProperty({ description: 'Total pages' })
  @IsNumber()
  totalPages!: number;

  @ApiProperty({ description: 'Has next page' })
  hasNextPage!: boolean;

  @ApiProperty({ description: 'Has previous page' })
  hasPreviousPage!: boolean;
}

/**
 * Review decision request DTO
 */
export class ReviewDecisionDto {
  @ApiProperty({ description: 'User ID making the decision' })
  @IsString()
  reviewerId!: string;

  @ApiPropertyOptional({ description: 'Review notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Queue details response DTO
 */
export class QueueDetailsResponseDto {
  @ApiProperty({ description: 'Queue entry', type: QueueItemDto })
  queueEntry!: QueueItemDto;

  @ApiPropertyOptional({
    description: 'Execution details',
    type: 'object',
    additionalProperties: true,
  })
  execution?: {
    id: string;
    ticketId: string;
    aiProvider: string;
    status: string;
    complexityScore: number | null;
    filesChanged: unknown;
  };

  @ApiPropertyOptional({
    description: 'QA Result',
    type: 'object',
    additionalProperties: true,
  })
  qaResult?: Record<string, unknown>;
}

/**
 * Queue depth response DTO
 */
export class QueueDepthResponseDto {
  @ApiProperty({
    description: 'Queue depth by status',
    type: 'object',
    additionalProperties: true,
  })
  depths!: Record<string, number>;
}
