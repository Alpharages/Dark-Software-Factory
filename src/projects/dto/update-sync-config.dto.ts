import { IsString, IsOptional, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSyncConfigDto {
  @ApiPropertyOptional({
    description: 'Status name that triggers AI processing. Pass null to clear.',
    example: 'In Review',
    nullable: true,
  })
  @IsOptional() // skips validation for null and undefined; empty string "" still runs @MinLength
  @IsString()
  @MinLength(1, { message: 'ai_trigger_status must be a non-empty string or null' })
  ai_trigger_status?: string | null;
}
