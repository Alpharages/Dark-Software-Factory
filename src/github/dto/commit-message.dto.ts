import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

/**
 * Commit Message DTO
 * AC#2: Conventional Commit Message Generation
 */

export enum CommitType {
  FEAT = 'feat',
  FIX = 'fix',
  REFACTOR = 'refactor',
  TEST = 'test',
  DOCS = 'docs',
  CHORE = 'chore',
  STYLE = 'style',
  PERF = 'perf',
}

export class CommitMessageDto {
  @IsEnum(CommitType)
  @IsNotEmpty()
  type!: CommitType;

  @IsString()
  @IsNotEmpty()
  scope!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72, { message: 'Commit subject must be ≤72 characters' })
  subject!: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  aiProvider!: string;

  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  complexityScore!: number;

  /**
   * Generates full conventional commit message
   */
  toString(): string {
    const header = `${this.type}(${this.scope}): ${this.subject}`;
    const metadata = [
      '',
      `Implements: ${this.ticketId}`,
      `AI-Generated: ${this.aiProvider}`,
      `Execution-ID: ${this.executionId}`,
      `Complexity: ${this.complexityScore}/100`,
    ].join('\n');

    if (this.body) {
      return `${header}\n\n${this.body}\n${metadata}`;
    }

    return `${header}\n${metadata}`;
  }
}
