import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../constants/roles.enum';

export class VerifyTokenResponseDto {
  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.VIEWER })
  role!: Role;

  @ApiProperty({ example: '2023-12-31T23:59:59.999Z' })
  expiresAt!: Date;
}
