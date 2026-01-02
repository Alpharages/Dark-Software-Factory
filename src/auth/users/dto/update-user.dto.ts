import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { Role } from '../../constants/roles.enum';

export class UpdateUserDto {
  @ApiProperty({
    description: 'Update user role',
    enum: Role,
    required: false,
    example: Role.TL,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({
    description: 'Update user active status',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
