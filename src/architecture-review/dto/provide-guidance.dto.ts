import { IsString, IsBoolean, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for providing TL guidance on escalated ADR
 * Story 7.6 AC#3
 */
export class ProvideGuidanceDto {
    @ApiProperty({
        description: 'TL guidance text explaining the decision or recommendation',
        example: 'Use JWT with Redis refresh tokens for better scalability. Token revocation complexity is acceptable for our use case.',
        minLength: 10,
    })
    @IsString()
    @MinLength(10, { message: 'Guidance must be at least 10 characters long' })
    guidance!: string;

    @ApiPropertyOptional({
        description: 'Whether to apply this guidance globally by updating architecture constraints',
        example: true,
        default: false,
    })
    @IsOptional()
    @IsBoolean()
    apply_globally?: boolean;

    @ApiPropertyOptional({
        description: 'Whether to adjust the confidence threshold based on this escalation',
        example: false,
        default: false,
    })
    @IsOptional()
    @IsBoolean()
    update_thresholds?: boolean;
}
