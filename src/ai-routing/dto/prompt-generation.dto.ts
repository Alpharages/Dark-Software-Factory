import { AIProvider } from '@/prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsNumber,
  IsEnum,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for prompt generation input validation
 */
export class PromptGenerationInputDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  clickupTaskId!: string;

  @IsEnum(AIProvider)
  provider!: AIProvider;

  @IsNumber()
  complexityScore!: number;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  acceptanceCriteria!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsString()
  routedAt!: string;
}

/**
 * DTO for relevant file
 */
export class RelevantFileDto {
  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  linesOfCode?: number;
}

/**
 * DTO for project context
 */
export class ProjectContextDto {
  @IsString()
  @IsNotEmpty()
  projectName!: string;

  @IsArray()
  @IsString({ each: true })
  techStack!: string[];

  @IsArray()
  @IsString({ each: true })
  codingStandards!: string[];

  @IsString()
  fileStructure!: string;

  @IsArray()
  @IsString({ each: true })
  dependencies!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RelevantFileDto)
  relevantFiles!: RelevantFileDto[];
}

/**
 * DTO for prompt metadata
 */
export class PromptMetadataDto {
  promptLength!: number;
  estimatedTokens!: number;
  sectionsIncluded!: string[];
  contextFilesIncluded!: boolean;
  relevantFilesCount!: number;
  generatedAt!: Date;
  templateVersion!: string;
}

/**
 * DTO for generated prompt result
 */
export class GeneratedPromptDto {
  correlationId!: string;
  ticketId!: string;
  provider!: AIProvider;
  prompt!: string;
  metadata!: PromptMetadataDto;
}
