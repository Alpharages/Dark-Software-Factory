import { ApiProperty } from '@nestjs/swagger';
import { InvitationStatus } from '../../../prisma/enums';
import { Role } from '../../constants/roles.enum';

export class InvitationResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.VIEWER })
  role!: string;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.PENDING })
  status!: InvitationStatus;

  @ApiProperty({ example: '7d8f...' })
  inviteToken!: string;

  @ApiProperty({ example: '2023-12-31T23:59:59.999Z' })
  expiresAt!: Date;

  @ApiProperty({
    description: 'Date when the invitation was accepted',
    example: '2023-01-01T00:00:00.000Z',
    nullable: true,
  })
  acceptedAt?: Date | null;

  @ApiProperty({ description: 'Date when the invitation was created' })
  createdAt!: Date;

  @ApiProperty({ description: 'User who created the invitation' })
  invitedBy!: {
    id: string;
    email: string;
    fullName: string;
  };
}
