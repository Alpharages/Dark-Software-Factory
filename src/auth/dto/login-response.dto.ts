import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

/**
 * DTO for successful login response
 * Story 17-3: Login & Session Management
 */
export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT access token (24-hour expiry)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'JWT refresh token (30-day expiry)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken!: string;

  @ApiProperty({
    description: 'User profile information',
    type: UserDto,
  })
  user!: UserDto;
}
