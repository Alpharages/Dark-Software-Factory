import { IsString, IsOptional, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateQaStatusConfigDto {
  @ApiPropertyOptional({
    description:
      'ClickUp status name to move ticket to when QA retries are exhausted. Pass null to clear.',
    example: 'QA Failed',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'qa_failure_status must be a non-empty string or null' })
  qa_failure_status?: string | null;

  @ApiPropertyOptional({
    description:
      'ClickUp status name to move ticket to when PM cancels QA-failed execution. Pass null to clear.',
    example: 'Needs Manual Review',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'manual_review_status must be a non-empty string or null' })
  manual_review_status?: string | null;

  @ApiPropertyOptional({
    description:
      'ClickUp status name to move ticket to after open_pr on QA-failed execution. Pass null to clear.',
    example: 'Code Review',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'code_review_status must be a non-empty string or null' })
  code_review_status?: string | null;
}
