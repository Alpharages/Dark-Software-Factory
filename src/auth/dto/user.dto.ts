import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../constants/roles.enum';

export class UserDto {
  @ApiProperty({
    description: 'User unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'User email address',
    example: 'john.doe@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'User full name',
    example: 'John Doe',
  })
  fullName!: string;

  @ApiProperty({
    description: 'User role in the system',
    enum: Role,
    example: Role.PM,
  })
  role!: Role;

  @ApiProperty({
    description: 'Whether the user account is active',
    example: true,
  })
  isActive!: boolean;
}
