import { ApiProperty } from '@nestjs/swagger';

export class ConnectedAppResponseDto {
  @ApiProperty({ example: 'uuid-123' })
  id!: string;

  @ApiProperty({ example: 'clickup', description: 'Provider identifier (lowercase)' })
  provider!: string;

  @ApiProperty({ example: '12345', description: 'Provider-specific workspace ID' })
  workspace_id!: string;

  @ApiProperty({ example: 'My Workspace', description: 'Provider-specific workspace name' })
  workspace_name!: string;

  @ApiProperty({ example: 'bot-user-id', required: false, nullable: true })
  bot_user_id!: string | null;

  @ApiProperty({ example: 'bot-username', required: false, nullable: true })
  bot_username!: string | null;

  @ApiProperty({ example: '2026-03-17T13:49:00.000Z' })
  created_at!: string;
}
