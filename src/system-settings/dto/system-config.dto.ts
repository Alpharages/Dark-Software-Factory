import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSystemConfigDto {
    @ApiProperty({ example: 'cleanup.retention_period', description: 'Configuration key' })
    @IsString()
    key!: string;

    @ApiProperty({ example: '30', description: 'Configuration value' })
    @IsString()
    value!: string;

    @ApiProperty({ example: 'Data retention period in days', required: false })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ example: false, required: false, description: 'Whether the value contains sensitive information' })
    @IsBoolean()
    @IsOptional()
    is_secret?: boolean;
}

export class UpdateSystemConfigDto {
    @ApiProperty({ example: '30', description: 'Configuration value' })
    @IsString()
    value!: string;

    @ApiProperty({ required: false, description: 'Description of the configuration setting' })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ required: false, description: 'Whether the value contains sensitive information' })
    @IsBoolean()
    @IsOptional()
    is_secret?: boolean;
}
