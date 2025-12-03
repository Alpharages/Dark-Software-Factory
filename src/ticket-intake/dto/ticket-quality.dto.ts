import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max,
  IsIn,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { QualityGrade } from '../interfaces';

/**
 * Story 2.11: PM-Facing Quality Scoring DTOs
 * FR4: PMs can view ticket quality score before submitting
 */

/**
 * Request DTO for quality score check
 */
export class QualityScoreRequestDto {
  @ApiProperty({
    description: 'Ticket title',
    example: 'Implement user authentication for login endpoint',
  })
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  title!: string;

  @ApiProperty({
    description: 'Ticket description with context and reasoning',
    example:
      'Add JWT-based authentication to enable secure login. This is needed because users currently have no way to access protected resources.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description!: string;

  @ApiProperty({
    description: 'Acceptance criteria in Given/When/Then format',
    example:
      'Given valid credentials When user submits login Then JWT token is returned within 200ms',
  })
  @IsString()
  @IsNotEmpty({ message: 'Acceptance criteria are required' })
  acceptanceCriteria!: string;

  @ApiPropertyOptional({
    description: 'Attached context documents',
    example: ['auth-spec.md', 'security-guidelines.pdf'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contextDocuments?: string[];

  @ApiPropertyOptional({
    description: 'Tags for categorization',
    example: ['auth', 'security', 'backend'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Prerequisites or dependencies',
    example: ['Story 1.5 Database Setup', 'Story 1.6 JWT Service'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prerequisites?: string[];

  @ApiPropertyOptional({
    description: 'Additional project context',
  })
  @IsOptional()
  @IsString()
  projectContext?: string;
}

/**
 * Category score DTO with full details
 */
export class CategoryScoreResponseDto {
  @ApiProperty({ description: 'Category name', example: 'titleClarity' })
  category!: string;

  @ApiProperty({ description: 'Score achieved', example: 12 })
  @IsNumber()
  @Min(0)
  score!: number;

  @ApiProperty({ description: 'Maximum possible points', example: 15 })
  @IsNumber()
  maxPoints!: number;

  @ApiProperty({ description: 'Percentage score', example: 80 })
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @ApiProperty({
    description: 'Improvement suggestions',
    type: [String],
    example: ['Add more specific context'],
  })
  suggestions!: string[];

  @ApiProperty({
    description: 'Scoring details',
    example: 'Word count optimal; Has action verb',
  })
  details!: string;
}

/**
 * Quality score breakdown DTO with enhanced category details
 */
export class QualityScoreBreakdownResponseDto {
  @ApiProperty({ description: 'Title clarity score (0-15 pts)' })
  titleClarity!: CategoryScoreResponseDto;

  @ApiProperty({ description: 'Description completeness score (0-25 pts)' })
  descriptionCompleteness!: CategoryScoreResponseDto;

  @ApiProperty({ description: 'Acceptance criteria score (0-30 pts)' })
  acceptanceCriteria!: CategoryScoreResponseDto;

  @ApiProperty({ description: 'Context documents score (0-10 pts)' })
  contextDocuments!: CategoryScoreResponseDto;

  @ApiProperty({ description: 'Task complexity score (0-10 pts)' })
  taskComplexity!: CategoryScoreResponseDto;

  @ApiProperty({ description: 'Prerequisites score (0-10 pts)' })
  prerequisites!: CategoryScoreResponseDto;
}

/**
 * Full quality score response DTO for PM API
 */
export class QualityScoreResponseDto {
  @ApiProperty({
    description: 'Total quality score (0-100)',
    minimum: 0,
    maximum: 100,
    example: 78,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  totalScore!: number;

  @ApiProperty({
    description: 'Quality grade',
    enum: ['excellent', 'good', 'fair', 'poor'],
    example: 'good',
  })
  @IsIn(['excellent', 'good', 'fair', 'poor'])
  grade!: QualityGrade;

  @ApiProperty({
    description: 'Grade emoji indicator',
    example: '👍',
  })
  gradeEmoji!: string;

  @ApiProperty({
    description: 'Grade message for PM guidance',
    example: 'Good quality. Minor improvements could enhance clarity.',
  })
  gradeMessage!: string;

  @ApiProperty({
    description: 'Detailed score breakdown by category',
  })
  breakdown!: QualityScoreBreakdownResponseDto;

  @ApiProperty({
    description: 'Top 5 improvement suggestions prioritized by impact',
    type: [String],
  })
  topSuggestions!: string[];

  @ApiProperty({
    description: 'Whether ticket meets minimum quality threshold for submission',
    example: true,
  })
  meetsMinimumThreshold!: boolean;

  @ApiProperty({
    description: 'ISO timestamp when score was calculated',
    example: '2025-12-03T19:00:00.000Z',
  })
  scoredAt!: string;
}

/**
 * Quick score response (lightweight)
 */
export class QuickScoreResponseDto {
  @ApiProperty({ description: 'Total score', example: 72 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({
    description: 'Quality grade',
    enum: ['excellent', 'good', 'fair', 'poor'],
  })
  grade!: QualityGrade;
}

/**
 * Batch scoring request DTO
 */
export class BatchQualityScoreRequestDto {
  @ApiProperty({
    description: 'Array of tickets to score (max 10)',
    type: [QualityScoreRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QualityScoreRequestDto)
  @ArrayMinSize(1, { message: 'At least one ticket is required' })
  @ArrayMaxSize(10, { message: 'Maximum 10 tickets per batch' })
  tickets!: QualityScoreRequestDto[];
}

/**
 * Batch scoring response DTO
 */
export class BatchQualityScoreResponseDto {
  @ApiProperty({
    description: 'Quality scores for each ticket',
    type: [QualityScoreResponseDto],
  })
  results!: QualityScoreResponseDto[];

  @ApiProperty({
    description: 'Number of tickets processed',
    example: 5,
  })
  processedCount!: number;

  @ApiProperty({
    description: 'Average score across all tickets',
    example: 68,
  })
  averageScore!: number;
}
