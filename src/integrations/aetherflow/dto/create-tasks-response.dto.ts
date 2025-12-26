import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatedTaskDto {
  @ApiProperty({ description: 'ClickUp task ID', example: '9hx' })
  id!: string;

  @ApiProperty({ description: 'Task name', example: 'Implement user authentication' })
  name!: string;

  @ApiProperty({ description: 'ClickUp task URL', example: 'https://app.clickup.com/t/9hx' })
  url!: string;
}

export class CreateTasksResponseDto {
  @ApiProperty({ description: 'Operation success status' })
  success!: boolean;

  @ApiPropertyOptional({ description: 'Created tasks', type: [CreatedTaskDto] })
  tasks?: CreatedTaskDto[];

  @ApiPropertyOptional({ description: 'Error message if operation failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Additional error details or user-facing message' })
  message?: string;

  @ApiPropertyOptional({ description: 'Number of tasks created', example: 3 })
  count?: number;
}
