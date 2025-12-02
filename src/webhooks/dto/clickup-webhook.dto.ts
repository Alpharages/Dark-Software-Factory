import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for ClickUp webhook payload validation
 *
 * Per FR56: System can receive ClickUp webhook events (task created, updated)
 */
export class ClickUpWebhookDto {
  @ApiProperty({ description: 'Unique webhook event ID - used for idempotency' })
  webhook_id!: string;

  @ApiProperty({ description: 'Event type (e.g., taskCreated, taskUpdated)' })
  event!: string;

  @ApiProperty({ description: 'ClickUp task ID' })
  task_id!: string;

  @ApiPropertyOptional({ description: 'Full task object (may be partial for updates)' })
  task?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'History items in webhook payload' })
  history_items?: Record<string, unknown>[];
}

/**
 * DTO for task status from webhook
 */
export class TaskStatusDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  color!: string;

  @ApiProperty()
  type!: string;

  @ApiPropertyOptional()
  orderindex?: number;
}

/**
 * DTO for list/project/folder reference
 */
export class TaskLocationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  access?: boolean;

  @ApiPropertyOptional()
  hidden?: boolean;
}

/**
 * DTO for task data from webhook
 */
export class ClickUpTaskDto {
  @ApiProperty({ description: 'ClickUp task ID' })
  id!: string;

  @ApiPropertyOptional({ description: 'Custom task ID' })
  custom_id?: string;

  @ApiProperty({ description: 'Task name/title' })
  name!: string;

  @ApiPropertyOptional({ description: 'Plain text content' })
  text_content?: string;

  @ApiPropertyOptional({ description: 'Task description (may contain markdown)' })
  description?: string;

  @ApiProperty({ description: 'Task status' })
  status!: TaskStatusDto;

  @ApiProperty({ description: 'ISO timestamp when task was created' })
  date_created!: string;

  @ApiProperty({ description: 'ISO timestamp when task was last updated' })
  date_updated!: string;

  @ApiPropertyOptional({ description: 'ISO timestamp when task was closed' })
  date_closed?: string;

  @ApiProperty({ description: 'Task creator info' })
  creator!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Task assignees' })
  assignees?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Task tags' })
  tags?: Array<{ name: string; tag_fg: string; tag_bg: string }>;

  @ApiPropertyOptional({ description: 'Task priority' })
  priority?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Due date' })
  due_date?: string;

  @ApiPropertyOptional({ description: 'Custom fields' })
  custom_fields?: Record<string, unknown>[];

  @ApiProperty({ description: 'ClickUp team ID' })
  team_id!: string;

  @ApiProperty({ description: 'Task URL' })
  url!: string;

  @ApiProperty({ description: 'List containing the task' })
  list!: TaskLocationDto;

  @ApiProperty({ description: 'Project containing the task' })
  project!: TaskLocationDto;

  @ApiProperty({ description: 'Folder containing the task' })
  folder!: TaskLocationDto;

  @ApiProperty({ description: 'Space containing the task' })
  space!: { id: string };
}
