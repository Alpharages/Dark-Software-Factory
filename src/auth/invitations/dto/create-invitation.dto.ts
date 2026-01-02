import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../constants/roles.enum';

export class CreateInvitationDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address of the user to invite',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Role to assign to the invited user',
    enum: Role,
  })
  @IsEnum(Role)
  @IsNotEmpty()
  role!: Role;
}
