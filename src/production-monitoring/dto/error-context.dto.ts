/**
 * Error Context DTOs
 * Story 9-U-4: Error Context Extraction & Linking
 */

import {
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StackTraceFrameDto {
  @IsString()
  file!: string;

  @IsNumber()
  line!: number;

  @IsNumber()
  @IsOptional()
  column?: number;

  @IsString()
  function!: string;

  @IsString()
  @IsOptional()
  source_context?: string;
}

export class ParsedStackTraceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StackTraceFrameDto)
  frames!: StackTraceFrameDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => StackTraceFrameDto)
  top_frame!: StackTraceFrameDto;

  @IsObject()
  @ValidateNested()
  @Type(() => StackTraceFrameDto)
  entry_frame!: StackTraceFrameDto;

  @IsString()
  raw!: string;
}

export class UserContextDto {
  @IsString()
  @IsOptional()
  user_id?: string;

  @IsString()
  @IsOptional()
  session_id?: string;

  @IsString()
  @IsOptional()
  ip_hash?: string;

  @IsString()
  @IsOptional()
  user_agent?: string;
}

export class DeploymentContextDto {
  @IsString()
  deployment_id!: string;

  @IsString()
  commit_sha!: string;

  @IsString()
  branch!: string;

  @IsDate()
  @Type(() => Date)
  deployed_at!: Date;
}

export class RelatedCommitDto {
  @IsString()
  sha!: string;

  @IsString()
  message!: string;

  @IsString()
  author!: string;

  @IsDate()
  @Type(() => Date)
  committed_at!: Date;

  @IsString()
  github_url!: string;
}

export class ErrorContextResponseDto {
  @IsString()
  id!: string;

  @IsString()
  application!: string;

  @IsString()
  error_type!: string;

  @IsString()
  error_message!: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ParsedStackTraceDto)
  parsed_stack_trace?: ParsedStackTraceDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => UserContextDto)
  user_context?: UserContextDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => DeploymentContextDto)
  deployment_context?: DeploymentContextDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RelatedCommitDto)
  related_commits!: RelatedCommitDto[];

  @IsNumber()
  affected_users!: number;

  @IsNumber()
  occurrence_count!: number;
}
