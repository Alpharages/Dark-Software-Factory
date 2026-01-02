import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { IsStrongPassword } from './password-validation.decorator';

export class RegisterUserDto {
  @ApiProperty({
    description: 'Invitation token received via email',
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  })
  @IsString()
  @IsNotEmpty()
  inviteToken!: string;

  @ApiProperty({
    description: 'User password meeting security requirements',
    example: 'MySecureP@ssw0rd',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  password!: string;

  @ApiProperty({
    description: 'Full name of the user',
    example: 'John Doe',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;
}
