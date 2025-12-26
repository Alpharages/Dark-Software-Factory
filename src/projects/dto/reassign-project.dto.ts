import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class ReassignProjectDto {
  @ApiProperty({
    description: 'New PM user ID to assign the project to',
    example: 'pm-456',
  })
  @IsNotEmpty()
  @IsString()
  new_pm_id!: string;

  @ApiProperty({
    description: 'Reason for reassignment (for audit logging)',
    example: 'PM workload balancing - current PM at 90% capacity',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
