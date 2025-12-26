import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({ description: 'Task name', example: 'Implement user authentication' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: 'Task description',
    example: 'Implement JWT authentication with role-based access control',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Priority level (1=urgent, 2=high, 3=normal, 4=low)',
    example: 2,
    minimum: 1,
    maximum: 4,
  })
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Task tags',
    example: ['from-conversation', 'high-priority'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CreateTasksRequestDto {
  @ApiProperty({
    description: 'User ID from AetherFlow',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ description: 'ClickUp list ID', example: '123456789' })
  @IsOptional()
  @IsString()
  listId?: string;

  @ApiPropertyOptional({
    description: 'ClickUp list name (used if listId not provided)',
    example: 'Sprint Backlog',
  })
  @IsOptional()
  @IsString()
  listName?: string;

  @ApiProperty({ description: 'Tasks to create', type: [CreateTaskDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTaskDto)
  tasks!: CreateTaskDto[];
}
