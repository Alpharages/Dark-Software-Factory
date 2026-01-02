import { IsString, IsUUID, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for delegating an escalated ADR to architect or senior developer
 * Story 7.6 AC#3
 */
export class DelegateAdrDto {
  @ApiProperty({
    description: 'User ID of the person to delegate to (architect or senior developer)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID('4', { message: 'Delegate user ID must be a valid UUID' })
  delegate_to_user_id!: string;

  @ApiPropertyOptional({
    description: 'Optional notes explaining why this ADR is being delegated',
    example: 'This decision requires deep knowledge of the authentication system architecture.',
    minLength: 10,
  })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Notes must be at least 10 characters if provided' })
  notes?: string;
}
