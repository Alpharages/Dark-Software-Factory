import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

export class RegisterResponseDto {
  @ApiProperty({
    description: 'JWT access token for authentication',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Registered user information',
    type: UserDto,
  })
  user!: UserDto;
}
