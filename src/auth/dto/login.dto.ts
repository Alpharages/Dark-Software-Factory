import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for user login request
 * Story 17-3: Login & Session Management
 */
export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecureP@ssw0rd!',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
