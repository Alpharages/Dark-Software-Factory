import { ApiProperty } from '@nestjs/swagger';

/**
 * Validation error DTO
 */
export class ValidationErrorDto {
  @ApiProperty({ description: 'Field that failed validation' })
  field!: string;

  @ApiProperty({ description: 'Error code' })
  code!: string;

  @ApiProperty({ description: 'Human-readable error message' })
  message!: string;

  @ApiProperty({ description: 'Severity level', enum: ['error', 'warning'] })
  severity!: 'error' | 'warning';
}

/**
 * Validation result DTO
 * FR58: Validate ticket quality
 */
export class ValidationResultDto {
  @ApiProperty({ description: 'Whether validation passed' })
  isValid!: boolean;

  @ApiProperty({ description: 'Validation errors', type: [ValidationErrorDto] })
  errors!: ValidationErrorDto[];

  @ApiProperty({ description: 'Validation warnings', type: [ValidationErrorDto] })
  warnings!: ValidationErrorDto[];

  static success(): ValidationResultDto {
    const result = new ValidationResultDto();
    result.isValid = true;
    result.errors = [];
    result.warnings = [];
    return result;
  }

  static failure(
    errors: ValidationErrorDto[],
    warnings: ValidationErrorDto[] = [],
  ): ValidationResultDto {
    const result = new ValidationResultDto();
    result.isValid = false;
    result.errors = errors;
    result.warnings = warnings;
    return result;
  }
}

/**
 * Quality score breakdown DTO
 */
export class QualityScoreBreakdownDto {
  @ApiProperty({ description: 'Title clarity score (0-15)' })
  titleClarity!: number;

  @ApiProperty({ description: 'Description completeness score (0-25)' })
  descriptionCompleteness!: number;

  @ApiProperty({ description: 'Acceptance criteria score (0-30)' })
  acceptanceCriteria!: number;

  @ApiProperty({ description: 'Context documents score (0-10)' })
  contextDocuments!: number;

  @ApiProperty({ description: 'Task complexity score (0-10)' })
  taskComplexity!: number;

  @ApiProperty({ description: 'Prerequisites score (0-10)' })
  prerequisites!: number;
}

/**
 * Quality score DTO
 * FR58: Validate ticket quality - scoring system
 */
export class QualityScoreDto {
  @ApiProperty({ description: 'Total quality score (0-100)' })
  totalScore!: number;

  @ApiProperty({ description: 'Score breakdown by category' })
  breakdown!: QualityScoreBreakdownDto;

  @ApiProperty({
    description: 'Quality grade',
    enum: ['excellent', 'good', 'fair', 'poor'],
  })
  grade!: 'excellent' | 'good' | 'fair' | 'poor';

  @ApiProperty({ description: 'Improvement suggestions', type: [String] })
  suggestions!: string[];
}
