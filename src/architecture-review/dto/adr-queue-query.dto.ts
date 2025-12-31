import { IsOptional, IsEnum, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { AdrStatus, RiskLevel } from '@/prisma/client';

export class AdrReviewQueueQueryDto {
    @IsOptional()
    @IsEnum(AdrStatus, { message: 'status must be a valid AdrStatus enum value' })
    status?: AdrStatus = AdrStatus.PROPOSED;

    @IsOptional()
    @IsEnum(RiskLevel, { message: 'risk_level must be a valid RiskLevel enum value' })
    risk_level?: RiskLevel;

    @IsOptional()
    @IsUUID('4', { message: 'project_id must be a valid UUID' })
    project_id?: string;

    @IsOptional()
    @Transform(({ value }) => parseFloat(value))
    @Min(0.0)
    @Max(1.0)
    min_confidence?: number;

    @IsOptional()
    @Transform(({ value }) => parseFloat(value))
    @Min(0.0)
    @Max(1.0)
    max_confidence?: number;

    @IsOptional()
    @IsEnum(['risk_level', 'created_at', 'confidence'], { message: 'sort_by must be one of: risk_level, created_at, confidence' })
    sort_by?: 'risk_level' | 'created_at' | 'confidence' = 'risk_level';

    @IsOptional()
    @IsEnum(['ASC', 'DESC'], { message: 'sort_order must be ASC or DESC' })
    sort_order?: 'ASC' | 'DESC' = 'DESC';
}
