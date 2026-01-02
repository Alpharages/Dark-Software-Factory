import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for refresh token request
 * Story 17-3: Login & Session Management
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'JWT refresh token to exchange for new access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;
}
