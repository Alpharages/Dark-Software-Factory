import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for refresh token response
 * Story 17-3: Login & Session Management
 */
export class RefreshResponseDto {
  @ApiProperty({
    description: 'New JWT access token (24-hour expiry)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;
}
