import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for resuming a paused execution
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class ResumeExecutionDto {
  @ApiProperty({
    description: 'Optional notes about resuming the execution',
    example: 'Issue resolved, resuming execution',
    maxLength: 500,
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  resumeNotes?: string;
}
