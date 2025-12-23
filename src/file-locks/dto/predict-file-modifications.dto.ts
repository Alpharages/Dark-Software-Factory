import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PredictFileModificationsDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  @IsNotEmpty()
  repoFullName!: string; // e.g. "org/repo"

  @IsString()
  @IsOptional()
  ticketTitle?: string;

  @IsString()
  @IsOptional()
  ticketDescription?: string;
}


