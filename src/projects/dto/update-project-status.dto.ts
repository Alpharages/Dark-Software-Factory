import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProjectStatusDto {
  @ApiProperty({ description: 'Active status of the project', example: true })
  @IsBoolean()
  @IsNotEmpty()
  isActive!: boolean;
}
