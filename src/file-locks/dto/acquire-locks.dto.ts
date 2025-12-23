import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class AcquireLocksDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  filePaths!: string[];
}


