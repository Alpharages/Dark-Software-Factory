import { ApiProperty } from '@nestjs/swagger';

export class ProfileResponseDto {
  @ApiProperty({ example: 'usr_abc123' })
  id!: string;

  @ApiProperty({ example: 'developer@alpharages.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Developer' })
  name!: string;

  @ApiProperty({ example: 'PM', enum: ['ADMIN', 'MANAGER', 'PM', 'TL', 'QA', 'VIEWER'] })
  role!: string;
}
