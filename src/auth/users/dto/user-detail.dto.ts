import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../dto/user.dto';

export class UserDetailDto extends UserDto {
  @ApiProperty({
    description: 'Number of invitations sent by this user',
    example: 5,
  })
  invitationsSentCount!: number;

  @ApiProperty({
    description: 'Number of active refresh tokens for this user',
    example: 2,
  })
  activeRefreshTokensCount!: number;

  @ApiProperty({
    description: 'Timestamp of last login',
    example: '2026-01-03T00:00:00.000Z',
    required: false,
    nullable: true,
  })
  lastLoginAt?: Date | null;

  @ApiProperty({
    description: 'Timestamp of account creation',
    example: '2025-12-01T00:00:00.000Z',
  })
  createdAt!: Date;
}
