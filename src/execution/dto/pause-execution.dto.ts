import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for pausing an execution
 * Story 10-U-5: Manual Intervention Circuit Breaker
 */
export class PauseExecutionDto {
  @ApiProperty({
    description: 'Reason for pausing the execution',
    example: 'Investigating unexpected behavior in AI output',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
