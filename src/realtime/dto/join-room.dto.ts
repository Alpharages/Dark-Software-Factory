import { IsString, IsNotEmpty, Matches } from 'class-validator';

/**
 * DTO for joining a project room
 * Story 10-U-1 AC 3: Room & Namespace Management
 */
export class JoinProjectDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9-_]+$/, {
    message: 'Project ID must contain only alphanumeric characters, hyphens, and underscores',
  })
  projectId!: string;
}

/**
 * DTO for leaving a project room
 */
export class LeaveProjectDto {
  @IsString()
  projectId!: string;
}
