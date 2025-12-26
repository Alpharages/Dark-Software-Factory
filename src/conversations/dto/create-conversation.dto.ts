import { IsString, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ format: 'uuid', description: 'Project ID' })
  @IsUUID()
  project_id!: string;

  @ApiProperty({ format: 'date-time', description: 'Conversation date' })
  @IsDateString()
  conversation_date!: string;

  @ApiPropertyOptional({ description: 'Conversation title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Manual transcript text (if not uploading audio)' })
  @IsString()
  @IsOptional()
  transcript?: string;
}
