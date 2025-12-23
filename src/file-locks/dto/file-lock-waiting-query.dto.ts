import { IsOptional, IsString } from 'class-validator';

export class FileLockWaitingQueryDto {
  @IsString()
  @IsOptional()
  filePath?: string;
}
