import { IsString, IsOptional, IsNumber, IsEnum, Min, Max, IsNotEmpty } from 'class-validator';

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
}
