import { AppProvider } from '@/prisma/enums';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectedAppResponseDto {
  @ApiProperty({ example: 'uuid-123' })
  id!: string;

  @ApiProperty({ enum: AppProvider, example: AppProvider.CLICKUP })
  provider!: AppProvider;

  @ApiProperty({ example: '12345', description: 'Provider-specific workspace ID' })
  workspaceId!: string;

  @ApiProperty({ example: 'My Workspace', description: 'Provider-specific workspace name' })
  workspaceName!: string;

  @ApiProperty({ required: false, type: Object, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-03-17T13:49:00.000Z' })
  connectedAt!: string;
}
