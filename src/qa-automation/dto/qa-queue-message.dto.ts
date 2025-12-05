/**
 * QA Queue Message DTOs
 * Story 3.7: RabbitMQ QA Queue Processing
 */

import { IsString, IsArray, IsNotEmpty, ValidateNested, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CodeFileDto {
  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsOptional()
  originalContent?: string;

  @IsString()
  @IsOptional()
  @IsIn(['typescript', 'javascript', 'python', 'go', 'unknown'])
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'unknown';
}

export class QaQueueMessageDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeFileDto)
  codeFiles!: CodeFileDto[];

  @IsString()
  @IsNotEmpty()
  aiProvider!: string;

  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsString()
  @IsNotEmpty()
  completedAt!: string;
}
