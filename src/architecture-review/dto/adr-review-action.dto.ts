import { IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Enum for ADR review actions
 * Maps to AdrStatus enum in Prisma schema
 */
export enum AdrReviewAction {
    APPROVE = 'APPROVE',
    REJECT = 'REJECT',
    MODIFY = 'MODIFY',
    DEFER = 'DEFER',
}

/**
 * DTO for ADR review action request
 * Validates that notes are required for REJECT and MODIFY actions
 */
export class AdrReviewActionDto {
    @ApiProperty({
        enum: AdrReviewAction,
        description: 'Review action to perform on the ADR',
        example: AdrReviewAction.APPROVE,
    })
    @IsEnum(AdrReviewAction, {
        message: 'Action must be one of: APPROVE, REJECT, MODIFY, DEFER',
    })
    action!: AdrReviewAction;

    @ApiProperty({
        required: false,
        description: 'Notes or reason for the review decision (required for REJECT/MODIFY actions)',
        example: 'Security concerns with this approach - please use PostgreSQL instead of Redis',
        minLength: 10,
    })
    @IsOptional()
    @ValidateIf((o) => o.action === AdrReviewAction.REJECT || o.action === AdrReviewAction.MODIFY)
    @IsString()
    @MinLength(10, {
        message: 'Notes must be at least 10 characters for REJECT/MODIFY actions',
    })
    notes?: string;
}
