import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for emergency stopping an execution
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class EmergencyStopDto {
  @ApiProperty({
    description: 'Reason for emergency stop',
    example: 'Critical security vulnerability detected in generated code',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    description: 'Whether to immediately kill the Docker container (true) or graceful stop (false)',
    example: true,
    default: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  killContainer?: boolean;
}
