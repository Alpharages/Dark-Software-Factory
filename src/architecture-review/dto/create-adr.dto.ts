import { IsString, IsOptional, IsNumber, IsEnum, Min, Max, IsNotEmpty, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RiskFactorsDto {
    @IsEnum(['single-file', 'module', 'cross-module'])
    scope!: 'single-file' | 'module' | 'cross-module';

    @IsEnum(['easy', 'migration-required', 'irreversible'])
    reversibility!: 'easy' | 'migration-required' | 'irreversible';

    @IsNumber()
    @Min(0)
    @Max(1)
    confidence!: number;

    @IsEnum(['low', 'medium', 'high'])
    domain_complexity!: 'low' | 'medium' | 'high';
}

export class CreateAdrDto {
    @IsOptional()
    @IsString()
    execution_id?: string;

    @IsOptional()
    @IsString()
    ticket_id?: string;

    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsOptional()
    @IsEnum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'DEPRECATED', 'SUPERSEDED'])
    status?: string;

    @IsString()
    @IsNotEmpty()
    context!: string;

    @IsString()
    @IsNotEmpty()
    decision!: string;

    @IsString()
    @IsNotEmpty()
    consequences!: string;

    @IsOptional()
    @IsString()
    alternatives?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1)
    ai_confidence?: number;

    @IsOptional()
    @IsEnum(['LOW', 'MEDIUM', 'HIGH'])
    risk_level?: string;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => RiskFactorsDto)
    risk_factors?: RiskFactorsDto;
}
