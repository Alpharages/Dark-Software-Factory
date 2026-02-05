import { ApiProperty } from '@nestjs/swagger';

export class InAppNotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty()
  read!: boolean;

  @ApiProperty({ required: false })
  readAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
