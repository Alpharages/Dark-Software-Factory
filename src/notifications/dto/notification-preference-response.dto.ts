import { ApiProperty } from '@nestjs/swagger';

export class NotificationPreferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  channels!: string[];

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  filterCriteria!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
