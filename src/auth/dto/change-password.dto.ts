import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'currentPassword123', description: 'Current password' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  currentPassword!: string;

  @ApiProperty({ example: 'newPassword123!', description: 'New password' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  // Enforce complexity: 1 lowercase, 1 uppercase, 1 number, 1 special character
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number or special character',
  })
  newPassword!: string;

  @ApiProperty({ example: 'newPassword123!', description: 'Confirm new password' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  confirmPassword!: string;
}
